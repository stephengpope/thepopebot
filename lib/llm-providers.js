/**
 * Built-in LLM provider definitions.
 * Each provider declares its credentials and available models.
 * Imported by config resolver, server actions, and UI.
 */

export const BUILTIN_PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    credentials: [
      { type: 'api_key', key: 'ANTHROPIC_API_KEY', label: 'API Key' },
    ],
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', default: true },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    name: 'OpenAI',
    credentials: [
      { type: 'api_key', key: 'OPENAI_API_KEY', label: 'API Key' },
    ],
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', default: true },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'o3', name: 'o3' },
      { id: 'o4-mini', name: 'o4-mini' },
    ],
  },
  google: {
    name: 'Google',
    credentials: [
      { type: 'api_key', key: 'GOOGLE_API_KEY', label: 'API Key' },
    ],
    models: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', default: true },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
    ],
  },
  novita: {
    name: 'Novita',
    credentials: [
      { type: 'api_key', key: 'NOVITA_API_KEY', label: 'API Key' },
    ],
    models: [
      { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', default: true },
      { id: 'zai-org/glm-5', name: 'GLM-5' },
      { id: 'minimax/minimax-m2.5', name: 'MiniMax M2.5' },
    ],
  },
};

/**
 * Get the default model ID for a built-in provider.
 * @param {string} providerSlug
 * @returns {string|undefined}
 */
export function getDefaultModel(providerSlug) {
  const provider = BUILTIN_PROVIDERS[providerSlug];
  if (!provider) return undefined;
  const defaultModel = provider.models.find((m) => m.default);
  return defaultModel?.id || provider.models[0]?.id;
}

/**
 * Get all credential keys across all built-in providers.
 * @returns {string[]}
 */
export function getAllCredentialKeys() {
  const keys = [];
  for (const provider of Object.values(BUILTIN_PROVIDERS)) {
    for (const cred of provider.credentials) {
      keys.push(cred.key);
    }
  }
  return keys;
}
