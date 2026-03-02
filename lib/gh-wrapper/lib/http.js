'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Make an HTTP request and return { status, headers, body }.
 * body is the raw response text.
 */
function request(method, urlStr, bodyObj, extraHeaders) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const bodyStr = bodyObj !== null && bodyObj !== undefined
      ? JSON.stringify(bodyObj)
      : null;

    const headers = Object.assign(
      { 'Content-Type': 'application/json', Accept: 'application/json' },
      extraHeaders || {}
    );
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method,
      headers,
    };

    const req = transport.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Make an authenticated Gitea API request.
 * Throws on 4xx/5xx.
 * Returns parsed JSON (or null for empty responses).
 */
async function giteaRequest(method, url, body, token) {
  const res = await request(method, url, body, {
    Authorization: `token ${token}`,
  });
  if (res.status >= 400) {
    let msg = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(res.body);
      if (parsed.message) msg += `: ${parsed.message}`;
    } catch { /* use raw */ }
    const err = new Error(msg);
    err.status = res.status;
    err.body = res.body;
    throw err;
  }
  if (!res.body || !res.body.trim()) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return res.body;
  }
}

/**
 * Read stdin fully as a string.
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

module.exports = { request, giteaRequest, readStdin };
