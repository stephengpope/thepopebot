# Coding Agents

Coding agents are the AI backends that power code workspaces and agent jobs. They run inside Docker containers and interact with your Git repository — writing code, running commands, creating PRs.

thepopebot supports 6 coding agent backends. Each has its own Docker image and authentication method. You enable and configure them in Admin > Event Handler > Coding Agents.

## Supported Backends

| Backend | Config key | What it is | Auth modes |
|---------|-----------|------------|------------|
| Claude Code | `claude-code` (default) | Anthropic's official CLI agent | OAuth token or API key |
| Pi | `pi-coding-agent` | Third-party agent by @mariozechner | API key (any provider) |
| Gemini CLI | `gemini-cli` | Google's CLI agent | API key (Google) |
| Codex CLI | `codex-cli` | OpenAI's CLI agent | OAuth token or API key |
| OpenCode | `opencode` | Open-source agent | API key (any provider) |
| Kimi CLI | `kimi-cli` | Moonshot's Kimi CLI agent | API key (any provider) |

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
- `CODING_AGENT_CLAUDE_CODE_SEARCH` (default: `parallel`) controls web tools in
  **in-process Claude SDK live chats**. Choose **Chat web search** on the Claude
  Code card at Admin > Event Handler > Coding Agents:
  - **Parallel (no API key)**: search the web and fetch pages with
    [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp).
    Search uses Fast mode with no account or API key. Queries and requested URLs
    are sent to Parallel. The free service has usage limits; tool errors are
    returned to the agent without silently switching providers.
  - **Claude native tools**: use the existing `WebSearch` and `WebFetch` tools,
    with their normal backend/account requirements.
  - **Disabled**: do not register the built-in Parallel server and disable native `WebSearch` and
    `WebFetch` for these chats. User-configured MCP servers, custom skills and
    shell/network access are governed separately by the agent's permissions.

An unset search choice now uses Parallel instead of Claude's native web tools.
Saved selections apply on the next chat message. Parallel's two read-only web
tools are approved in both plan and code modes; other tool permissions, LLM
credentials and model settings are unchanged. This setting does not configure the
interactive Docker terminal, background jobs, headless containers or other agents.
The built-in MCP server uses the name `thepopebot-parallel-search`; existing
user-configured servers (including `parallel-search`) retain their own URLs and
credentials.

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

### Kimi CLI

- `CODING_AGENT_KIMI_CLI_ENABLED` (default: `false`)
- `CODING_AGENT_KIMI_CLI_PROVIDER` — LLM provider for Kimi
- `CODING_AGENT_KIMI_CLI_MODEL` — model override

## OAuth Tokens

Claude Code and Codex CLI support OAuth authentication (subscription-based, not pay-per-token).

**Claude Code OAuth**: Claude Pro ($20/mo) or Max ($100+/mo) subscribers can generate tokens:

```bash
npm install -g @anthropic-ai/claude-code
claude setup-token
```

Token starts with `sk-ant-oat01-`. Add it in Admin > Event Handler > Coding Agents > Claude Code.

**Codex OAuth**: Similar flow for OpenAI subscribers.

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

- `stephengpope/thepopebot:thepopebot-base-{version}` (shared toolchain — Ubuntu 24.04 + Node 22 + Chromium + playwright)
- `stephengpope/thepopebot:coding-agent-base-{version}` (extends `thepopebot-base` with tmux, ttyd, scripts, entrypoint)
- `stephengpope/thepopebot:coding-agent-claude-code-{version}`
- `stephengpope/thepopebot:coding-agent-pi-coding-agent-{version}`
- `stephengpope/thepopebot:coding-agent-gemini-cli-{version}`
- `stephengpope/thepopebot:coding-agent-codex-cli-{version}`
- `stephengpope/thepopebot:coding-agent-opencode-{version}`
- `stephengpope/thepopebot:coding-agent-kimi-cli-{version}`

All images include Node.js 22, Git, GitHub CLI, and Playwright + Chromium via the shared `thepopebot-base`.
