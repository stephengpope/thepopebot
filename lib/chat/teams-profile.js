import { getUserChannel } from '../db/user-channels.js';
import { getConfig } from '../config.js';

/**
 * Build the initial server-rendered state for the Teams profile tab.
 * Returns `{ status: 'unlinked' | 'pending' | 'verified', ...fields, configured }`.
 *
 * Teams has no equivalent of Slack's bot @username — the bot is identified
 * by its App ID + a Teams manifest the admin must sideload. We just report
 * whether credentials are configured.
 */
export async function getTeamsProfileInitial(userId) {
  const row = getUserChannel(userId, 'teams');
  const appId = getConfig('TEAMS_APP_ID');
  const appPassword = getConfig('TEAMS_APP_PASSWORD');
  const configured = !!(appId && appPassword);

  if (!row) return { status: 'unlinked', configured, appId: appId || null };
  if (row.verifiedAt) {
    return {
      status: 'verified',
      verifiedAt: row.verifiedAt,
      channelChatId: row.channelChatId,
      systemMessagesEnabled: row.systemMessagesEnabled !== 0,
      configured,
      appId: appId || null,
    };
  }
  return {
    status: 'pending',
    code: row.code,
    expiresAt: row.codeExpiresAt,
    configured,
    appId: appId || null,
  };
}
