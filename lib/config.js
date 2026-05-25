/**
 * Config resolver. Reads from DB, falls back to defaults.
 *
 * Usage:
 *   import { getConfig } from '../config.js';
 *   const provider = getConfig('LLM_PROVIDER');    // DB → 'anthropic'
 *   const apiKey = getConfig('ANTHROPIC_API_KEY');  // DB secret → undefined
 */

import { getConfigValue, getConfigSecret, getCustomProvider } from './db/config.js';
import { getOAuthTokenCount, getNextOAuthToken } from './db/oauth-tokens.js';
import { BUILTIN_PROVIDERS, getDefaultModel } from './llm-providers.js';

// Keys that are stored encrypted in DB
const SECRET_KEYS = new Set([
  'GH_TOKEN',
  'GH_WEBHOOK_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'DEEPSEEK_API_KEY',
  'MINIMAX_API_KEY',
  'MISTRAL_API_KEY',
  'XAI_API_KEY',
  'OPENROUTER_API_KEY',
  'NVIDIA_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'ASSEMBLYAI_API_KEY',
  'TEAMS_APP_ID',
  'TEAMS_APP_PASSWORD',
  'TEAMS_TENANT_ID',
]);

// Keys that are stored as plain config in DB
const CONFIG_KEYS = new Set([
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_MAX_TOKENS',
  'AGENT_BACKEND',
  'CUSTOM_OPENAI_BASE_URL',
  'UPGRADE_INCLUDE_BETA',
  'CODING_AGENT',
  'CODING_AGENT_CLAUDE_CODE_ENABLED',
  'CODING_AGENT_CLAUDE_CODE_AUTH',
  'CODING_AGENT_CLAUDE_CODE_BACKEND',
  'CODING_AGENT_CLAUDE_CODE_MODEL',
  'CODING_AGENT_PI_ENABLED',
  'CODING_AGENT_PI_PROVIDER',
  'CODING_AGENT_PI_MODEL',
  'CODING_AGENT_GEMINI_CLI_ENABLED',
  'CODING_AGENT_GEMINI_CLI_MODEL',
  'CODING_AGENT_CODEX_CLI_ENABLED',
  'CODING_AGENT_CODEX_CLI_AUTH',
  'CODING_AGENT_CODEX_CLI_MODEL',
  'CODING_AGENT_OPENCODE_ENABLED',
  'CODING_AGENT_OPENCODE_PROVIDER',
  'CODING_AGENT_OPENCODE_MODEL',
  'CODING_AGENT_KIMI_CLI_ENABLED',
  'CODING_AGENT_KIMI_CLI_PROVIDER',
  'CODING_AGENT_KIMI_CLI_MODEL',
  'AGENT_MODE_BRANCH',
  'CODE_MODE_BRANCH',
  'AGENT_MODE_GIT_ACTION',
  'CODE_MODE_GIT_ACTION',
  'AGENT_MODE_AUTO_RUN',
  'CODE_MODE_AUTO_RUN',
  'TELEGRAM_WEBHOOK_URL',
]);

// Default values
const DEFAULTS = {
  LLM_PROVIDER: 'anthropic',
  LLM_MAX_TOKENS: '4096',
  UPGRADE_INCLUDE_BETA: 'false',
  CODING_AGENT: 'claude-code',
  CODING_AGENT_CLAUDE_CODE_ENABLED: 'true',
  CODING_AGENT_CLAUDE_CODE_AUTH: 'oauth',
  CODING_AGENT_PI_ENABLED: 'false',
  CODING_AGENT_GEMINI_CLI_ENABLED: 'false',
  CODING_AGENT_CODEX_CLI_ENABLED: 'false',
  CODING_AGENT_CODEX_CLI_AUTH: 'api-key',
  CODING_AGENT_OPENCODE_ENABLED: 'false',
  CODING_AGENT_KIMI_CLI_ENABLED: 'false',
  AGENT_MODE_BRANCH: 'default',
  CODE_MODE_BRANCH: 'dynamic',
  AGENT_MODE_GIT_ACTION: 'pull-push',
  CODE_MODE_GIT_ACTION: 'create-pr',
  AGENT_MODE_AUTO_RUN: 'true',
  CODE_MODE_AUTO_RUN: 'false',
};

/**
 * Get a config value. Resolution: DB → default.
 * @param {string} key
 * @returns {string|undefined}
 */
export function getConfig(key) {
  let value;

  // OAuth tokens: multi-token support with LRU rotation
  if (key === 'CLAUDE_CODE_OAUTH_TOKEN') {
    return getOAuthTokenCount('claudeCode') > 0 ? getNextOAuthToken('claudeCode') : null;
  }
  if (key === 'CODEX_OAUTH_TOKEN') {
    return getOAuthTokenCount('codex') > 0 ? getNextOAuthToken('codex') : null;
  }

  // Check if this is a custom provider's API key
  if (key === 'CUSTOM_API_KEY') {
    const providerSlug = getConfig('LLM_PROVIDER');
    if (providerSlug && !BUILTIN_PROVIDERS[providerSlug]) {
      const custom = getCustomProvider(providerSlug);
      value = custom?.apiKey || undefined;
    }
  }
  // Try DB (secret or plain config)
  else if (SECRET_KEYS.has(key)) {
    value = getConfigSecret(key) || undefined;
  } else if (CONFIG_KEYS.has(key)) {
    value = getConfigValue(key) || undefined;
  }

  // Infrastructure keys: fall back to .env (these live in .env, not exclusively in DB)
  if (value === undefined) {
    const ENV_KEYS = [
      'GH_OWNER',
      'GH_REPO',
      'GH_TOKEN',
      'APP_URL',
      'APP_HOSTNAME',
    ];
    if (ENV_KEYS.includes(key)) {
      value = process.env[key];
    }
  }

  // Fall back to defaults
  if (value === undefined && key in DEFAULTS) {
    value = DEFAULTS[key];
  }

  // Special default: LLM_MODEL depends on LLM_PROVIDER
  if (value === undefined && key === 'LLM_MODEL') {
    const provider = getConfig('LLM_PROVIDER');
    value = getDefaultModel(provider);
  }

  return value;
}
