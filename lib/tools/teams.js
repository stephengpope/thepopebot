/**
 * Microsoft Teams (Bot Framework) helpers.
 *
 * Teams bots speak the Bot Framework Activity protocol. We:
 *   1. Receive Activities via webhook, JWT-validated against Microsoft's signing keys.
 *   2. Send replies via the Bot Framework Connector REST API, authenticated with
 *      an app-only access token obtained from Microsoft's token endpoint (MSAL client-credentials).
 *
 * We hand-roll the minimum needed to avoid pulling the full `botbuilder` SDK
 * (~5MB+). JWT validation uses Microsoft's published JWKS, cached for 24h.
 */

import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { getConfig } from '../config.js';

const OPENID_CONFIG_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';
const TOKEN_SCOPE = 'https://api.botframework.com/.default';
const BF_ISSUER = 'https://api.botframework.com';

// For Single Tenant registrations, TEAMS_TENANT_ID must be set — otherwise
// the botframework.com multi-tenant endpoint is used.
function getTokenEndpoint() {
  const tenantId = getConfig('TEAMS_TENANT_ID') || 'botframework.com';
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

let _openidConfig = null;
let _openidConfigFetchedAt = 0;
let _jwks = null;
let _jwksFetchedAt = 0;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let _accessToken = null;
let _accessTokenExpiresAt = 0;

async function getOpenIdConfig() {
  if (_openidConfig && Date.now() - _openidConfigFetchedAt < ONE_DAY_MS) {
    return _openidConfig;
  }
  const res = await fetch(OPENID_CONFIG_URL);
  if (!res.ok) throw new Error(`OpenID config fetch failed: ${res.status}`);
  _openidConfig = await res.json();
  _openidConfigFetchedAt = Date.now();
  return _openidConfig;
}

async function getJwks() {
  if (_jwks && Date.now() - _jwksFetchedAt < ONE_DAY_MS) {
    return _jwks;
  }
  const conf = await getOpenIdConfig();
  const res = await fetch(conf.jwks_uri);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = await res.json();
  _jwks = body.keys || [];
  _jwksFetchedAt = Date.now();
  return _jwks;
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  return {
    header: JSON.parse(base64UrlDecode(parts[0]).toString('utf8')),
    payload: JSON.parse(base64UrlDecode(parts[1]).toString('utf8')),
    signature: base64UrlDecode(parts[2]),
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

/**
 * Verify a Bot Framework JWT from the Authorization header.
 * Validates: signature, issuer, audience (must equal app id), expiry.
 *
 * @param {string} authHeader - "Bearer <token>"
 * @param {string} expectedAudience - The bot's Microsoft App ID
 * @returns {Promise<boolean>}
 */
async function verifyJwt(authHeader, expectedAudience) {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  let decoded;
  try {
    decoded = decodeJwt(token);
  } catch {
    return false;
  }

  const { header, payload, signature, signingInput } = decoded;

  // Issuer
  if (payload.iss !== BF_ISSUER) return false;
  // Audience
  if (payload.aud !== expectedAudience) return false;
  // Expiry
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && nowSec >= payload.exp) return false;
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf - 60) return false;

  // Signature
  const jwks = await getJwks();
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) return false;

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return false;
  }

  const algMap = { RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512' };
  const nodeAlg = algMap[header.alg];
  if (!nodeAlg) return false;

  try {
    return cryptoVerify(nodeAlg, Buffer.from(signingInput, 'utf8'), publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * Get (and cache) an access token for the Bot Framework Connector.
 * Uses client_credentials flow with the bot's App ID + App Password.
 */
async function getAccessToken(appId, appPassword) {
  if (_accessToken && Date.now() < _accessTokenExpiresAt - 60_000) {
    return _accessToken;
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: appId,
    client_secret: appPassword,
    scope: TOKEN_SCOPE,
  });
  const res = await fetch(getTokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Teams token request failed: ${res.status} ${txt}`);
  }
  const json = await res.json();
  _accessToken = json.access_token;
  _accessTokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
  return _accessToken;
}

/**
 * Validate Microsoft App credentials by requesting a token.
 * @param {string} appId
 * @param {string} appPassword
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateCredentials(appId, appPassword) {
  if (!appId || !appPassword) return { valid: false, error: 'App ID and Password required' };
  try {
    _accessToken = null; // force a fresh request
    _accessTokenExpiresAt = 0;
    await getAccessToken(appId, appPassword);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Send a reply Activity to a Teams conversation via the Bot Framework Connector.
 * @param {object} opts
 * @param {string} opts.appId
 * @param {string} opts.appPassword
 * @param {string} opts.serviceUrl - The serviceUrl from the inbound Activity
 * @param {string} opts.conversationId
 * @param {string} [opts.replyToActivityId] - For threaded replies
 * @param {string} opts.text
 * @returns {Promise<object>} Connector response
 */
async function sendActivity({
  appId,
  appPassword,
  serviceUrl,
  conversationId,
  replyToActivityId,
  text,
}) {
  const token = await getAccessToken(appId, appPassword);
  const cleanServiceUrl = serviceUrl.replace(/\/$/, '');
  const path = replyToActivityId
    ? `/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(replyToActivityId)}`
    : `/v3/conversations/${encodeURIComponent(conversationId)}/activities`;

  const res = await fetch(`${cleanServiceUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'message',
      text,
      textFormat: 'markdown',
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Teams sendActivity failed: ${res.status} ${txt}`);
  }
  return res.json().catch(() => ({}));
}

/**
 * Send a typing Activity to indicate the bot is working.
 * Teams shows this for ~10s before fading.
 */
async function sendTypingActivity({
  appId,
  appPassword,
  serviceUrl,
  conversationId,
}) {
  try {
    const token = await getAccessToken(appId, appPassword);
    const cleanServiceUrl = serviceUrl.replace(/\/$/, '');
    await fetch(`${cleanServiceUrl}/v3/conversations/${encodeURIComponent(conversationId)}/activities`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'typing' }),
    });
  } catch {
    // Best-effort
  }
}

export {
  verifyJwt,
  getAccessToken,
  validateCredentials,
  sendActivity,
  sendTypingActivity,
};
