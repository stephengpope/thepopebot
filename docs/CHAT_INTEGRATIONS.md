# Chat Integrations

## Built-in Chat Interfaces

### Web Chat

The web chat interface is included out of the box at your APP_URL. No additional configuration needed.

- **Streaming responses** — AI responses stream in real-time via the Vercel AI SDK
- **File uploads** — Send images, PDFs, and text files for the AI to process
- **Chat history** — Browse past conversations grouped by date, resume any chat
- **Job management** — Create and monitor agent jobs from the Runners page
- **Code workspaces** — Launch interactive or headless coding sessions in Docker containers directly from chat
- **Voice input** — Real-time voice transcription via AssemblyAI for hands-free messaging
- **Notifications** — Job completion alerts with unread badges in the sidebar
- **API key management** — Generate and manage API keys at Admin > Event Handler > Webhooks

### Telegram (Optional)

Connect a Telegram bot to chat with your agent on the go. Configure at `/admin/event-handler/telegram` — paste your bot token, click **Register webhook**. Each user then verifies their personal chat at `/profile/telegram` via a one-time code.

Once connected, message your bot directly to chat or create jobs. Supports text, voice messages (transcribed via AssemblyAI when an `ASSEMBLYAI_API_KEY` is set in `/admin/event-handler/voice`), photos, and documents.

Slash commands: `/verify <code>` (link your account), `/session` (list active threads), `/session <id>` (switch threads).

### Slack (Optional)

Connect a Slack bot to chat with your agent from any workspace channel or DM. Configuration is a two-step process:

**1. Create the Slack app**

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**. Pick a name and workspace.
2. **OAuth & Permissions** → add these Bot Token Scopes:
   - `app_mentions:read`
   - `chat:write`
   - `im:history`
   - `im:read`
   - `im:write`
   - `users:read`
   - `reactions:write` (optional — enables thumbs-up acknowledgments)
   - `assistant:write` (optional — enables the AI Assistant pane)
3. **Event Subscriptions** → toggle **Enable Events** on. Request URL:
   ```
   <APP_URL>/api/slack/events
   ```
   Slack will hit it once with a `url_verification` challenge — the bot answers automatically.
4. **Subscribe to bot events** (under Event Subscriptions):
   - `app_mention`
   - `message.im`
   - `assistant_thread_started` (optional)
5. **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-…`).
6. **Basic Information** → copy the **Signing Secret**.

**2. Configure in the bot admin UI**

Configure at `/admin/event-handler/slack` — paste your bot token + signing secret. Each user then verifies their personal Slack workspace at `/profile/slack` via a one-time code.

Once connected, mention the bot in a channel (`@YourBot do X`) or DM it directly. The bot replies in-thread. Slash commands `/verify <code>`, `/session`, `/session <id>` work the same as Telegram.

Voice notes uploaded to Slack are transcribed if `ASSEMBLYAI_API_KEY` is set. Image attachments are passed to the LLM as vision input.

### Microsoft Teams (Optional)

Connect a Teams bot via Azure Bot registration. Configuration is a three-step process:

**1. Create the Azure Bot**

1. Sign in to <https://portal.azure.com> → **Create a resource** → search **Azure Bot**.
2. Set:
   - **Bot handle**: a name (e.g. `MyAgentBot`)
   - **Type of App**: **Multi Tenant** (or **Single Tenant** if you only want your own tenant to use it)
   - **Creation type**: **Create new Microsoft App ID**
3. After deployment, open the bot resource → **Configuration**:
   - Copy the **Microsoft App ID**.
   - Click **Manage** → **Certificates & secrets** → **New client secret** → copy the **Value** (this is your `TEAMS_APP_PASSWORD` — only shown once).
   - Set **Messaging endpoint**:
     ```
     <APP_URL>/api/teams/events
     ```

**2. Add the Microsoft Teams channel**

In the bot resource → **Channels** → click **Microsoft Teams** → accept terms → save. This makes the bot available to add to Teams chats.

**3. Configure in the bot admin UI and install in Teams**

- Configure at `/admin/event-handler/teams` — paste App ID + App Password.
- Build a Teams app manifest with the same App ID (or use Developer Portal's "Bot management" flow) and sideload into your Teams workspace.
- Once installed, send the bot a DM in Teams. The user verifies with `/verify <code>` (issued from `/profile/teams` in the admin UI).

Notes:
- **System notifications** (e.g. GitHub webhook completion summaries) only push to Teams **after** the user has messaged the bot at least once — Teams requires a `serviceUrl` that only arrives with inbound Activities.
- File attachment downloads in Teams require Graph API auth and are not yet supported. Text-only messages work.

---

## Channel Adapter Architecture

thepopebot uses a channel adapter pattern to normalize messages across different chat platforms. The AI layer is channel-agnostic — it receives the same normalized message format regardless of the source.

### Base Class

`lib/channels/base.js` defines the `ChannelAdapter` interface:

| Method | Description |
|--------|-------------|
| `receive(request)` | Parse incoming webhook into normalized message data (or `null` to ignore) |
| `acknowledge(metadata)` | Show message receipt (e.g., Telegram thumbs-up reaction) |
| `startProcessingIndicator(metadata)` | Show activity while AI processes (e.g., typing indicator). Returns a stop function |
| `sendResponse(threadId, text, metadata)` | Send a complete response back to the channel |
| `supportsStreaming` (getter) | Whether the channel supports real-time streaming (e.g., web chat) |

### Normalized Message Format

All adapters return the same shape from `receive()`:

```javascript
{
  threadId: string,      // Channel-specific thread/chat identifier
  text: string,          // Message text (voice messages are pre-transcribed)
  attachments: [         // Non-text content for the AI
    { category: "image", mimeType: "image/jpeg", data: Buffer },
    { category: "document", mimeType: "application/pdf", data: Buffer }
  ],
  metadata: object       // Channel-specific data (message IDs, chat IDs, etc.)
}
```

Voice/audio messages are fully resolved by the adapter — transcribed to text and included in the `text` field, not passed as attachments.

### Reference Implementation

`lib/channels/telegram.js` (`TelegramAdapter`) is the reference implementation. It handles:
- Webhook secret validation (`x-telegram-bot-api-secret-token` header)
- **Per-user verified routing** via the `user_channels` table — unverified chats only accept `/verify <code>`; everything else is silently dropped
- Slash commands (`/verify`, `/session`, `/session list`, `/session <id>`)
- Text, voice/audio (AssemblyAI transcription), photo, and document messages
- Thumbs-up reaction on receipt, typing indicator during processing

---

## Adding a New Channel

To add a new chat channel (e.g., Discord, Slack, WhatsApp):

1. **Create an adapter** extending `ChannelAdapter` in `lib/channels/`:

```javascript
import { ChannelAdapter } from './base.js';

class DiscordAdapter extends ChannelAdapter {
  async receive(request) {
    // Parse the incoming webhook, validate auth, return normalized message
    // Return null to ignore the message
  }

  async acknowledge(metadata) {
    // Optional: react to the message
  }

  startProcessingIndicator(metadata) {
    // Optional: show typing indicator
    return () => {}; // Return stop function
  }

  async sendResponse(threadId, text, metadata) {
    // Send the AI's response back to the channel
  }
}
```

2. **Add a factory function** in `lib/channels/index.js`:

```javascript
import { DiscordAdapter } from './discord.js';

export function getDiscordAdapter(botToken) {
  // Lazy singleton pattern (see getTelegramAdapter for reference)
}
```

3. **Add a webhook route** in `api/index.js` to handle incoming messages from the new channel.

4. **The AI layer needs zero changes** — it's channel-agnostic. It receives normalized messages and returns responses regardless of the source channel.

---

## Potential Integrations

The adapter pattern makes it straightforward to add any channel that supports webhooks:

- **Discord** — Bot webhooks, slash commands
- **WhatsApp** — Business API webhooks
- **SMS** — Twilio webhooks
- **Email** — Inbound email parsing (SendGrid, Mailgun)

All follow the same pattern: receive webhook, normalize to `{ threadId, text, attachments, metadata }`, send response back.

Reference implementations: `lib/channels/telegram.js`, `lib/channels/slack.js`, `lib/channels/teams.js`.
