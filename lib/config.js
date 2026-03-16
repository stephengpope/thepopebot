/**
 * Config resolver. Reads from DB first, falls back to process.env, then defaults.
 * In-memory cache with 60-second TTL.
 *
 * Usage:
 *   import { getConfig } from '../config.js';
 *   const provider = getConfig('LLM_PROVIDER');    // DB → env → 'anthropic'
 *   const apiKey = getConfig('ANTHROPIC_API_KEY');  // DB secret → env → undefined
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
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'ASSEMBLYAI_API_KEY',
  'NOVITA_API_KEY',
]);

// Keys that are stored as plain config in DB
const CONFIG_KEYS = new Set([
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_MAX_TOKENS',
  'WEB_SEARCH',
  'AGENT_BACKEND',
  'OPENAI_BASE_URL',
  'TELEGRAM_CHAT_ID',
  'UPGRADE_INCLUDE_BETA',
]);

// Default values
const DEFAULTS = {
  LLM_PROVIDER: 'anthropic',
  LLM_MAX_TOKENS: '4096',
  UPGRADE_INCLUDE_BETA: 'false',
};

// In-memory cache: { key → { value, expiresAt } }
const _cache = new Map();
const CACHE_TTL = 60_000; // 60 seconds

/**
 * Get a config value. Resolution: DB → process.env → default.
 * @param {string} key
 * @returns {string|undefined}
 */
export function getConfig(key) {
  // Check cache first
  const cached = _cache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value;
  }

  let value;

  // Rotatable secrets: managed via their own DB module with multiple named entries
  // and LRU rotation. Each gets a special-case block here that bypasses the cache
  // and SECRET_KEYS flow. To add another rotatable secret:
  //   1. Create lib/db/<name>.js modeled after oauth-tokens.js
  //   2. Add a block here that checks count > 0, returns getNext(), falls back to legacy
  //   3. Remove the key from SECRET_KEYS (it gets custom handling here)
  if (key === 'CLAUDE_CODE_OAUTH_TOKEN') {
    try {
      if (getOAuthTokenCount() > 0) {
        return getNextOAuthToken();
      }
    } catch {
      // Fall through to legacy config_secret / env var
    }
    // Legacy fallback: check config_secret then env var
    value = getConfigSecret(key) || undefined;
    if (value === undefined) value = process.env[key];
    return value;
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

  // Fall back to process.env
  if (value === undefined) {
    value = process.env[key];
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

  // Cache and return
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL });
  return value;
}

/**
 * Invalidate the config cache. Call after any config write.
 */
export function invalidateConfigCache() {
  _cache.clear();
}
