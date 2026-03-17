/**
 * Config target mapping — single source of truth for where each config key goes.
 *
 * `env: true` — written to .env
 * `db: true` — stored as plain config in DB
 * `dbSecret: true` — stored encrypted in DB
 * `secret: true` — GitHub secret name === env key name
 * `secret: 'NAME'` — GitHub secret uses a different name
 * `variable: true` — GitHub repository variable
 * `default` — default value for firstRunOnly variables
 * `firstRunOnly: true` — only set on GitHub during first-time setup
 *
 * Only keys present in `collected` are synced — absent keys are untouched.
 * Empty string values write to .env but do NOT set as GitHub secrets.
 */
export const CONFIG_TARGETS = {
  // Secrets → DB encrypted (never .env)
  GH_TOKEN:              { env: true, dbSecret: true, secret: 'AGENT_GH_TOKEN' },
  ANTHROPIC_API_KEY:     { dbSecret: true, secret: 'AGENT_ANTHROPIC_API_KEY' },
  OPENAI_API_KEY:        { dbSecret: true, secret: 'AGENT_OPENAI_API_KEY' },
  GOOGLE_API_KEY:        { dbSecret: true, secret: 'AGENT_GOOGLE_API_KEY' },
  NOVITA_API_KEY:        { dbSecret: true, secret: 'AGENT_NOVITA_API_KEY' },
  CUSTOM_API_KEY:        { dbSecret: true, secret: 'AGENT_CUSTOM_API_KEY' },
  CLAUDE_CODE_OAUTH_TOKEN: { dbSecret: true, secret: 'AGENT_CLAUDE_CODE_OAUTH_TOKEN' },
  GH_WEBHOOK_SECRET:     { dbSecret: true, secret: true },
  TELEGRAM_BOT_TOKEN:    { dbSecret: true },
  TELEGRAM_WEBHOOK_SECRET: { dbSecret: true },

  // Plain config → DB (not .env)
  LLM_PROVIDER:          { db: true, variable: true },
  LLM_MODEL:             { db: true, variable: true },
  OPENAI_BASE_URL:       { db: true, variable: true },
  AGENT_BACKEND:         { db: true, variable: true },
  TELEGRAM_CHAT_ID:      { db: true },
  TELEGRAM_VERIFICATION: { db: true },

  // Infrastructure → .env only (needed before DB is available)
  GH_OWNER:              { env: true },
  GH_REPO:               { env: true },
  APP_URL:               { env: true, variable: true },
  APP_HOSTNAME:          { env: true },

  // GitHub-only
  BRAVE_API_KEY:         { secret: 'AGENT_LLM_BRAVE_API_KEY' },
  AUTO_MERGE:            { variable: true, default: 'true', firstRunOnly: true },
  ALLOWED_PATHS:         { variable: true, default: '/logs', firstRunOnly: true },
  RUNS_ON:               { variable: true },
};
