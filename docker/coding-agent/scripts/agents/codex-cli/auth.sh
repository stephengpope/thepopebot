#!/bin/bash
# Codex CLI auth — credentials cached in ~/.codex/auth.json
# Codex does NOT read OPENAI_API_KEY from env, must use `codex login`
if [ -n "$CODEX_OAUTH_TOKEN" ]; then
    mkdir -p ~/.codex
    if CODEX_AUTH_JSON=$(node <<'EOF'
const raw = (process.env.CODEX_OAUTH_TOKEN || '').trim();
let payload = raw;
if (!payload.startsWith('{')) {
  try {
    payload = Buffer.from(payload, 'base64').toString('utf8').trim();
  } catch {}
}

let auth;
try {
  auth = JSON.parse(payload);
} catch {
  console.error('CODEX_OAUTH_TOKEN must contain the full Codex auth.json payload');
  process.exit(1);
}

if (auth.auth_mode === 'apikey' || auth.OPENAI_API_KEY) {
  console.error('CODEX_OAUTH_TOKEN contains API-key auth, not ChatGPT OAuth');
  process.exit(1);
}

const tokens = auth.tokens || {};
if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token || !auth.last_refresh) {
  console.error('CODEX_OAUTH_TOKEN is missing auth.json token fields');
  process.exit(1);
}

process.stdout.write(JSON.stringify({ ...auth, auth_mode: auth.auth_mode || 'chatgpt' }, null, 2));
EOF
    ); then
        printf '%s\n' "$CODEX_AUTH_JSON" > ~/.codex/auth.json
        chmod 600 ~/.codex/auth.json
    else
        exit 1
    fi
elif [ -n "$OPENAI_API_KEY" ]; then
    echo "$OPENAI_API_KEY" | codex login --with-api-key
fi
