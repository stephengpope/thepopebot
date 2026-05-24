import { TelegramAdapter } from './telegram.js';
import { SlackAdapter } from './slack.js';
import { TeamsAdapter } from './teams.js';

let _telegramAdapter = null;
let _slackAdapter = null;
let _teamsAdapter = null;

/**
 * Get the Telegram channel adapter (lazy singleton).
 * @param {string} botToken - Telegram bot token
 * @returns {TelegramAdapter}
 */
export function getTelegramAdapter(botToken) {
  if (!_telegramAdapter || _telegramAdapter.botToken !== botToken) {
    _telegramAdapter = new TelegramAdapter(botToken);
  }
  return _telegramAdapter;
}

/**
 * Get the Slack channel adapter (lazy singleton).
 * Re-instantiates if either credential changes.
 * @param {string} botToken - Slack bot user OAuth token (xoxb-...)
 * @param {string} signingSecret - Slack app signing secret
 * @returns {SlackAdapter}
 */
export function getSlackAdapter(botToken, signingSecret) {
  if (
    !_slackAdapter ||
    _slackAdapter.botToken !== botToken ||
    _slackAdapter.signingSecret !== signingSecret
  ) {
    _slackAdapter = new SlackAdapter(botToken, signingSecret);
  }
  return _slackAdapter;
}

/**
 * Get the Microsoft Teams channel adapter (lazy singleton).
 * Re-instantiates if either credential changes.
 * @param {string} appId - Microsoft App (Azure Bot) ID
 * @param {string} appPassword - Microsoft App Password / client secret
 * @returns {TeamsAdapter}
 */
export function getTeamsAdapter(appId, appPassword) {
  if (
    !_teamsAdapter ||
    _teamsAdapter.appId !== appId ||
    _teamsAdapter.appPassword !== appPassword
  ) {
    _teamsAdapter = new TeamsAdapter(appId, appPassword);
  }
  return _teamsAdapter;
}
