# Running Different Models

## Overview

thepopebot has two layers that use LLMs independently:

- **Event Handler** — powers web chat, Telegram responses, webhook processing, and job summaries. Configured via `.env` on your server.
- **Jobs** — the Docker agent (Pi or Claude Code) that runs on GitHub Actions or a self-hosted runner. Configured via GitHub repo variables.

Because these are separate, you can run a capable model for interactive chat and a cheaper or local model for long-running jobs — or vice versa.

## Configuring the Event Handler Model

The Event Handler model controls all LLM interactions on your server: web chat, Telegram replies, webhook trigger processing, and job completion summaries.

Set these in your `.env` file:

| Variable | Description |
|----------|-------------|
| `LLM_PROVIDER` | `anthropic` (default), `openai`, `google`, or `custom` |
| `LLM_MODEL` | Model name (e.g. `claude-sonnet-4-20250514`, `gpt-4o`) — uses provider default if unset |
| `LLM_MAX_TOKENS` | Max tokens for responses (default: `4096`) |
| `ANTHROPIC_API_KEY` | Required for `anthropic` provider |
| `OPENAI_API_KEY` | Required for `openai` provider |
| `GOOGLE_API_KEY` | Required for `google` provider |
| `CUSTOM_API_KEY` | Required for `custom` provider (if the endpoint needs auth) |
| `OPENAI_BASE_URL` | Custom OpenAI-compatible base URL (for `custom` provider, e.g. `http://localhost:11434/v1`) |

Example `.env` snippet:

```bash
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...
```

Restart your server after changing these values.

## Configuring the Default Job Model

Jobs run in Docker containers on GitHub Actions (or a self-hosted runner). Their LLM configuration is **independent** from the Event Handler — it comes from GitHub repo variables, not `.env`.

Set the defaults with the CLI:

```bash
npx thepopebot set-var LLM_PROVIDER openai
npx thepopebot set-var LLM_MODEL gpt-4o
```

The matching API key must exist as a GitHub secret:

```bash
npx thepopebot set-agent-secret OPENAI_API_KEY sk-...
```

These defaults apply to every job unless overridden per-job (see below).

## Example: Different Models for Chat vs Jobs

Use Claude for interactive chat on the Event Handler and a local Ollama model for jobs:

**Event Handler** (`.env`):

```bash
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...
```

**Jobs** (GitHub repo variables):

```bash
npx thepopebot set-var LLM_PROVIDER custom
npx thepopebot set-var LLM_MODEL qwen3:8b
npx thepopebot set-var OPENAI_BASE_URL http://host.docker.internal:11434/v1
npx thepopebot set-var RUNS_ON self-hosted
```

Now your chat uses Claude while every job runs on the local Ollama instance.

## Per-Job Overrides

Add `llm_provider` and `llm_model` to any agent-type entry in `config/CRONS.json` or any action in `config/TRIGGERS.json`. This overrides the default for just that one job:

```json
{
  "name": "Code review",
  "schedule": "0 9 * * 1",
  "type": "agent",
  "job": "Review open PRs and leave comments",
  "llm_provider": "openai",
  "llm_model": "gpt-4o"
}
```

The matching API key must already exist as a GitHub secret (see the Providers table below).

> **Using `custom` on individual crons:** `llm_provider` and `llm_model` travel with the job, but `OPENAI_BASE_URL`, `RUNS_ON`, and `CUSTOM_API_KEY` are repo-level settings — they must be set as GitHub variables/secrets even if your default provider is something else. See [Using the `custom` Provider](#using-the-custom-provider) below.

## Providers

| Provider | What it is | Example model | GitHub secret needed |
|----------|------------|---------------|----------------------|
| `anthropic` | Anthropic (default) | `claude-sonnet-4-20250514` | `AGENT_ANTHROPIC_API_KEY` |
| `openai` | OpenAI | `gpt-4o` | `AGENT_OPENAI_API_KEY` |
| `google` | Google Gemini | `gemini-2.5-pro` | `AGENT_GOOGLE_API_KEY` |
| `novita` | Novita OpenAI-compatible API | `deepseek/deepseek-v3.2` | `AGENT_NOVITA_API_KEY` |
| `custom` | Any OpenAI-compatible API (DeepSeek, Ollama, Together AI, etc.) | `deepseek-chat` | `AGENT_CUSTOM_API_KEY` *(if required — see below)* |

`novita` is a built-in provider in the app, but for PI agent jobs it is configured through generated `models.json` using Novita's OpenAI-compatible base URL `https://api.novita.ai/openai`.

## Using the `custom` Provider

`custom` means "any server that speaks the OpenAI chat-completions API." This covers cloud APIs, local models, and the Event Handler itself.

### Cloud custom (DeepSeek, Together AI, Fireworks, etc.)

Point at the provider's endpoint and add your API key:

```bash
npx thepopebot set-var LLM_PROVIDER custom
npx thepopebot set-var LLM_MODEL deepseek-chat
npx thepopebot set-var OPENAI_BASE_URL https://api.deepseek.com/v1
```

Then set the API key as a GitHub secret:

```bash
npx thepopebot set-agent-secret CUSTOM_API_KEY sk-...
```

Cloud custom APIs are reachable from any runner — no other changes needed.

### Local custom (Ollama, LM Studio, vLLM, etc.)

For a model running on your own machine you need a [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners) so the job executes on your hardware:

```bash
npx thepopebot set-var RUNS_ON self-hosted
npx thepopebot set-var LLM_PROVIDER custom
npx thepopebot set-var LLM_MODEL qwen3:8b
npx thepopebot set-var OPENAI_BASE_URL http://host.docker.internal:11434/v1
```

Most local servers don't need an API key. If yours does, set `AGENT_CUSTOM_API_KEY` as a GitHub secret.

> **Important:** `RUNS_ON=self-hosted` is only needed when the model runs on your machine. Jobs run inside Docker, so use `host.docker.internal` to reach a model server on the host.

### Custom provider on the Event Handler

The same mechanism works for the Event Handler. Set these in `.env`:

```bash
LLM_PROVIDER=custom
LLM_MODEL=qwen3:8b
OPENAI_BASE_URL=http://localhost:11434/v1
```

If the endpoint requires an API key, also set `CUSTOM_API_KEY` in `.env`. Restart your server after changes.

## Quick Reference

| What | Where | Variables |
|------|-------|-----------|
| Event Handler model (chat, Telegram, webhooks, summaries) | `.env` on your server | `LLM_PROVIDER`, `LLM_MODEL`, + provider API key |
| Default job model | GitHub repo variables | `LLM_PROVIDER`, `LLM_MODEL` (set via `npx thepopebot set-var`) |
| Per-job override | `config/CRONS.json` or `config/TRIGGERS.json` | `llm_provider`, `llm_model` on the entry |
| Custom provider endpoint | GitHub repo variable (jobs) or `.env` (Event Handler) | `OPENAI_BASE_URL` |
| Custom provider API key | GitHub secret (jobs) or `.env` (Event Handler) | `AGENT_CUSTOM_API_KEY` / `CUSTOM_API_KEY` |
| Self-hosted runner for local models | GitHub repo variable | `RUNS_ON=self-hosted` |
