# docker/coding-agent/ — Unified Coding Agent Image

## Architecture

Two axes, both selected at runtime:
- **`RUNTIME`** — the workflow (agent-job, headless, interactive, cluster-worker, command/*)
- **`AGENT`** — the coding agent (claude-code, pi-coding-agent, opencode, codex-cli, gemini-cli, kimi-cli)

Base image (`Dockerfile`) has everything shared. Per-agent images extend it:

```
coding-agent-base                    →  Ubuntu 24.04, Node.js 22, GitHub CLI, ttyd, tmux, Playwright
  ├── Dockerfile.claude-code         →  + Claude Code CLI,  ENV AGENT=claude-code
  ├── Dockerfile.pi-coding-agent     →  + Pi CLI,           ENV AGENT=pi-coding-agent
  ├── Dockerfile.opencode            →  + OpenCode CLI + Bun, ENV AGENT=opencode
  ├── Dockerfile.codex-cli           →  + Codex CLI,        ENV AGENT=codex-cli
  ├── Dockerfile.gemini-cli          →  + Gemini CLI,       ENV AGENT=gemini-cli
  └── Dockerfile.kimi-cli            →  + Kimi CLI,         ENV AGENT=kimi-cli
```

## Naming Convention

**CRITICAL**: The `AGENT` env var, the scripts directory name, the Dockerfile suffix, and the `CODING_AGENT` config value MUST all use the same name. This name appears in:

- `ENV AGENT=<name>` in the Dockerfile
- `scripts/agents/<name>/` directory
- `CODING_AGENT` user config value
- Docker image tag: `coding-agent-<name>-<version>`
- Container name prefix: `<name>-interactive-<shortId>`

If these don't match, the entrypoint can't find scripts, `createTerminalSession()` can't find `start-coding-session.sh`, and container launches fail.

## How It Works

`entrypoint.sh` validates `RUNTIME` + `AGENT`, then sources each numbered script in `/scripts/${RUNTIME}/` sequentially. Runtime scripts handle the workflow (clone, branch, commit, push). At agent-specific steps, they delegate to `/scripts/agents/${AGENT}/` scripts.

```
interactive/1_setup-git.sh       → source common/setup-git.sh          (shared)
interactive/2_clone.sh           → source common/clone.sh              (shared)
interactive/3_feature-branch.sh  → source common/feature-branch.sh     (shared)
interactive/4_agent-auth.sh      → source agents/${AGENT}/auth.sh      (agent-specific)
interactive/5_agent-setup.sh     → source agents/${AGENT}/setup.sh     (agent-specific)
interactive/7_start-interactive.sh → source agents/${AGENT}/interactive.sh (agent-specific)
```

### Command Runtimes

`command/*` runtimes are ephemeral containers that run workspace commands on an existing volume. They don't clone — the workspace already exists.

| Runtime | Purpose |
|---------|---------|
| `command/commit` | Agent stages all changes, reviews diff, writes commit message, commits |
| `command/push` | Agent stages, commits, and pushes the branch to origin |
| `command/create-pr` | Agent ensures changes are committed and pushed, then creates/updates a PR |
| `command/pull` | Agent fetches from origin, rebases onto base branch, resolves any conflicts |

## Adding a New Coding Agent

To integrate a new coding agent, you need:

### 1. Dockerfile (`Dockerfile.<agent-name>`)

Extends the base image. Install the CLI, create any config directories, set `AGENT`.

```dockerfile
ARG BASE_IMAGE=coding-agent-base
FROM ${BASE_IMAGE}

USER root
RUN npm install -g <agent-package>
USER coding-agent

ENV AGENT=<agent-name>
```

If the agent needs additional runtime dependencies (e.g. Bun for OpenCode plugins), install them here.

### 2. Required Scripts (`scripts/agents/<agent-name>/`)

Every agent MUST have these 6 scripts:

#### `auth.sh` — Authentication setup

Called before any agent interaction. Set up credentials so the agent can authenticate non-interactively.

```bash
#!/bin/bash
# Options:
# - Export API keys the agent reads from env (no-op if agent reads env directly)
# - Run a login command (e.g. `echo "$KEY" | agent login --with-api-key`)
# - Swap/unset conflicting env vars
```

Examples:
- **claude-code**: Unsets `ANTHROPIC_API_KEY` when using OAuth so Claude Code uses the OAuth token instead
- **pi-coding-agent**: No-op — Pi reads API keys directly from standard env vars
- **codex-cli**: Writes Codex ChatGPT OAuth `auth.json` when `CODEX_OAUTH_TOKEN` contains that payload, or pipes `OPENAI_API_KEY` into `codex login --with-api-key`

#### `setup.sh` — Agent configuration

Called once per container startup, after auth. Configure the agent so it runs non-interactively:

**Required responsibilities:**
- Write trust/permission config so the agent doesn't prompt interactively
- Write system prompt if `$SYSTEM_PROMPT` is set (clear it if empty)
- Install session tracking mechanism (see Session Tracking below)

**Optional:**
- Generate provider config for custom endpoints
- Set up plugins or extensions

#### `run.sh` — Headless execution

Runs the agent non-interactively with `$PROMPT`. MUST set `AGENT_EXIT` for downstream scripts.

```bash
#!/bin/bash
# Build args for headless run
AGENT_ARGS=(<headless-flag> "$PROMPT" <output-format-flags>)

if [ -n "$LLM_MODEL" ]; then
    AGENT_ARGS+=(<model-flag> "$LLM_MODEL")
fi

# Session continuation (always uses primary port 7681)
SESSION_FILE="/home/coding-agent/.<agent>-ttyd-sessions/7681"
if [ "$CONTINUE_SESSION" = "1" ] && [ -f "$SESSION_FILE" ]; then
    SESSION_ID=$(cat "$SESSION_FILE")
    # Validate session exists, then add resume flag
fi

# Prompt MUST come in the right position for the agent's CLI
AGENT_ARGS+=("$PROMPT")

set +e
<agent-cli> "${AGENT_ARGS[@]}"
AGENT_EXIT=$?
set -e
```

Key requirements:
- `AGENT_EXIT` must be set — downstream scripts use it to decide whether to commit/push
- Headless session file always reads from port `7681` (primary tab)
- `$PROMPT` positioning varies by agent (some need it first, some last)

#### `interactive.sh` — Interactive TUI via ttyd

Starts the agent in tmux, serves via ttyd. This is the primary tab (port 7681).

```bash
#!/bin/bash
AGENT_ARGS="<agent-cli>"
if [ -n "$LLM_MODEL" ]; then
    AGENT_ARGS="$AGENT_ARGS <model-flag> $LLM_MODEL"
fi

# Session resume: read port-keyed session file, validate, add resume flag
SESSION_FILE="/home/coding-agent/.<agent>-ttyd-sessions/${PORT:-7681}"
if [ "$CONTINUE_SESSION" = "1" ] && [ -f "$SESSION_FILE" ]; then
    SESSION_ID=$(cat "$SESSION_FILE")
    # Validate session still exists, then:
    # AGENT_ARGS="$AGENT_ARGS <resume-flag> $SESSION_ID"
fi

# MUST pass PORT to tmux env so session tracking hooks/plugins can read it
tmux -u new-session -d -s <agent> -e PORT="${PORT:-7681}" $AGENT_ARGS
exec ttyd --writable -p "${PORT:-7681}" tmux attach -t <agent>
```

Key requirements:
- **Pass `PORT` into tmux via `-e PORT="${PORT:-7681}"`** — session tracking hooks need this
- tmux session name should be the agent name (e.g. `-s opencode`, `-s pi`)
- ttyd serves on `${PORT:-7681}`

#### `start-coding-session.sh` — Extra terminal tabs

Called by `start-ttyd-session.sh` when the user creates additional terminal tabs. Each tab gets its own PORT (7682, 7683, ...).

```bash
#!/bin/bash
SESSION_NAME="<agent>-${PORT}"

# Already running — just reattach
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    exec tmux attach -t "$SESSION_NAME"
fi

# Build agent args with session resume for this port
SESSION_FILE="/home/coding-agent/.<agent>-ttyd-sessions/${PORT}"
AGENT_ARGS="<agent-cli>"

if [ -f "$SESSION_FILE" ]; then
    SESSION_ID=$(cat "$SESSION_FILE")
    # Validate and add resume flag
fi

# Start tmux session, pass PORT env, set cwd
tmux -u new-session -d -s "$SESSION_NAME" -e PORT="${PORT}" -c /home/coding-agent/workspace $AGENT_ARGS
exec tmux attach -t "$SESSION_NAME"
```

Key requirements:
- tmux session name MUST include PORT to avoid collisions (`<agent>-${PORT}`)
- Check for existing tmux session first (reattach on reconnect)
- Pass `PORT` into tmux env

#### `merge-back.sh` — Conflict resolution

Runs the agent to resolve git merge conflicts after a failed rebase.

```bash
#!/bin/bash
<agent-cli> <headless-flags> "$(cat /home/coding-agent/.claude/commands/ai-merge-back.md)" || exit 1
```

### 3. Register in `bin/docker-build.js`

Add a new entry to `CODING_AGENTS` array so the image gets built.

### 4. Register in `lib/tools/docker.js`

Add auth env var logic in `buildAgentAuthEnv()` for the new agent.

### 5. Register config keys in `lib/config.js`

**CRITICAL**: Add all new config keys to THREE places in `lib/config.js`:

1. **`CONFIG_KEYS` set** — without this, `getConfig()` silently returns `undefined` even though `setConfigValue()` writes to the DB successfully. The write works but the read is gated by this allowlist.
2. **`DEFAULTS` object** — set `CODING_AGENT_<NAME>_ENABLED` default to `'false'`.
3. **`SECRET_KEYS` set** — only if the agent has secret credentials stored in the DB.

For a multi-provider agent, add these keys:
```
CODING_AGENT_<NAME>_ENABLED
CODING_AGENT_<NAME>_PROVIDER
CODING_AGENT_<NAME>_MODEL
```

### 6. Register in settings UI

Add the agent to `lib/chat/components/settings-coding-agents-page.jsx`:
- Add card component (use `OpenCodeCard` as template for multi-provider agents)
- Add `isAgentReady()` function
- Add to the `available` list in `DefaultAgentSection`
- Add to `AgentCards` render

And in `lib/chat/actions.js`:
- Add config reads in `getCodingAgentSettings()`
- Add config writes in `updateCodingAgentConfig()`

## Session Tracking

Session tracking enables `CONTINUE_SESSION=1` — resuming the exact same conversation across container restarts and isolating sessions per terminal tab.

### How it works

Each agent stores a session ID in a port-keyed file:
```
/home/coding-agent/.<agent>-ttyd-sessions/7681   ← primary tab
/home/coding-agent/.<agent>-ttyd-sessions/7682   ← extra tab 1
/home/coding-agent/.<agent>-ttyd-sessions/7683   ← extra tab 2
```

On startup, `interactive.sh` reads the file for its port. If a valid session ID is found, it passes the agent's resume flag. If not, it starts a fresh session.

The session ID is captured via an agent-specific mechanism (hook, plugin, or filesystem), then written to the port-keyed file. The `PORT` env var is the key that ties everything together.

### Session tracking by agent

Each agent has a different mechanism for capturing the session ID. Choose whichever the agent supports:

#### Pattern A: Native hooks (Claude Code, Codex)

The agent has a hooks system that fires on session start. The hook script reads the session ID from stdin or env vars and writes it to the port-keyed file.

**Claude Code** — `SessionStart` hook in `~/.claude/settings.json`:
- Hook receives JSON on stdin with `session_id` field
- Validates session JSONL file exists at `~/.claude/projects/-home-coding-agent-workspace/${SESSION_ID}.jsonl`
- Resume flag: `--resume $SESSION_ID`

**Codex** — `SessionStart` hook in `~/.codex/hooks.json`:
- Requires `codex_hooks = true` feature flag in `~/.codex/config.toml`
- Hook receives JSON on stdin with `session_id` field
- Validates session file exists via `find ~/.codex/sessions -name "*${SESSION_ID}*"`
- Resume: `codex resume $SESSION_ID` (interactive) or `codex exec resume $SESSION_ID` (headless)

#### Pattern B: Plugin system (OpenCode)

The agent has a plugin system with event subscriptions.

**OpenCode** — Server plugin in `.opencode/plugins/`:
- Requires Bun runtime (installed in Dockerfile)
- Plugin registers for catch-all `event` handler (since `session.created` doesn't fire)
- Captures `sessionID` from the first event's `event.properties.sessionID`
- Plugin config in `.opencode/opencode.jsonc`, MCP config stays in root `.opencode.json` (separate files — `opencode.jsonc` rejects unrecognized keys like `mcpServers`)
- Validates via `opencode session list --format json | grep -qF "$SESSION_ID"`
- Resume flag: `--session $SESSION_ID`

#### Pattern C: Per-port session directories (Pi)

The agent has a `--session-dir` flag that controls where sessions are stored.

**Pi** — `--session-dir` with per-port directories:
- No hooks or plugins needed
- Each port gets its own directory: `--session-dir /home/coding-agent/.pi-ttyd-sessions/${PORT}`
- `--continue` (`-c`) resumes the latest session within that isolated directory
- On empty directory, `-c` gracefully creates a new session
- No session ID capture or validation needed — the filesystem IS the mapping

#### Pattern D: AfterAgent hook with file inspection (Gemini)

The agent has hooks but doesn't provide the session ID in env vars or stdin.

**Gemini** — `AfterAgent` hook in `~/.gemini/settings.json`:
- `SessionStart` fires before the session file exists; `AfterAgent` fires after
- Hook finds the most recent session file in `~/.gemini/tmp/workspace/chats/session-*.json`
- Extracts short UUID from filename, resolves full UUID via `gemini --list-sessions`
- Resume flag: `--resume $SESSION_ID`

#### Pattern E: Native hooks (Kimi)

The agent has a hooks system similar to Claude Code.

**Kimi** — `SessionStart` hook in `~/.kimi/config.toml`:
- Hook receives JSON on stdin with `session_id` field
- Writes session ID to `.kimi-ttyd-sessions/${PORT}`
- Resume flag: `--session $SESSION_ID`

### Session validation

Before passing a resume flag, validate the session still exists. If the volume was wiped or the session was deleted, passing a stale ID can cause errors. Each agent validates differently:

| Agent | Validation method |
|-------|-------------------|
| claude-code | `[ -f "~/.claude/projects/.../${SESSION_ID}.jsonl" ]` |
| opencode | `opencode session list --format json \| grep -qF "$SESSION_ID"` |
| pi-coding-agent | Not needed — `--session-dir` + `-c` handles it |
| codex-cli | `find ~/.codex/sessions -name "*${SESSION_ID}*" \| grep -q .` |
| gemini-cli | `gemini --list-sessions \| grep -qF "$SESSION_ID"` |
| kimi-cli | `kimi session list \| grep -qF "$SESSION_ID"` |

### Headless session tracking

Headless `run.sh` always reads from port `7681` (the primary tab's session). This ensures headless runs continue the same conversation as the interactive session.

## Agent Scoping

When `SCOPE` is set (e.g. `SCOPE=agents/triage`), the entrypoint scripts adjust:

- **Working directory** — `cd $WORKSPACE/agents/triage` instead of `$WORKSPACE`. Set up by `scripts/common/scope.sh` (sourced by interactive + headless flows).
- **System prompt resolution** — `agents/triage/SYSTEM.md` is preferred over the default `event-handler/agent-chat/SYSTEM.md`.
- **Skills** — falls back through `agents/triage/skills/` → root `skills/` (handled by the host-side `lib/ai/scope.js`; the container just sees the resolved system prompt + working directory).
- **Session paths** — sessions go under `.{agent}-ttyd-sessions/agents/triage/${PORT}`. This means each scoped agent has an isolated session-file namespace even on the same shared volume.

`SCOPE` is set by `lib/tools/docker.js` when launching agent-job, headless, or interactive containers, based on the workspace's `scope` column or the cron/trigger `scope` field.

## Env Vars

### Required

| Variable | Values | Purpose |
|----------|--------|---------|
| `RUNTIME` | `agent-job`, `headless`, `interactive`, `cluster-worker`, `command/*` | Selects workflow script folder |
| `AGENT` | `claude-code`, `pi-coding-agent`, `opencode`, `codex-cli`, `gemini-cli`, `kimi-cli` | Set by per-agent Dockerfile (not passed at runtime) |

### Git / Repo

| Variable | Used by | Purpose |
|----------|---------|---------|
| `GH_TOKEN` | all | GitHub CLI auth |
| `REPO` | headless, interactive, command/* | GitHub `owner/repo` slug |
| `REPO_URL` | agent-job | Full git clone URL (includes token) |
| `BRANCH` | all | Base branch (default: main) |
| `FEATURE_BRANCH` | headless, interactive, command/* | Feature branch to create/checkout. If empty, skips branching and pushing. |

### Agent Task

| Variable | Purpose |
|----------|---------|
| `PROMPT` | Task prompt passed to agent |
| `SYSTEM_PROMPT` | Optional system prompt (fallback — prefer `/home/coding-agent/SYSTEM.md` file on volume). Each agent handles differently (see setup.sh). |
| `PERMISSION` | `plan` or `code` (default: `code`). Controls permission/approval mode for agents that support it. |
| `CONTINUE_SESSION` | `1` = resume previous session. Requires volume mount at `/home/coding-agent`. |
| `LLM_MODEL` | Model override |

### Interactive Runtime

| Variable | Purpose |
|----------|---------|
| `PORT` | ttyd port (default: 7681). Primary tab uses 7681, extra tabs use 7682+. |

### Job Runtime

| Variable | Purpose |
|----------|---------|
| `AGENT_JOB_TITLE` | PR title and commit message |
| `AGENT_JOB_DESCRIPTION` | PR body and prompt content |
| `AGENT_JOB_ID` | Log directory name (fallback: extracted from branch) |
| `AGENT_JOB_SECRETS` | JSON blob of agent job secrets |

### Cluster-Worker Runtime

| Variable | Purpose |
|----------|---------|
| `LOG_DIR` | Directory for session logs |

## Common Scripts

Shared workflow logic in `scripts/common/`:

| Script | Purpose |
|--------|---------|
| `setup-git.sh` | Derive git identity from `GH_TOKEN` via GitHub API |
| `clone.sh` | Clone repo if workspace is empty, otherwise skip (respects persisted volume state) |
| `feature-branch.sh` | Create/checkout feature branch on fresh clone. Skips if `FEATURE_BRANCH` is empty or branch already exists. |
| `rebase-push.sh` | Commit, rebase onto base branch, push. Used by agent-job runtime only. |
| `start-ttyd-session.sh` | Wraps ttyd for extra terminal tabs: `exec ttyd --writable -p "${PORT}" "$1"` |
| `start-shell-session.sh` | Starts a plain shell terminal via ttyd (no agent). |

## Volume Mounts

Mount at `/home/coding-agent` (not `/home/coding-agent/workspace`) so both workspace files and agent session data persist between container runs. This is required for `CONTINUE_SESSION=1`.

## System Prompt Handling

The event handler pre-renders the system prompt (via `buildCodingAgentSystemPrompt()`) with full template resolution ({{skills}}, {{datetime}}, includes). For interactive/headless containers, it writes to `/home/coding-agent/SYSTEM.md` on the bind-mount volume. For agent-job containers (named volumes), the pre-rendered prompt is stored in `agent-job.config.json` and written to `/home/coding-agent/SYSTEM.md` by `5_build-prompt.sh` after clone. Each agent's `setup.sh` reads the file and distributes it to where the agent expects it.

When an agent scope is set (e.g., `agents/gary-vee`), `buildCodingAgentSystemPrompt()` checks for `agents/gary-vee/SYSTEM.md` first, falling back to `agent-job/SYSTEM.md`.

| Agent | Method |
|-------|--------|
| claude-code | `--append-system-prompt-file /home/coding-agent/SYSTEM.md` in run.sh/interactive.sh |
| pi-coding-agent | Copied to `.pi/SYSTEM.md` in workspace |
| opencode | Copied to `AGENTS.md` in workspace root |
| codex-cli | Copied to `AGENTS.md` in workspace root |
| gemini-cli | Copied to `~/.gemini/SYSTEM.md` + `GEMINI_SYSTEM_MD` env var |
| kimi-cli | Copied to `AGENTS.md` in workspace root |

## Browser Automation

All agents get browser automation via the `playwright-cli` skill in `skills/`. The skill is available to every agent through the skill bridge symlinks (`.claude/skills`, `.pi/skills`, etc. → `../skills/`). The `{{skills}}` template variable resolves the skill description into each agent's system prompt. No per-agent MCP registration needed.
