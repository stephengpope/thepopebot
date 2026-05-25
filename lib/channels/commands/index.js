import { verifyCommand } from './verify.js';
import { sessionCommand } from './session.js';

const PRE_AUTH = {
  verify: verifyCommand,
};

const POST_AUTH = {
  session: sessionCommand,
};

function parse(text) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('/') && !trimmed.startsWith('!')) return null;
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  return { name: head.toLowerCase(), args: rest };
}

/**
 * Dispatch a pre-auth command. Returns { handled, reply, userId? } or null.
 * Called when the incoming channel chat is not yet bound to a user.
 * Only /verify runs here.
 */
export async function dispatchPreAuthCommand(normalized, ctx) {
  const parsed = parse(normalized.text);
  if (!parsed) return null;
  const handler = PRE_AUTH[parsed.name];
  if (!handler) return null;
  return handler({ args: parsed.args, normalized, ctx });
}

/**
 * Dispatch a post-auth command. Returns { handled, reply } or null.
 * ctx must include { userId, channel, channelChatId }.
 */
export async function dispatchCommand(normalized, ctx) {
  const parsed = parse(normalized.text);
  if (!parsed) return null;
  const handler = POST_AUTH[parsed.name];
  if (!handler) return null;
  return handler({ args: parsed.args, normalized, ctx });
}
