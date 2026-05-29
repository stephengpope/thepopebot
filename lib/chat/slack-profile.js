import { getUserChannel } from '../db/user-channels.js';
import { getConfig } from '../config.js';
import { validateBotToken } from '../tools/slack.js';

/**
 * Build the initial server-rendered state for the Slack profile tab.
 * Returns `{ status: 'unlinked' | 'pending' | 'verified', ...fields, botUsername }`.
 */
export async function getSlackProfileInitial(userId) {
  const row = getUserChannel(userId, 'slack');
  const botToken = getConfig('SLACK_BOT_TOKEN');
  let botUsername = null;
  if (botToken) {
    const info = await validateBotToken(botToken);
    if (info.valid) botUsername = info.botInfo.username;
  }

  if (!row) return { status: 'unlinked', botUsername };
  if (row.verifiedAt) {
    return {
      status: 'verified',
      verifiedAt: row.verifiedAt,
      channelChatId: row.channelChatId,
      systemMessagesEnabled: row.systemMessagesEnabled !== 0,
      botUsername,
    };
  }
  return {
    status: 'pending',
    code: row.code,
    expiresAt: row.codeExpiresAt,
    botUsername,
  };
}
