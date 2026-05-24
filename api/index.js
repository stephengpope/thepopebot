import { createHash, timingSafeEqual, randomUUID } from 'crypto';
import { createAgentJob } from '../lib/tools/create-agent-job.js';
import { getAgentJobStatus, fetchAgentJobLog } from '../lib/tools/github.js';
import { getTelegramAdapter, getSlackAdapter, getTeamsAdapter } from '../lib/channels/index.js';
import { dispatchCommand, dispatchPreAuthCommand } from '../lib/channels/commands/index.js';
import { getByChannelChatId, getVerifiedChannels, setActiveThread } from '../lib/db/user-channels.js';
import { getAllUsers, getUserById } from '../lib/db/users.js';
import { chat, chatStream, summarizeAgentJob } from '../lib/ai/index.js';
import { createSystemMessage, getSubscribedAdminIds, markDelivered } from '../lib/db/messages.js';
import { getFireTriggers } from '../lib/triggers.js';
import { verifyApiKey } from '../lib/db/api-keys.js';
import { getConfig } from '../lib/config.js';
import { parseOAuthState, exchangeCodeForToken } from '../lib/oauth/helper.js';
import { setAgentJobSecret } from '../lib/db/config.js';

// ── Per-key lock for OAuth token refresh ────────────────────────────
const _refreshLocks = new Map();

function getTelegramBotToken() {
  return getConfig('TELEGRAM_BOT_TOKEN') || null;
}

function getSlackCredentials() {
  const botToken = getConfig('SLACK_BOT_TOKEN') || null;
  const signingSecret = getConfig('SLACK_SIGNING_SECRET') || null;
  return botToken && signingSecret ? { botToken, signingSecret } : null;
}

function getTeamsCredentials() {
  const appId = getConfig('TEAMS_APP_ID') || null;
  const appPassword = getConfig('TEAMS_APP_PASSWORD') || null;
  return appId && appPassword ? { appId, appPassword } : null;
}


// Routes that have their own authentication
const PUBLIC_ROUTES = [
  '/telegram/webhook',
  '/slack/events',
  '/teams/events',
  '/github/webhook',
  '/ping',
  '/oauth/callback',
];

/**
 * Timing-safe string comparison.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Centralized auth gate for all API routes.
 * Public routes pass through; everything else requires a valid API key from the database.
 * @param {string} routePath - The route path
 * @param {Request} request - The incoming request
 * @returns {Response|null} - Error response or null if authorized
 */
function checkAuth(routePath, request) {
  if (PUBLIC_ROUTES.includes(routePath)) return null;

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const record = verifyApiKey(apiKey);
  if (!record) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

/**
 * Extract agent job ID from branch name (e.g., "agent-job/abc123" -> "abc123")
 */
function extractAgentJobId(branchName) {
  if (!branchName) return null;
  if (branchName.startsWith('agent-job/')) return branchName.slice(10);
  // Backwards compatibility with old job/ prefix
  if (branchName.startsWith('job/')) return branchName.slice(4);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleCreateAgentJob(request) {
  const body = await request.json();
  const { agent_job } = body;
  if (!agent_job) return Response.json({ error: 'Missing agent_job field' }, { status: 400 });

  try {
    const result = await createAgentJob(agent_job, {
      llmModel: body.llm_model,
      agentBackend: body.agent_backend,
      scope: body.scope,
      userId: body.user_id,
    });
    return Response.json(result);
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Failed to create agent job' }, { status: 500 });
  }
}

async function handleGetAgentSecret(request) {
  const record = verifyApiKey(request.headers.get('x-api-key'));
  if (record.type !== 'agent_job_api_key') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rawKey = new URL(request.url).searchParams.get('key');
  if (!rawKey) return Response.json({ error: 'Missing key' }, { status: 400 });
  const key = rawKey.toUpperCase();

  const { getAgentJobSecretRaw, setAgentJobSecret: saveSecret } = await import('../lib/db/config.js');
  const raw = getAgentJobSecretRaw(key);
  if (!raw) return Response.json({ error: 'Not found' }, { status: 404 });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Plain string
    return Response.json({ value: raw });
  }

  if (parsed.type === 'oauth2') {
    // Serialize refresh per key — prevents concurrent requests from racing on token rotation
    if (!_refreshLocks.has(key)) _refreshLocks.set(key, Promise.resolve());
    let release;
    const gate = new Promise((r) => { release = r; });
    const prev = _refreshLocks.get(key);
    _refreshLocks.set(key, gate);
    await prev;

    try {
      // Re-read after acquiring lock — previous request may have already refreshed
      const freshRaw = getAgentJobSecretRaw(key);
      const freshParsed = freshRaw ? JSON.parse(freshRaw) : parsed;

      const { refreshOAuthToken } = await import('../lib/oauth/helper.js');
      const newToken = await refreshOAuthToken({
        refreshToken: freshParsed.token.refresh_token,
        clientId: freshParsed.clientId,
        clientSecret: freshParsed.clientSecret,
        tokenUrl: freshParsed.tokenUrl,
      });
      // Persist updated token (refresh token may have rotated)
      saveSecret(key, JSON.stringify({ ...freshParsed, token: { ...freshParsed.token, ...newToken } }), 'refresh');
      return Response.json({ value: newToken.access_token });
    } catch (err) {
      console.error(`[secrets] OAuth refresh failed for "${key}":`, err.message);
      return Response.json({ error: `OAuth refresh failed: ${err.message}` }, { status: 502 });
    } finally {
      release();
    }
  }
  if (parsed.type === 'oauth_token') {
    return Response.json({ value: JSON.stringify(parsed.token) });
  }
  // Unknown structured value — return raw
  return Response.json({ value: raw });
}

async function handleListUsers() {
  const users = getAllUsers();
  const enriched = users.map((u) => {
    const channels = getVerifiedChannels(u.id).map((c) => c.channel);
    return {
      id: u.id,
      email: u.email,
      first_name: u.firstName,
      last_name: u.lastName,
      nickname: u.nickname,
      role: u.role,
      channels,
    };
  });
  return Response.json({ users: enriched });
}

/**
 * Push a stored message to the recipient's default channel.
 * On success: stamp `deliveredAt`. On failure: log; row stays undelivered.
 * When `systemMessage` is true, channels with `systemMessagesEnabled=0` are skipped
 * (the inbox row stays — only the channel push is muted).
 * Best-effort, async — caller does not await.
 */
async function pushToDefaultChannel(row, { systemMessage = false } = {}) {
  try {
    const verified = getVerifiedChannels(row.userId);
    if (verified.length === 0) return; // No channel — row remains in inbox only
    const target = verified[0]; // Ordered by verifiedAt ASC; first verified is default

    if (systemMessage && target.systemMessagesEnabled === 0) return;

    if (target.channel === 'telegram') {
      const botToken = getTelegramBotToken();
      if (!botToken) {
        console.error(`[pushToDefaultChannel] Telegram token not configured for user ${row.userId}`);
        return;
      }
      const adapter = getTelegramAdapter(botToken);
      await adapter.sendResponse(target.channelChatId, row.content, { chatId: target.channelChatId });
      markDelivered(row.id);
    } else if (target.channel === 'slack') {
      const creds = getSlackCredentials();
      if (!creds) {
        console.error(`[pushToDefaultChannel] Slack credentials not configured for user ${row.userId}`);
        return;
      }
      const adapter = getSlackAdapter(creds.botToken, creds.signingSecret);
      await adapter.sendResponse(target.channelChatId, row.content, {});
      markDelivered(row.id);
    } else if (target.channel === 'teams') {
      const creds = getTeamsCredentials();
      if (!creds) {
        console.error(`[pushToDefaultChannel] Teams credentials not configured for user ${row.userId}`);
        return;
      }
      // System pushes need a serviceUrl, which is per-conversation. We persist
      // the last-seen serviceUrl in the user_channels metadata on each inbound
      // message; if absent, skip (the user must message the bot first).
      const serviceUrl = target.serviceUrl;
      if (!serviceUrl) {
        console.warn(`[pushToDefaultChannel] Teams serviceUrl not yet captured for user ${row.userId} — skipping push`);
        return;
      }
      const adapter = getTeamsAdapter(creds.appId, creds.appPassword);
      await adapter.sendResponse(target.channelChatId, row.content, { serviceUrl });
      markDelivered(row.id);
    }
  } catch (err) {
    console.error(`[pushToDefaultChannel] failed for user ${row.userId}:`, err.message);
  }
}

/**
 * Dispatch a message: store + deliver.
 *  - userId set → 1 row to that user, pushed to their default channel.
 *  - userId absent → fan-out: 1 row per admin where subscribedToSystemMessages=1, each pushed.
 * `systemMessage` (default false) marks the message as a system notification (e.g. github webhook);
 * channels with `systemMessagesEnabled=0` will not receive the push, but the inbox row is always written.
 * Returns the count of rows written.
 */
function dispatchMessage({ userId, content, payload, systemMessage = false }) {
  const recipients = userId ? [userId] : getSubscribedAdminIds();
  const rows = recipients.map((uid) => createSystemMessage(uid, content, payload));
  // Fire-and-forget delivery; deliveredAt updated per row when each push lands.
  for (const row of rows) {
    pushToDefaultChannel(row, { systemMessage });
  }
  return rows.length;
}

async function handleSendDm(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { user_id, message, payload, system_message } = body;
  if (!message || typeof message !== 'string') {
    return Response.json({ error: 'Missing message' }, { status: 400 });
  }

  if (user_id) {
    const user = getUserById(user_id);
    if (!user) return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const count = dispatchMessage({
    userId: user_id || null,
    content: message,
    payload,
    systemMessage: system_message === true,
  });
  return Response.json({ ok: true, recipients: count });
}

async function handleListAgentSecrets(request) {
  const record = verifyApiKey(request.headers.get('x-api-key'));
  if (record.type !== 'agent_job_api_key') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { listAgentJobSecrets } = await import('../lib/db/config.js');
  return Response.json({ secrets: listAgentJobSecrets() });
}

async function handleTelegramWebhook(request) {
  const botToken = getTelegramBotToken();
  if (!botToken) return Response.json({ ok: true });

  const adapter = getTelegramAdapter(botToken);
  const normalized = await adapter.receive(request);
  if (!normalized) return Response.json({ ok: true });

  // Process message asynchronously (don't block the webhook response)
  processChannelMessage(adapter, normalized).catch((err) => {
    console.error('Failed to process message:', err);
  });

  return Response.json({ ok: true });
}

async function handleSlackWebhook(request) {
  const creds = getSlackCredentials();
  if (!creds) return Response.json({ ok: true });

  const adapter = getSlackAdapter(creds.botToken, creds.signingSecret);
  const normalized = await adapter.receive(request);
  if (!normalized) return Response.json({ ok: true });

  // Slack URL verification — must echo the challenge synchronously.
  if (normalized.metadata?.__urlVerification) {
    return Response.json({ challenge: normalized.metadata.challenge });
  }

  processChannelMessage(adapter, normalized).catch((err) => {
    console.error('Failed to process Slack message:', err);
  });

  return Response.json({ ok: true });
}

async function handleTeamsWebhook(request) {
  const creds = getTeamsCredentials();
  if (!creds) return Response.json({ ok: true });

  const adapter = getTeamsAdapter(creds.appId, creds.appPassword);
  const normalized = await adapter.receive(request);
  if (!normalized) return Response.json({ ok: true });

  processChannelMessage(adapter, normalized).catch((err) => {
    console.error('Failed to process Teams message:', err);
  });

  return Response.json({ ok: true });
}

/**
 * Resolve the incoming channel message to a user, dispatch any slash command,
 * and otherwise stream the message through the AI layer using the user's
 * active session.
 */
async function processChannelMessage(adapter, normalized) {
  const { channel, channelChatId, metadata } = normalized;
  const binding = getByChannelChatId(channel, channelChatId);

  // Unbound chat → only /verify is accepted; everything else is silently ignored.
  if (!binding || !binding.verifiedAt) {
    const result = await dispatchPreAuthCommand(normalized, { channel, channelChatId });
    if (result?.handled) {
      await adapter.sendResponse(channelChatId, result.reply, metadata);
    }
    return;
  }

  const ctx = { channel, channelChatId, userId: binding.userId };

  // Post-auth slash commands short-circuit the AI path.
  const cmd = await dispatchCommand(normalized, ctx);
  if (cmd?.handled) {
    await adapter.sendResponse(channelChatId, cmd.reply, metadata);
    return;
  }

  await adapter.acknowledge(metadata);
  const stopIndicator = adapter.startProcessingIndicator(metadata);

  try {
    let threadId = binding.activeThreadId;
    if (!threadId) {
      threadId = randomUUID();
      setActiveThread(binding.userId, channel, threadId);
    }

    const envRepo = process.env.GH_OWNER && process.env.GH_REPO
      ? `${process.env.GH_OWNER}/${process.env.GH_REPO}`
      : '';
    const channelLabel = channel.charAt(0).toUpperCase() + channel.slice(1);
    const streamOptions = {
      userId: binding.userId,
      chatTitle: channelLabel,
      repo: envRepo,
      branch: 'main',
      codeMode: false,
      codeModeType: 'code',
    };

    if (adapter.streamChatResponse) {
      const chunks = chatStream(threadId, normalized.text, normalized.attachments, streamOptions);
      await adapter.streamChatResponse(channelChatId, chunks);
    } else {
      const response = await chat(threadId, normalized.text, normalized.attachments, streamOptions);
      await adapter.sendResponse(channelChatId, response, metadata);
    }
  } catch (err) {
    console.error('Failed to process message with AI:', err);
    await adapter
      .sendResponse(channelChatId, 'Sorry, I encountered an error processing your message.', metadata)
      .catch(() => {});
  } finally {
    stopIndicator();
  }
}

async function handleGithubWebhook(request) {
  const GH_WEBHOOK_SECRET = getConfig('GH_WEBHOOK_SECRET');

  // Validate webhook secret (timing-safe, required)
  if (!GH_WEBHOOK_SECRET || !safeCompare(request.headers.get('x-github-webhook-secret-token'), GH_WEBHOOK_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await request.json();
  const agentJobId = payload.agent_job_id || payload.job_id || extractAgentJobId(payload.branch);
  if (!agentJobId) return Response.json({ ok: true, skipped: true, reason: 'not an agent job' });

  try {
    // Fetch log from repo via API (no longer sent in payload)
    let log = payload.log || '';
    if (!log) {
      log = await fetchAgentJobLog(agentJobId, payload.commit_sha);
    }

    const results = {
      job: payload.job || '',
      pr_url: payload.pr_url || payload.run_url || '',
      run_url: payload.run_url || '',
      status: payload.status || '',
      merge_result: payload.merge_result || '',
      log,
      changed_files: payload.changed_files || [],
      commit_message: payload.commit_message || '',
    };

    const message = await summarizeAgentJob(results);
    const recipientUserId = payload.user_id || null;
    const count = dispatchMessage({
      userId: recipientUserId,
      content: message,
      payload,
    });

    console.log(`Notified ${count} recipient(s) for agent-job ${agentJobId.slice(0, 8)}${recipientUserId ? ` (user ${recipientUserId.slice(0, 8)})` : ' (broadcast)'}`);

    return Response.json({ ok: true, notified: true, recipients: count });
  } catch (err) {
    console.error('Failed to process GitHub webhook:', err);
    return Response.json({ error: 'Failed to process webhook' }, { status: 500 });
  }
}

async function handleAgentJobStatus(request) {
  try {
    const url = new URL(request.url);
    const agentJobId = url.searchParams.get('agent_job_id') || url.searchParams.get('job_id');
    const result = await getAgentJobStatus(agentJobId);
    return Response.json(result);
  } catch (err) {
    console.error('Failed to get agent job status:', err);
    return Response.json({ error: 'Failed to get agent job status' }, { status: 500 });
  }
}

async function handleOAuthCallback(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    const desc = url.searchParams.get('error_description') || error;
    return oauthResultPage(false, desc);
  }

  if (!code || !stateParam) {
    return oauthResultPage(false, 'Missing code or state parameter.');
  }

  try {
    const state = parseOAuthState(stateParam);
    const redirectUri = `${process.env.AUTH_URL}/api/oauth/callback`;

    const tokenData = await exchangeCodeForToken({
      code,
      clientId: state.clientId,
      clientSecret: state.clientSecret,
      tokenUrl: state.tokenUrl,
      redirectUri,
    });

    // Save token with typed wrapper so the API can auto-refresh on fetch
    const secretType = state.secretType || 'oauth2';
    let stored;
    if (secretType === 'oauth_token') {
      stored = JSON.stringify({ type: 'oauth_token', token: tokenData });
    } else {
      stored = JSON.stringify({
        type: 'oauth2',
        token: tokenData,
        clientId: state.clientId,
        clientSecret: state.clientSecret,
        tokenUrl: state.tokenUrl,
      });
    }
    setAgentJobSecret(state.secretName, stored, 'oauth');

    return oauthResultPage(true, state.secretName);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return oauthResultPage(false, err.message || 'Token exchange failed.');
  }
}

function oauthResultPage(success, detail) {
  const safe = String(detail).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const messagePayload = JSON.stringify({ type: success ? 'oauth-success' : 'oauth-error', detail: safe });
  const fallback = success
    ? `Token saved as <strong>${safe}</strong>. You can close this tab and return to settings.`
    : `Error: ${safe}`;

  const html = `<!DOCTYPE html><html><head><title>OAuth ${success ? 'Success' : 'Error'}</title></head><body>
<script>
  if (window.opener) {
    window.opener.postMessage(${messagePayload}, window.location.origin);
    window.close();
  } else {
    document.body.innerHTML = '<p style="font-family:sans-serif;padding:2rem;">${fallback.replace(/'/g, "\\'")}</p>';
  }
</script>
<noscript><p style="font-family:sans-serif;padding:2rem;">${fallback}</p></noscript>
</body></html>`;
  return new Response(html, { status: success ? 200 : 400, headers: { 'Content-Type': 'text/html' } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Next.js Route Handlers (catch-all)
// ─────────────────────────────────────────────────────────────────────────────

async function POST(request) {
  const url = new URL(request.url);
  const routePath = url.pathname.replace(/^\/api/, '');

  // Auth check
  const authError = checkAuth(routePath, request);
  if (authError) return authError;

  // Fire triggers (non-blocking)
  try {
    const fireTriggers = getFireTriggers();
    // Clone request to read body for triggers without consuming it for the handler
    const clonedRequest = request.clone();
    const body = await clonedRequest.json().catch(() => ({}));
    const query = Object.fromEntries(url.searchParams);
    const headers = Object.fromEntries(request.headers);
    fireTriggers(routePath, body, query, headers);
  } catch (e) {
    // Trigger errors are non-fatal
  }

  // Cluster role webhooks
  const clusterMatch = routePath.match(/^\/cluster\/([a-f0-9-]+)\/role\/([a-f0-9-]+)\/webhook$/);
  if (clusterMatch) {
    const { handleClusterWebhook } = await import('../lib/cluster/runtime.js');
    return handleClusterWebhook(clusterMatch[1], clusterMatch[2], request);
  }

  // Route to handler
  switch (routePath) {
    case '/create-agent-job':     return handleCreateAgentJob(request);
    case '/send-dm':              return handleSendDm(request);
    case '/telegram/webhook':   return handleTelegramWebhook(request);
    case '/slack/events':       return handleSlackWebhook(request);
    case '/teams/events':       return handleTeamsWebhook(request);
    case '/github/webhook':     return handleGithubWebhook(request);
    default:                    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

async function GET(request) {
  const url = new URL(request.url);
  const routePath = url.pathname.replace(/^\/api/, '');

  // Auth check
  const authError = checkAuth(routePath, request);
  if (authError) return authError;

  switch (routePath) {
    case '/ping':               return Response.json({ message: 'Pong!' });
    case '/agent-jobs/status':  return handleAgentJobStatus(request);
    case '/get-agent-job-secret':     return handleGetAgentSecret(request);
    case '/agent-job-list-secrets':  return handleListAgentSecrets(request);
    case '/users':              return handleListUsers();
    case '/oauth/callback':     return handleOAuthCallback(request);
    default:                    return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

export { GET, POST };
