# My Agent

## Overview

This is an autonomous AI agent powered by [thepopebot](https://github.com/stephengpope/thepopebot). It uses a **two-layer architecture**:

1. **Event Handler** — A Next.js server that orchestrates everything: web UI, Telegram chat, cron scheduling, webhook triggers, and job creation.
2. **Docker Agent** — A container that runs the Pi coding agent for autonomous task execution. Each job gets its own branch, container, and PR.

All core logic lives in the `thepopebot` npm package. This project is a scaffolded shell — thin Next.js wiring, user-editable configuration, GitHub Actions workflows, and Docker files. When `thepopebot` is updated, core logic updates automatically via `npm update`; scaffolded files are managed separately via `npx thepopebot init`.

## Directory Structure

```
project-root/
├── CLAUDE.md                          # This file (project documentation)
├── next.config.mjs                    # Next.js config (wraps withThepopebot())
├── instrumentation.js                 # Server startup hook (re-exports from package)
├── middleware.js                       # Auth middleware (re-exports from package)
├── postcss.config.mjs                 # PostCSS / Tailwind CSS config
├── docker-compose.yml                 # Production deployment (Traefik + event-handler + runner)
├── .env                               # API keys and tokens (gitignored)
├── package.json                       # Dependencies
│
├── app/                               # Next.js app directory
│   ├── layout.js                      # Root layout with ThemeProvider
│   ├── page.js                        # Home / chat page
│   ├── globals.css                    # Global styles (CSS variables, light/dark theme)
│   ├── chats/page.js                  # Chat history
│   ├── chat/[chatId]/page.js          # Individual chat
│   ├── crons/page.js                  # Redirect → /settings/crons
│   ├── triggers/page.js               # Redirect → /settings/triggers
│   ├── notifications/page.js          # Job completion notifications
│   ├── login/page.js                  # Login / first-time admin setup
│   ├── swarm/page.js                  # Active/completed job monitor
│   ├── settings/
│   │   ├── layout.js                  # Settings layout wrapper
│   │   ├── page.js                    # Redirects to /settings/crons
│   │   ├── crons/page.js             # View scheduled jobs
│   │   ├── triggers/page.js          # View webhook triggers
│   │   └── secrets/page.js           # API key management
│   ├── stream/chat/route.js           # Chat streaming endpoint (session auth)
│   ├── api/
│   │   ├── [...thepopebot]/route.js   # Catch-all API route (re-exports from package)
│   │   └── auth/[...nextauth]/route.js # NextAuth route handler
│   └── components/                    # Client-side components
│       ├── theme-provider.jsx         # NextThemesProvider wrapper
│       ├── theme-toggle.jsx           # Dark/light mode toggle
│       ├── ascii-logo.jsx             # ASCII art logo
│       ├── login-form.jsx             # Login form
│       ├── setup-form.jsx             # First-time admin setup form
│       └── ui/                        # Reusable UI primitives (button, card, input, label)
│
├── config/                            # Agent configuration (user-editable)
│   ├── SOUL.md                        # Personality, identity, and values
│   ├── EVENT_HANDLER.md               # Event handler LLM system prompt
│   ├── AGENT.md                       # Agent runtime environment docs
│   ├── JOB_SUMMARY.md                 # Prompt for summarizing completed jobs
│   ├── HEARTBEAT.md                   # Self-monitoring / heartbeat behavior
│   ├── PI_SKILL_GUIDE.md             # Guide for creating Pi agent skills
│   ├── CRONS.json                     # Scheduled job definitions
│   └── TRIGGERS.json                  # Webhook trigger definitions
│
├── .github/workflows/                 # GitHub Actions (7 workflows)
│   ├── run-job.yml                    # Triggers on job/* branch → runs Docker agent
│   ├── rebuild-event-handler.yml      # Triggers on push to main → rebuilds server
│   ├── upgrade-event-handler.yml      # Manual → creates PR to upgrade package
│   ├── build-image.yml                # Builds job Docker image to GHCR
│   ├── auto-merge.yml                 # Squash-merges job PRs within ALLOWED_PATHS
│   ├── notify-pr-complete.yml         # Sends job completion notification
│   └── notify-job-failed.yml          # Sends failure notification
│
├── docker/
│   ├── job/                           # Job agent container
│   │   ├── Dockerfile                 # Node.js 22, Pi agent, Chrome deps, GitHub CLI
│   │   └── entrypoint.sh             # Clone repo, build SYSTEM.md, run Pi, create PR
│   └── event-handler/                 # Event handler container
│       ├── Dockerfile                 # Node.js 22, PM2, thepopebot package
│       └── ecosystem.config.cjs       # PM2 config (Next.js on port 80)
│
├── .pi/
│   ├── extensions/
│   │   └── env-sanitizer/             # Filters SECRETS from LLM bash subprocess calls
│   └── skills/                        # Symlinks to active skills
│       ├── llm-secrets/               # Lists available LLM-accessible credentials
│       └── modify-self/               # Skill for modifying agent's own code/config
│
├── pi-skills/                         # All available Pi agent skills (library)
│   ├── brave-search/                  # Web search via Brave Search API
│   ├── browser-tools/                 # Chrome automation via DevTools Protocol
│   ├── youtube-transcript/            # Fetch YouTube video transcripts
│   ├── transcribe/                    # Speech-to-text via Groq Whisper API
│   ├── gccli/                         # Google Calendar CLI
│   ├── gdcli/                         # Google Drive CLI
│   ├── gmcli/                         # Gmail CLI
│   └── vscode/                        # VS Code integration for diffs
│
├── cron/                              # Working directory for command-type cron actions
├── triggers/                          # Working directory for command-type trigger actions
├── logs/                              # Per-job output (logs/<JOB_ID>/job.md + session .jsonl)
└── data/                              # SQLite database (data/thepopebot.sqlite)
```

## Two-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ┌──────────────────┐         ┌──────────────────┐                     │
│  │  Event Handler   │ ──1──►  │     GitHub       │                     │
│  │  (creates job)   │         │ (job/* branch)   │                     │
│  └────────▲─────────┘         └────────┬─────────┘                     │
│           │                            │                               │
│           │                            2 (triggers run-job.yml)        │
│           │                            │                               │
│           │                            ▼                               │
│           │                   ┌──────────────────┐                     │
│           │                   │  Docker Agent    │                     │
│           │                   │  (runs Pi, PRs)  │                     │
│           │                   └────────┬─────────┘                     │
│           │                            │                               │
│           │                            3 (creates PR)                  │
│           │                            │                               │
│           │                            ▼                               │
│           │                   ┌──────────────────┐                     │
│           │                   │     GitHub       │                     │
│           │                   │   (PR opened)    │                     │
│           │                   └────────┬─────────┘                     │
│           │                            │                               │
│           │                            4a (auto-merge.yml)             │
│           │                            4b (notify-pr-complete.yml)     │
│           │                            │                               │
│           5 (notification → web UI     │                               │
│              and Telegram)             │                               │
│           └────────────────────────────┘                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Event Handler** (this Next.js server): Receives requests (web UI, Telegram, webhooks, cron timers), creates jobs by pushing a `job/<uuid>` branch to GitHub, and manages the web interface. All core logic is in the `thepopebot` npm package.

**Docker Agent**: A container spun up by GitHub Actions (`run-job.yml`) that clones the job branch, runs the Pi coding agent with the job prompt, commits results, and opens a PR. Runs autonomously — no user interaction needed.

## Job Lifecycle

1. **Job created** — Event handler calls `createJob()` (via chat, cron, trigger, or API)
2. **Branch pushed** — A `job/<uuid>` branch is created with `logs/<uuid>/job.md` containing the task prompt
3. **Workflow triggers** — `run-job.yml` fires on `job/*` branch creation
4. **Container runs** — Docker agent clones the branch, builds `SYSTEM.md` from `config/SOUL.md` + `config/AGENT.md`, runs Pi with the job prompt, and logs the session to `logs/<uuid>/`
5. **PR created** — Agent commits results and opens a pull request
6. **Auto-merge** — `auto-merge.yml` squash-merges the PR if all changed files fall within `ALLOWED_PATHS` prefixes (default: `/logs`)
7. **Notification** — `notify-pr-complete.yml` sends job results back to the event handler, which creates a notification in the web UI and sends a Telegram message

## Action Types

Both cron jobs and webhook triggers use the same dispatch system. Every action has a `type` field:

| | `agent` (default) | `command` | `webhook` |
|---|---|---|---|
| **Uses LLM** | Yes — spins up Pi in Docker | No | No |
| **Runtime** | Minutes to hours | Milliseconds to seconds | Milliseconds to seconds |
| **Cost** | LLM API calls + GitHub Actions | Free (runs on event handler) | Free (runs on event handler) |
| **Use case** | Tasks that need to think, reason, write code | Shell scripts, file operations | Call external APIs, forward webhooks |

If the task needs to *think*, use `agent`. If it just needs to *do*, use `command`. If it needs to *call an external service*, use `webhook`.

### Agent action
```json
{ "type": "agent", "job": "Analyze the logs and write a summary report" }
```
Creates a Docker Agent job. The `job` string is passed as-is to the LLM as its task prompt.

### Command action
```json
{ "type": "command", "command": "node cleanup.js --older-than 7d" }
```
Runs a shell command on the event handler. Working directory: `cron/` for crons, `triggers/` for triggers.

### Webhook action
```json
{
  "type": "webhook",
  "url": "https://api.example.com/notify",
  "method": "POST",
  "headers": { "Authorization": "Bearer token" },
  "vars": { "source": "my-agent" }
}
```
Makes an HTTP request. `GET` skips the body. `POST` (default) sends `{ ...vars }` or `{ ...vars, data: <incoming payload> }` when triggered by a webhook.

## Cron Jobs

Defined in `config/CRONS.json`, loaded at server startup by `node-cron`.

```json
[
  {
    "name": "Daily Check",
    "schedule": "0 9 * * *",
    "type": "agent",
    "job": "Review recent activity and summarize findings",
    "enabled": true
  },
  {
    "name": "Cleanup Logs",
    "schedule": "0 0 * * 0",
    "type": "command",
    "command": "node cleanup-logs.js --older-than 30d",
    "enabled": true
  }
]
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `schedule` | Yes | Cron expression (e.g., `0 9 * * *` = daily at 9am) |
| `type` | No | `agent` (default), `command`, or `webhook` |
| `job` | For agent | Task prompt passed to the LLM |
| `command` | For command | Shell command (runs in `cron/` directory) |
| `url` | For webhook | Target URL |
| `method` | For webhook | `GET` or `POST` (default: `POST`) |
| `headers` | For webhook | Custom request headers |
| `vars` | For webhook | Key-value pairs merged into request body |
| `enabled` | No | Set `false` to disable (default: `true`) |

## Webhook Triggers

Defined in `config/TRIGGERS.json`, loaded at server startup. Triggers fire on POST requests to watched paths (after auth, before route handler, fire-and-forget).

```json
[
  {
    "name": "GitHub Push",
    "watch_path": "/webhook/github-push",
    "enabled": true,
    "actions": [
      {
        "type": "agent",
        "job": "Review the push to {{body.ref}}: {{body.head_commit.message}}"
      }
    ]
  }
]
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `watch_path` | Yes | URL path to watch (e.g., `/webhook/github-push`) |
| `actions` | Yes | Array of actions to fire (same fields as cron actions) |
| `enabled` | No | Set `false` to disable (default: `true`) |

**Template tokens** for `job` and `command` strings:

| Token | Resolves to |
|-------|-------------|
| `{{body}}` | Entire request body as JSON |
| `{{body.field}}` | Nested field from request body |
| `{{query}}` | All query parameters as JSON |
| `{{query.field}}` | Specific query parameter |
| `{{headers}}` | All request headers as JSON |
| `{{headers.field}}` | Specific request header |

## API Endpoints

All API routes are under `/api/`, handled by the catch-all route at `app/api/[...thepopebot]/route.js`.

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/create-job` | POST | `x-api-key` header | Create a new autonomous agent job |
| `/api/telegram/webhook` | POST | `TELEGRAM_WEBHOOK_SECRET` | Telegram bot webhook |
| `/api/telegram/register` | POST | `x-api-key` header | Register Telegram webhook URL |
| `/api/github/webhook` | POST | `GH_WEBHOOK_SECRET` | Receive notifications from GitHub Actions |
| `/api/jobs/status` | GET | `x-api-key` header | Check status of running/queued jobs |
| `/api/ping` | GET | Public (no auth) | Health check |

**`x-api-key`**: Database-backed API keys generated through the web UI (Settings > Secrets). Keys are SHA-256 hashed for storage and verified with timing-safe comparison. Key format: `tpb_` prefix + 64 hex characters.

## Web Interface

Accessible after login at `APP_URL`. Page shells live in `app/` but all components are imported from the `thepopebot` npm package.

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Chat | AI chat with streaming, file uploads (images, PDFs, text) |
| `/chats` | Chat History | Browse past conversations grouped by date |
| `/chat/[chatId]` | Individual Chat | Resume a specific conversation |
| `/settings/crons` | Crons | View scheduled jobs from CRONS.json |
| `/settings/triggers` | Triggers | View webhook triggers from TRIGGERS.json |
| `/settings/secrets` | Secrets | Generate and manage API keys |
| `/swarm` | Swarm | Monitor active/completed agent jobs, cancel/rerun |
| `/notifications` | Notifications | Job completion alerts with unread badges |
| `/login` | Login | Authentication (first visit shows admin setup form) |

## Authentication

- **NextAuth v5** with Credentials provider (email/password), JWT stored in httpOnly cookies
- **First-time setup**: If no users exist, `/login` shows a setup form to create the admin account
- **Server Actions** (browser UI): All mutations use `requireAuth()` to validate the session
- **API routes** (external callers): Authenticate via `x-api-key` header
- **Chat streaming**: Dedicated route at `/stream/chat` with its own `auth()` session check, separate from the `/api` catch-all
- **`AUTH_SECRET`**: Required env var for session encryption (auto-generated by setup wizard)

## Database

SQLite via Drizzle ORM at `data/thepopebot.sqlite` (override with `DATABASE_PATH` env var). Auto-initialized and auto-migrated on server startup.

| Table | Purpose |
|-------|---------|
| `users` | Admin accounts (email, bcrypt password hash, role) |
| `chats` | Chat sessions (user_id, title, starred, timestamps) |
| `messages` | Chat messages (chat_id, role, content) |
| `notifications` | Job completion notifications (payload JSON, read status) |
| `subscriptions` | Channel subscriptions (platform, channel_id) |
| `settings` | Key-value config store (also stores API keys with SHA-256 hashing) |

**Column naming**: Drizzle schema uses camelCase JS properties mapped to snake_case SQL columns. Example: `createdAt` in code → `created_at` column in SQL.

## GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `run-job.yml` | `job/*` branch created | Runs the Docker agent container with the job prompt |
| `rebuild-event-handler.yml` | Push to `main` | Fast path (build + PM2 reload) or Docker restart if package version changed |
| `upgrade-event-handler.yml` | Manual `workflow_dispatch` | Creates a PR to upgrade the thepopebot package |
| `build-image.yml` | `docker/job/**` changes | Builds and pushes job Docker image to GHCR (only if `JOB_IMAGE_URL` is `ghcr.io/*`) |
| `auto-merge.yml` | Job PR opened | Squash-merges if `AUTO_MERGE` is not `"false"` and all changes are within `ALLOWED_PATHS` |
| `notify-pr-complete.yml` | After `auto-merge.yml` | Gathers job data and sends notification to event handler |
| `notify-job-failed.yml` | `run-job.yml` fails | Sends failure notification to event handler |

## GitHub Secrets & Variables

### Secrets (prefix-based naming)

| Prefix | Purpose | Visible to LLM? | Example |
|--------|---------|------------------|---------|
| `AGENT_` | Protected credentials for Docker agent | No (filtered by env-sanitizer) | `AGENT_GH_TOKEN`, `AGENT_ANTHROPIC_API_KEY` |
| `AGENT_LLM_` | LLM-accessible credentials for Docker agent | Yes | `AGENT_LLM_BRAVE_API_KEY` |
| *(none)* | Workflow-only secrets (never passed to container) | N/A | `GH_WEBHOOK_SECRET` |

`AGENT_*` secrets are collected into a `SECRETS` JSON object by `run-job.yml` (prefix stripped) and exported as env vars in the container. `AGENT_LLM_*` go into `LLM_SECRETS` (prefix stripped) and are not filtered from the LLM's bash environment.

### Repository Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_URL` | Public URL for the event handler | — (required) |
| `AUTO_MERGE` | Set to `"false"` to disable auto-merge of job PRs | Enabled |
| `ALLOWED_PATHS` | Comma-separated path prefixes for auto-merge (e.g., `/logs`). Use `/` for all paths. | `/logs` |
| `JOB_IMAGE_URL` | Docker image for job agent. GHCR URLs trigger automatic builds via `build-image.yml`. | Default thepopebot image |
| `EVENT_HANDLER_IMAGE_URL` | Docker image for event handler | Default thepopebot image |
| `RUNS_ON` | GitHub Actions runner label (e.g., `self-hosted`) | `ubuntu-latest` |
| `LLM_PROVIDER` | LLM provider for Docker agent (`anthropic`, `openai`, `google`) | `anthropic` |
| `LLM_MODEL` | LLM model name for Docker agent | Provider default |

## Environment Variables

### Core

| Variable | Description | Required |
|----------|-------------|----------|
| `APP_URL` | Public URL for webhooks, Telegram, and Traefik hostname | Yes |
| `AUTH_SECRET` | Secret for NextAuth session encryption (auto-generated by setup) | Yes |

### GitHub

| Variable | Description | Required |
|----------|-------------|----------|
| `GH_TOKEN` | GitHub PAT for creating branches/files | Yes |
| `GH_OWNER` | GitHub repository owner | Yes |
| `GH_REPO` | GitHub repository name | Yes |
| `GH_WEBHOOK_SECRET` | Secret for GitHub Actions webhook auth | For notifications |

### Telegram

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from BotFather | For Telegram |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for validating Telegram webhooks | No |
| `TELEGRAM_VERIFICATION` | Verification code for getting chat ID | For setup |
| `TELEGRAM_CHAT_ID` | Default Telegram chat ID for notifications | For Telegram |

### LLM (Event Handler)

| Variable | Description | Required |
|----------|-------------|----------|
| `LLM_PROVIDER` | `anthropic`, `openai`, `google`, or `custom` | No (default: `anthropic`) |
| `LLM_MODEL` | Model name override | No (provider default) |
| `LLM_MAX_TOKENS` | Max tokens for LLM responses | No (default: 4096) |
| `ANTHROPIC_API_KEY` | API key for Anthropic | For anthropic provider |
| `OPENAI_API_KEY` | API key for OpenAI / Whisper voice transcription | For openai provider or voice |
| `OPENAI_BASE_URL` | Custom OpenAI-compatible base URL (e.g., Ollama) | For custom provider |
| `GOOGLE_API_KEY` | API key for Google | For google provider |
| `CUSTOM_API_KEY` | API key for custom OpenAI-compatible provider | For custom provider |

### Infrastructure

| Variable | Description | Required |
|----------|-------------|----------|
| `AUTH_TRUST_HOST` | Trust host header behind reverse proxy (set `true` for Docker/Traefik) | For reverse proxy |
| `DATABASE_PATH` | Override SQLite database location | No (default: `data/thepopebot.sqlite`) |

## Pi Skills

Skills give the Docker Agent additional capabilities. They live in `pi-skills/` and are activated by symlinking into `.pi/skills/`.

**Activating a skill:**
```bash
ln -s ../../pi-skills/brave-search .pi/skills/brave-search
```

**Deactivating a skill:**
```bash
rm .pi/skills/brave-search
```

Each skill has a `SKILL.md` with frontmatter describing its capabilities. The `{{skills}}` variable in markdown config files expands to a bullet list of active skill descriptions.

### Available skills (in `pi-skills/`)

| Skill | Description |
|-------|-------------|
| `brave-search` | Web search and content extraction via Brave Search API |
| `browser-tools` | Interactive browser automation via Chrome DevTools Protocol |
| `youtube-transcript` | Fetch YouTube video transcripts |
| `transcribe` | Speech-to-text via Groq Whisper API |
| `gccli` | Google Calendar CLI |
| `gdcli` | Google Drive CLI |
| `gmcli` | Gmail CLI |
| `vscode` | VS Code integration for diffs |

### Built-in skills (in `.pi/skills/`, always active)

| Skill | Description |
|-------|-------------|
| `llm-secrets` | Lists available LLM-accessible credentials (from `LLM_SECRETS`) |
| `modify-self` | Allows agent to modify its own code, config, personality, crons, and skills |

### Extensions (in `.pi/extensions/`)

| Extension | Description |
|-----------|-------------|
| `env-sanitizer` | Filters `SECRETS` env vars from the LLM's bash subprocess calls, keeping credentials available to SDKs and GitHub CLI but hidden from the LLM |

## Docker Agent Runtime

The job container (`docker/job/Dockerfile`) provides:

- **Node.js 22** (Bookworm Slim)
- **Pi coding agent** (`@mariozechner/pi-coding-agent`)
- **Chrome/Chromium dependencies** (shared libs; actual Chrome installed at runtime by browser-tools skill)
- **Git + GitHub CLI** for repository operations

### Entrypoint flow (`docker/job/entrypoint.sh`)

1. Extract job ID from branch name (`job/<uuid>` → `<uuid>`)
2. Export `SECRETS` and `LLM_SECRETS` JSON objects as individual env vars
3. Configure git identity from GitHub token
4. Clone the job branch into `/job` working directory
5. Install dependencies for each symlinked skill in `.pi/skills/`
6. Start headless Chrome if browser-tools skill is active
7. Build `SYSTEM.md` from `config/SOUL.md` + `config/AGENT.md`
8. Run Pi with `logs/<uuid>/job.md` as the task prompt, logging session to `logs/<uuid>/`
9. Commit all changes and create a pull request

**Working directory**: `/job` (the cloned repo)
**Temp files**: `/job/tmp/` (available inside the container only)
**Session logs**: `logs/<JOB_ID>/` (job.md prompt + .jsonl session log, committed to repo)

## Customization Points

| File | What to customize |
|------|-------------------|
| `config/SOUL.md` | Agent personality, identity, and values — who the agent is |
| `config/EVENT_HANDLER.md` | System prompt for the event handler LLM (supports `{{skills}}`, `{{datetime}}` variables) |
| `config/AGENT.md` | Agent runtime environment documentation |
| `config/JOB_SUMMARY.md` | Prompt template for summarizing completed job results |
| `config/HEARTBEAT.md` | Self-monitoring / heartbeat behavior |
| `config/PI_SKILL_GUIDE.md` | Guide for creating and managing Pi agent skills |
| `config/CRONS.json` | Scheduled job definitions |
| `config/TRIGGERS.json` | Webhook trigger definitions |
| `pi-skills/` | Available Pi agent skills (add, remove, or modify) |
| `.pi/skills/` | Symlinks to activate/deactivate skills |
| `cron/` | Shell scripts for command-type cron actions |
| `triggers/` | Shell scripts for command-type trigger actions |
| `docker/job/Dockerfile` | Job agent container (add system packages, tools) |
| `docker/job/entrypoint.sh` | Container startup flow |
| `app/` | Next.js pages and client components |

### Markdown includes and variables

Config markdown files support includes and built-in variables (processed by the package):

| Syntax | Description |
|--------|-------------|
| `{{ filepath.md }}` | Include another file (relative to project root, recursive with circular detection) |
| `{{datetime}}` | Current ISO timestamp |
| `{{skills}}` | Bullet list of active skill descriptions from `.pi/skills/*/SKILL.md` frontmatter |

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx thepopebot init` | Scaffold or update project — creates missing files, auto-updates managed files, reports drifted user files |
| `npx thepopebot setup` | Interactive setup wizard (API keys, GitHub secrets, Telegram bot) |
| `npx thepopebot setup-telegram` | Reconfigure Telegram webhook only |
| `npx thepopebot reset [file]` | Restore a file to the package default (no args lists available templates) |
| `npx thepopebot diff [file]` | Show differences between project files and package templates |
| `npx thepopebot reset-auth` | Regenerate AUTH_SECRET (invalidates all sessions) |
| `npx thepopebot set-agent-secret <KEY> [VALUE]` | Set a GitHub secret with `AGENT_` prefix and update `.env` |
| `npx thepopebot set-agent-llm-secret <KEY> [VALUE]` | Set a GitHub secret with `AGENT_LLM_` prefix |
| `npx thepopebot set-var <KEY> [VALUE]` | Set a GitHub repository variable |

### Updating thepopebot

```
1. npm update thepopebot         — updates the package
2. npx thepopebot init           — auto-updates managed files, reports drifted user files
3. npx thepopebot diff <file>    — review what changed in a user-editable file
4. npx thepopebot reset <file>   — accept the new template, or manually merge
```

- **Managed files** (workflows, docker-compose, event-handler Dockerfile) are **auto-updated** to match the package.
- **User-editable files** (config, app pages, job Dockerfile) are **never overwritten**. Drifted files are reported.

Use `npx thepopebot init --no-managed` to skip auto-updates of managed files.

## Deployment

Production deployment uses Docker Compose with three services:

1. **Traefik** — Reverse proxy with automatic TLS via Let's Encrypt
2. **Event Handler** — Next.js server running under PM2 (port 80 inside container)
3. **Self-hosted Runner** — GitHub Actions runner for executing `run-job.yml` locally

Key details:
- The event handler container mounts `data/` and `.env` as volumes for persistence
- Set `RUNS_ON` repository variable to `self-hosted` to use the local runner
- Set `AUTH_TRUST_HOST=true` in `.env` when behind a reverse proxy
- TLS certificates are stored in a Docker volume managed by Traefik

See `docker-compose.yml` for the full configuration.
