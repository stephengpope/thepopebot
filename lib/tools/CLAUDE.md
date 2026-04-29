# lib/tools/ — External Service Integrations

## docker.js — Container Lifecycle via Unix Socket

Calls Docker Engine API directly through `/var/run/docker.sock` using Node's `http.request()` — does NOT spawn the `docker` CLI.

**Multiplexed exec streams**: Docker's exec attach returns 8-byte framed output: `[type(1B) + padding(3B) + size(4B BE)] + payload`. Type `1` = stdout, `2` = stderr. The parser reads raw Buffers to avoid UTF-8 corruption, then selectively decodes stdout frames.

**`resolveHostPath()`**: Inspects the event-handler container's own mounts to find the `/app` bind mount's host-side source path. Memoized (one Docker inspect call, then cached). Required because the Docker API needs host paths for bind mounts, not container paths. Falls back to the original path when not running in Docker.

**Network auto-detection**: `detectNetwork()` introspects the event-handler container to discover its Docker network. All spawned containers join the same network. Falls back to `bridge` for local dev.

**Image pull on demand**: Checks if image exists locally before pulling. Avoids pre-pulling at startup.

**`buildAgentAuthEnv(agent)`**: Resolves coding agent type → auth environment variables from the settings DB. All credentials come from the DB (`getConfig`, `getCustomProvider`), never `.env` or GitHub secrets. Returns `{ env: string[], backendApi: string }`.

Per-agent resolution paths:

- **`claude-code`** — `CODING_AGENT_CLAUDE_CODE_BACKEND` selects backend. If `anthropic`, picks OAuth (`CLAUDE_CODE_OAUTH_TOKEN` via LRU rotation) or API key (`ANTHROPIC_API_KEY`). For Anthropic-compatible third parties (DeepSeek, MiniMax, Kimi, OpenRouter) sets `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` to the provider's `anthropicEndpoint`. For OpenAI-only builtins or custom providers, routes through the LiteLLM sidecar at `http://litellm:4000` and prefixes the model with the provider key.
- **`pi-coding-agent`, `opencode`, `kimi-cli`** — share a multi-provider pattern. `CODING_AGENT_{AGENT}_PROVIDER` picks anthropic/openai/google/deepseek/minimax/mistral/xai/openrouter/nvidia or a custom provider. Sets the matching `*_API_KEY` (or `CUSTOM_OPENAI_BASE_URL` + `CUSTOM_API_KEY` for custom).
- **`gemini-cli`** — `GOOGLE_API_KEY` only. Backend is always `google`.
- **`codex-cli`** — ChatGPT OAuth (`CODEX_OAUTH_TOKEN`, containing Codex `auth.json`) or API key (`OPENAI_API_KEY`). Backend always `openai`.

OAuth tokens use LRU rotation via `getNextOAuthToken()` (in `lib/db/oauth-tokens.js`) — distributes load across multiple stored tokens and updates `lastUsedAt` on each pick. Refresh-token rotation is handled at retrieval time in `/api/get-agent-job-secret` (under a per-token lock).

## create-agent-job.js — Agent Job Creation

**Structured output for titles**: Uses `model.withStructuredOutput(z.object({ title }))` to force JSON output and avoid thinking-token leaks with extended-thinking models. Two-tier fallback: LLM → truncated description → first non-empty line with markdown heading syntax stripped.

**Git tree construction**: Uses GitHub's Git Data API (not REST content API) to create commits. Builds a tree with `base_tree` to preserve existing files, adding only `logs/{agentJobId}/agent-job.config.json`. This file is the single source of truth for job metadata.

**Local Docker launch**: After pushing the `agent-job/*` branch, launches a Docker container locally (fire-and-forget). Uses a named volume for workspace, cleaned up after container exits.

## github.js — GitHub API & PAT Probing

**Fine-grained PAT access probing**: `/user/repos` shows repos with implicit metadata:read even without write access. To detect actual write access, probes with a dummy ref creation using null SHA (`0000...`). Response `422` (invalid SHA) = has write access. Response `403` = no access. Side-effect-free — nothing is created.

**Agent job status**: Checks for running Docker containers matching the `thepopebot-agent-job-` prefix. Agent jobs run locally, not via GitHub Actions.

## telegram.js — Telegram Bot Integration

**Message splitting** (`smartSplit`): Respects 4096 char limit. Splits at natural boundaries in priority order: paragraph (`\n\n`) > newline > sentence (`. `) > space. Each delimiter must split at >30% of maxLength to be used; otherwise falls back to hard split.

**Markdown → Telegram HTML** (`markdownToTelegramHtml`): Placeholder-based strategy — protects existing HTML tags and code blocks first, escapes remaining HTML chars, converts markdown syntax, then restores placeholders. This prevents markdown interpretation inside code blocks.

**Typing indicator with jitter**: Re-sends typing action at 5.5–8s random intervals (Telegram expires indicators after 5s). Returns a stop function.

## assemblyai.js — Voice Transcription

**Feature flag via API key**: `isAssemblyAIEnabled()` checks if `ASSEMBLYAI_API_KEY` is set. Used by the Telegram adapter to conditionally offer voice transcription. `transcribeAudio(buffer)` uses the official `assemblyai` SDK (`client.transcripts.transcribe`), which handles upload + polling internally. Throws when the transcript status is `'error'`.
