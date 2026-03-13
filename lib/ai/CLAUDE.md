# lib/ai/ — LLM Integration

## Agent Types

Two agent types, both using `createReactAgent` from `@langchain/langgraph/prebuilt` with `SqliteSaver` for conversation memory:

**Job Agent** — singleton via `getJobAgent()`:
- System prompt: `config/JOB_PLANNING.md` (rendered fresh each invocation via `render_md()`)
- Tools: `create_job`, `get_job_status`, `get_system_technical_specs`, `get_skill_building_guide`, `get_skill_details`, + web search (if provider supports it)
- Call `resetAgent()` to clear the singleton (required if hot-reloading)

**Code Agent** — per-chat via `getCodeAgent({ repo, branch, workspaceId, chatId })`:
- System prompt: `config/CODE_PLANNING.md` (rendered fresh each invocation)
- Tools: `start_coding` (bound to workspace), `get_repository_details` (bound to repo/branch), + web search
- Keyed by `chatId` in an internal Map

## Adding a New Tool

1. Define in `tools.js` with Zod schema (use `tool()` from `@langchain/core/tools`)
2. Add to the agent's tools array in `agent.js`
3. Call `resetAgent()` if the job agent needs to pick up the new tool without restart

## Model Resolution

`createModel()` in `model.js` resolves provider/model at agent creation time (singleton for job agent). Provider determined by `LLM_PROVIDER` env var, model by `LLM_MODEL`. Changing these requires restart.

### LLM Providers

| Provider | `LLM_PROVIDER` | Default Model | Required Env |
|----------|----------------|---------------|-------------|
| Anthropic | `anthropic` (default) | `claude-sonnet-4-6-20250514` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `gpt-4o` | `OPENAI_API_KEY` |
| Google | `google` | `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| Custom | `custom` | — | `OPENAI_BASE_URL`, `CUSTOM_API_KEY` (optional) |

`LLM_MAX_TOKENS` defaults to 4096. Web search available for `anthropic` and `openai` providers only (disable with `WEB_SEARCH=false`).

> **Google model compatibility note:** `gemini-2.5-pro` and all `gemini-3.*` models require `thought_signature` round-tripping that `@langchain/google-genai` does not yet support. Setting `LLM_MODEL` to one of these will automatically fall back to `gemini-2.5-flash` at runtime with a warning. Supported Gemini models: `gemini-2.5-flash` (default), `gemini-2.5-flash-lite`. Full support for thinking models is tracked in issue #201.

## Chat Streaming

`chatStream()` in `index.js` yields chunks: `{ type: 'text', content }`, `{ type: 'tool-call', name, args }`, `{ type: 'tool-result', name, result }`. Called by `lib/chat/api.js` (the `/stream/chat` endpoint).

## Headless Stream Parser (headless-stream.js)

Three-layer parser for Claude Code agents running in headless Docker containers:

1. **Docker frame decoder** — Parses 8-byte multiplexed stream headers (type + size), extracts stdout frames, discards stderr. Buffers incomplete frames across chunks.
2. **NDJSON splitter** — Accumulates decoded UTF-8, splits on newlines. Holds incomplete trailing lines for next chunk.
3. **Event mapper** (`mapLine()`) — Converts each line to chat events:
   - `assistant` messages: `text` blocks → `{ type: 'text' }`, `tool_use` blocks → `{ type: 'tool-call' }`
   - `user` messages: `tool_result` blocks → `{ type: 'tool-result' }` (priority: stdout > string content > array)
   - `result` messages: → `{ type: 'text', _resultSummary }` (injected into LangGraph memory)
   - Non-JSON lines (e.g. `NO_CHANGES`, `AGENT_FAILED`): wrapped as plain text events

`parseHeadlessStream(dockerLogStream)` is an async generator consuming `http.IncomingMessage`. `mapLine()` is also reused by `lib/cluster/stream.js` for worker log parsing.
