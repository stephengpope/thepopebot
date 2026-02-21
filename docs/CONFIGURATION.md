# Configuration

## Environment Variables

All environment variables for the Event Handler (set in `event_handler/.env`):

| Variable                  | Description                                                                                                         | Required          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------- |
| `API_KEY`                 | Authentication key for all endpoints (except `/telegram/webhook` and `/github/webhook` which use their own secrets) | Yes               |
| `EVENT_HANDLER_PROVIDER`  | LLM provider for chat (`claude` or `copilot`)                                                                       | No                | (default: `claude`) |
| `GH_TOKEN`                | GitHub PAT for creating branches/files                                                                              | Yes               |
| `GH_OWNER`                | GitHub repository owner                                                                                             | Yes               |
| `GH_REPO`                 | GitHub repository name                                                                                              | Yes               |
| `PORT`                    | Server port (default: 3000)                                                                                         | No                |
| `TELEGRAM_BOT_TOKEN`      | Telegram bot token from BotFather                                                                                   | For Telegram      |
| `TELEGRAM_CHAT_ID`        | Restricts bot to this chat only                                                                                     | For security      |
| `TELEGRAM_WEBHOOK_SECRET` | Secret for webhook validation                                                                                       | No                |
| `GH_WEBHOOK_SECRET`       | Secret for GitHub Actions webhook auth                                                                              | For notifications |
| `ANTHROPIC_API_KEY`       | Claude API key for chat (required if `EVENT_HANDLER_PROVIDER=claude`)                                               | For Claude        |
| `GITHUB_COPILOT_API_KEY`  | GitHub Copilot API key (optional if `EVENT_HANDLER_PROVIDER=copilot`; uses `GH_TOKEN` if not set)                   | For Copilot       |
| `OPENAI_API_KEY`          | OpenAI key for voice transcription                                                                                  | For voice         |
| `EVENT_HANDLER_MODEL`     | Model for chat (default depends on provider, e.g., `claude-sonnet-4-20250514` for Claude)                           | No                |

---

## Selecting an LLM Provider

The setup wizard will prompt you to choose your LLM provider:

### Claude (Anthropic) - Default

- **Configuration:** Set `EVENT_HANDLER_PROVIDER=claude` and provide `ANTHROPIC_API_KEY`
- **Cost:** Anthropic API pricing per token
- **Features:** Web search, tool use, full feature support

### GitHub Copilot

- **Configuration:** Set `EVENT_HANDLER_PROVIDER=copilot`
- **Authentication:** Either:
  - Use existing `GH_TOKEN` (GitHub Personal Access Token) automatically
  - Provide `GITHUB_COPILOT_API_KEY` for dedicated authentication
- **Cost:** Included with GitHub Copilot subscription or GitHub's usage-based pricing
- **Features:** Tool use, similar conversational capabilities

---

## GitHub Secrets

Set automatically by the setup wizard:

| Secret              | Description                                                                                            | Required |
| ------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| `SECRETS`           | Base64-encoded JSON with protected credentials (GH_TOKEN, ANTHROPIC_API_KEY or GITHUB_COPILOT_API_KEY) | Yes      |
| `LLM_SECRETS`       | Base64-encoded JSON with LLM-accessible credentials                                                    | No       |
| `GH_WEBHOOK_SECRET` | Random secret for webhook authentication                                                               | Yes      |

---

## GitHub Repository Variables

Configure in **Settings → Secrets and variables → Actions → Variables**:

| Variable         | Description                                                              | Required | Default                          |
| ---------------- | ------------------------------------------------------------------------ | -------- | -------------------------------- |
| `GH_WEBHOOK_URL` | Event handler URL (e.g., your ngrok URL)                                 | Yes      | —                                |
| `AUTO_MERGE`     | Set to `false` to disable auto-merge of job PRs                          | No       | Enabled                          |
| `ALLOWED_PATHS`  | Comma-separated path prefixes for auto-merge                             | No       | `/logs`                          |
| `IMAGE_URL`      | Docker image path (e.g., `ghcr.io/myorg/mybot`)                          | No       | `stephengpope/thepopebot:latest` |
| `MODEL`          | Anthropic model ID for the Pi agent (e.g., `claude-sonnet-4-5-20250929`) | No       | Pi default                       |

---

## ngrok URL Changes

ngrok assigns a new URL each time you restart it (unless you have a paid plan with a static domain). When your ngrok URL changes, run:

```bash
npm run setup-telegram
```

This will verify your server is running, update the GitHub webhook URL, re-register the Telegram webhook, and optionally capture your chat ID for security.

---

## Manual Telegram Setup (Production)

If you're deploying to a platform where you can't run the setup script (Vercel, Railway, etc.), configure Telegram manually:

1. **Set environment variables** in your platform's dashboard (see `event_handler/.env.example` for reference):
   - `TELEGRAM_BOT_TOKEN` - Your bot token from @BotFather
   - `TELEGRAM_WEBHOOK_SECRET` - Generate with `openssl rand -hex 32`
   - `TELEGRAM_VERIFICATION` - A verification code like `verify-abc12345`

2. **Deploy and register the webhook:**

   ```bash
   curl -X POST https://your-app.vercel.app/telegram/register \
     -H "Content-Type: application/json" \
     -H "x-api-key: YOUR_API_KEY" \
     -d '{"bot_token": "YOUR_BOT_TOKEN", "webhook_url": "https://your-app.vercel.app/telegram/webhook"}'
   ```

   This registers your webhook with the secret from your env.

3. **Get your chat ID:**
   - Message your bot with your `TELEGRAM_VERIFICATION` code (e.g., `verify-abc12345`)
   - The bot will reply with your chat ID

4. **Set `TELEGRAM_CHAT_ID`:**
   - Add the chat ID to your environment variables
   - Redeploy

Now your bot only responds to your authorized chat.
