import { createHmac, timingSafeEqual } from 'crypto';

const SLACK_API = 'https://slack.com/api';
const MAX_MESSAGE_LENGTH = 40000; // Slack hard limit is 40k chars per message

/**
 * Validate a Slack bot token by calling auth.test.
 * @param {string} botToken - xoxb-... token
 * @returns {Promise<{valid: boolean, botInfo?: object, error?: string}>}
 */
async function validateBotToken(botToken) {
  try {
    const response = await fetch(`${SLACK_API}/auth.test`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const result = await response.json();
    if (result.ok) {
      return {
        valid: true,
        botInfo: {
          teamId: result.team_id,
          team: result.team,
          userId: result.user_id,
          botId: result.bot_id,
          username: result.user,
          url: result.url,
        },
      };
    }
    return { valid: false, error: result.error || 'auth.test failed' };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Verify a Slack request signature.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 * @param {string} signingSecret
 * @param {string} requestBody - Raw request body
 * @param {string} timestamp - x-slack-request-timestamp header
 * @param {string} signature - x-slack-signature header
 * @returns {boolean}
 */
function verifySignature(signingSecret, requestBody, timestamp, signature) {
  if (!signingSecret || !requestBody || !timestamp || !signature) return false;

  // Reject requests older than 5 minutes (replay protection)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${requestBody}`;
  const expected = `v0=${createHmac('sha256', signingSecret)
    .update(sigBasestring, 'utf8')
    .digest('hex')}`;

  const bufA = Buffer.from(expected);
  const bufB = Buffer.from(signature);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Split text into chunks that fit Slack's per-message limit.
 * Prefers paragraph > newline > sentence > space boundaries.
 */
function smartSplit(text, maxLength = MAX_MESSAGE_LENGTH) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    const chunk = remaining.slice(0, maxLength);
    let splitAt = -1;
    for (const delim of ['\n\n', '\n', '. ', ' ']) {
      const idx = chunk.lastIndexOf(delim);
      if (idx > maxLength * 0.3) {
        splitAt = idx + delim.length;
        break;
      }
    }
    if (splitAt === -1) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

/**
 * Send a message to a Slack channel/DM/thread.
 * @param {string} botToken
 * @param {string} channel - Slack channel ID (C…, D…, G…)
 * @param {string} text - Plain text or mrkdwn
 * @param {object} [options]
 * @param {string} [options.threadTs] - Reply in a thread
 * @returns {Promise<object>} chat.postMessage response (last chunk if split)
 */
async function sendMessage(botToken, channel, text, options = {}) {
  const chunks = smartSplit(text);
  let last = null;
  for (const chunk of chunks) {
    const body = {
      channel,
      text: chunk,
      mrkdwn: true,
    };
    if (options.threadTs) body.thread_ts = options.threadTs;
    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) {
      throw new Error(`Slack chat.postMessage failed: ${json.error}`);
    }
    last = json;
  }
  return last;
}

/**
 * Add an emoji reaction to a message.
 * @param {string} botToken
 * @param {string} channel
 * @param {string} timestamp - Message ts
 * @param {string} [name='thumbsup']
 */
async function addReaction(botToken, channel, timestamp, name = 'thumbsup') {
  const res = await fetch(`${SLACK_API}/reactions.add`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, timestamp, name }),
  });
  return res.json();
}

/**
 * Download a file shared in Slack (requires bot token).
 * @param {string} botToken
 * @param {string} urlPrivateDownload - Slack file.url_private_download
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
async function downloadFile(botToken, urlPrivateDownload, filename = 'file') {
  const res = await fetch(urlPrivateDownload, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, filename };
}

/**
 * Set the "is thinking…" status on a Slack Assistant thread (Slack AI Assistant API).
 * No-op if the chat is not an assistant thread — Slack returns an error we swallow.
 * @param {string} botToken
 * @param {string} channelId
 * @param {string} threadTs
 * @param {string} [statusText='is thinking…']
 */
async function setAssistantThreadStatus(botToken, channelId, threadTs, statusText = 'is thinking…') {
  try {
    await fetch(`${SLACK_API}/assistant.threads.setStatus`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel_id: channelId,
        thread_ts: threadTs,
        status: statusText,
      }),
    });
  } catch {
    // Best-effort — ignore failures
  }
}

export {
  validateBotToken,
  verifySignature,
  sendMessage,
  addReaction,
  downloadFile,
  setAssistantThreadStatus,
  smartSplit,
};
