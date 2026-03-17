/**
 * Provider registry — single source of truth for PI agent LLM providers.
 *
 * "builtin" means PI has a built-in provider (no models.json needed).
 * Non-builtin providers (openai, novita, custom) require a .pi/agent/models.json entry.
 */
export const PROVIDERS = {
  anthropic: {
    label: 'Claude (Anthropic)',
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    keyPage: 'https://platform.claude.com/settings/keys',
    builtin: true,
    oauthSupported: true,
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', default: true },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ],
  },
  openai: {
    label: 'GPT (OpenAI)',
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    keyPrefix: 'sk-',
    keyPage: 'https://platform.openai.com/settings/organization/api-keys',
    builtin: false,
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions',
    models: [
      { id: 'gpt-5.2', name: 'GPT-5.2', default: true },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'o4-mini', name: 'o4-mini' },
    ],
  },
  google: {
    label: 'Gemini (Google)',
    name: 'Google',
    envKey: 'GOOGLE_API_KEY',
    keyPage: 'https://aistudio.google.com/apikey',
    builtin: true,
    models: [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', default: true },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    ],
  },
  novita: {
    label: 'Novita',
    name: 'Novita',
    envKey: 'NOVITA_API_KEY',
    keyPage: 'https://novita.ai/settings/key-management',
    builtin: false,
    baseUrl: 'https://api.novita.ai/openai',
    api: 'openai-completions',
    models: [
      { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', default: true },
      { id: 'zai-org/glm-5', name: 'GLM-5' },
      { id: 'minimax/minimax-m2.5', name: 'MiniMax M2.5' },
    ],
  },
};
