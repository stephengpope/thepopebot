# Coding Agents

Coding agents are the AI backends that power code workspaces and agent jobs. They run inside Docker containers and interact with your Git repository — writing code, running commands, creating PRs.

thepopebot supports 5 coding agent backends. Each has its own Docker image and authentication method. You enable and configure them in Admin > Event Handler > Coding Agents.

## Supported Backends

| Backend | Config key | What it is | Auth modes |
|---------|-----------|------------|------------|
| Claude Code | `claude-code` (default) | Anthropic's official CLI agent | OAuth token or API key |
| Pi | `pi` | Third-party agent by @mariozechner | API key (any provider) |
| Gemini CLI | `gemini-cli` | Google's CLI agent | API key (Google) |
| Codex CLI | `codex-cli` | OpenAI's CLI agent | OAuth token or API key |
| OpenCode | `opencode` | Open-source agent | API key (any provider) |

## Configuration

All config is DB-backed. Managed at Admin > Event Handler > Coding Agents.

**Default agent**: `CODING_AGENT` config key (default: `claude-code`). This is what runs when the AI launches a code workspace or agent job.

**Per-agent settings** (each has its own card in the admin UI):
- Enable/disable toggle
- Auth mode (OAuth or API key, where applicable)
- Backend provider (for agents that support multiple LLM providers)
- Model override

Config keys follow the pattern `CODING_AGENT_{BACKEND}_{SETTING}`:

### Claude Code

- `CODING_AGENT_CLAUDE_CODE_ENABLED` (default: `true`)
- `CODING_AGENT_CLAUDE_CODE_AUTH` (default: `oauth`) — `oauth` or `api-key`
- `CODING_AGENT_CLAUDE_CODE_BACKEND` — which LLM provider Claude Code uses (can be non-Anthropic via proxy)
- `CODING_AGENT_CLAUDE_CODE_MODEL` — model override

### Pi

- `CODING_AGENT_PI_ENABLED` (default: `false`)
- `CODING_AGENT_PI_PROVIDER` — LLM provider for Pi
- `CODING_AGENT_PI_MODEL` — model override

### Gemini CLI

- `CODING_AGENT_GEMINI_CLI_ENABLED` (default: `false`)
- `CODING_AGENT_GEMINI_CLI_MODEL` — model override

### Codex CLI

- `CODING_AGENT_CODEX_CLI_ENABLED` (default: `false`)
- `CODING_AGENT_CODEX_CLI_AUTH` (default: `api-key`) — `oauth` or `api-key`
- `CODING_AGENT_CODEX_CLI_MODEL` — model override

### OpenCode

- `CODING_AGENT_OPENCODE_ENABLED` (default: `false`)
- `CODING_AGENT_OPENCODE_PROVIDER` — LLM provider for OpenCode
- `CODING_AGENT_OPENCODE_MODEL` — model override

## OAuth Tokens

Claude Code and Codex CLI support OAuth authentication (subscription-based, not pay-per-token).

**Claude Code OAuth**: Claude Pro ($20/mo) or Max ($100+/mo) subscribers can generate tokens:

```bash
npm install -g @anthropic-ai/claude-code
claude setup-token
```

Token starts with `sk-ant-oat01-`. Add it in Admin > Event Handler > Coding Agents > Claude Code.

**Codex OAuth**: OpenAI subscribers should sign in with ChatGPT using Codex locally:

```bash
codex login
```

Then add the contents of `~/.codex/auth.json` in Admin > Event Handler > LLMs > OpenAI > OAuth Tokens. The Codex container writes this payload to `~/.codex/auth.json`; a single access token is not enough.

**Multi-token rotation**: You can add multiple OAuth tokens. The system uses LRU (least-recently-used) rotation — each container launch picks the token that hasn't been used the longest. This helps distribute usage across subscription accounts.

## Claude Code with Non-Anthropic Providers

Claude Code natively only supports Anthropic models. thepopebot extends this via two routing mechanisms:

**Anthropic-compatible endpoints**: Providers that expose an Anthropic-format API (DeepSeek, MiniMax, Kimi, OpenRouter) can be used directly. The system sets `ANTHROPIC_BASE_URL` to the provider's endpoint.

**LiteLLM proxy**: Providers that only offer OpenAI-format APIs (OpenAI, Google, Mistral, xAI) are routed through the LiteLLM sidecar container that translates between API formats. LiteLLM is included in both the default and SSL Docker Compose configurations.

This means Claude Code can be powered by almost any LLM provider, not just Anthropic.

## Agent Job Secrets

Agent containers receive credentials automatically based on their configured auth mode. Additionally, custom secrets (3rd-party API keys needed by agent tasks) can be added at Admin > Event Handler > Agent Jobs. These are encrypted in the database and injected as environment variables into every container.

## Docker Images

Each backend has its own Docker image built on a shared base:

- `stephengpope/thepopebot:coding-agent-base-{version}`
- `stephengpope/thepopebot:coding-agent-claude-code-{version}`
- `stephengpope/thepopebot:coding-agent-pi-coding-agent-{version}`
- `stephengpope/thepopebot:coding-agent-gemini-cli-{version}`
- `stephengpope/thepopebot:coding-agent-codex-cli-{version}`
- `stephengpope/thepopebot:coding-agent-opencode-{version}`

All images include Node.js 22, Git, GitHub CLI, and Playwright + Chromium.
