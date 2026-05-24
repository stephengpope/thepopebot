import { ChannelAdapter } from './base.js';
import {
  sendMessage,
  addReaction,
  downloadFile,
  verifySignature,
  setAssistantThreadStatus,
} from '../tools/slack.js';
import { isAssemblyAIEnabled, transcribeAudio } from '../tools/assemblyai.js';
import { getConfig } from '../config.js';

/**
 * SlackAdapter — handles Slack Events API webhooks.
 *
 * Supported event types:
 *   - app_mention            (bot mentioned in a channel)
 *   - message.im             (DM to the bot)
 *   - assistant_thread_started (Slack AI Assistant surface)
 *   - file_share             (files attached to a message)
 *
 * channelChatId format: "<channel_id>" — Slack channel IDs are globally unique
 * within a workspace. Using just the channel ID keeps the user_channels lookup
 * consistent with how Telegram stores chat IDs.
 */
class SlackAdapter extends ChannelAdapter {
  constructor(botToken, signingSecret) {
    super();
    this.botToken = botToken;
    this.signingSecret = signingSecret;
  }

  async receive(request) {
    if (!this.botToken || !this.signingSecret) {
      console.error('[slack] bot token or signing secret not configured — rejecting webhook');
      return null;
    }

    // Slack signs the raw body, so we need to read it as text before parsing.
    const rawBody = await request.text();
    const timestamp = request.headers.get('x-slack-request-timestamp');
    const signature = request.headers.get('x-slack-signature');

    if (!verifySignature(this.signingSecret, rawBody, timestamp, signature)) {
      console.error('[slack] invalid signature — rejecting webhook');
      return null;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }

    // Slack URL verification challenge during Event Subscription setup.
    if (payload.type === 'url_verification') {
      return {
        channel: 'slack',
        channelChatId: '__url_verification__',
        text: '',
        attachments: [],
        metadata: { __urlVerification: true, challenge: payload.challenge },
      };
    }

    if (payload.type !== 'event_callback' || !payload.event) return null;

    const event = payload.event;

    // Skip messages from bots (including ourselves) to avoid loops
    if (event.bot_id || event.subtype === 'bot_message') return null;
    // Skip message_changed / message_deleted etc.
    if (event.subtype && event.subtype !== 'file_share') return null;

    const supportedTypes = ['app_mention', 'message', 'assistant_thread_started'];
    if (!supportedTypes.includes(event.type)) return null;

    // assistant_thread_started has no text yet — just acknowledges the new thread
    if (event.type === 'assistant_thread_started') return null;

    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const userId = event.user;
    let text = event.text || '';

    // Strip bot mentions like "<@U12345>" from text — they're noise for the LLM.
    text = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    const attachments = [];

    // Files (images, documents, voice notes)
    if (Array.isArray(event.files) && event.files.length > 0) {
      for (const file of event.files) {
        try {
          const dl = await downloadFile(this.botToken, file.url_private_download, file.name);
          const mimeType = file.mimetype || 'application/octet-stream';

          // Voice notes from Slack Huddles or audio file uploads → transcribe
          if (mimeType.startsWith('audio/') && isAssemblyAIEnabled()) {
            try {
              const transcribed = await transcribeAudio(dl.buffer);
              if (transcribed) text = (text ? `${text}\n\n` : '') + transcribed;
              continue;
            } catch (err) {
              console.error('[slack] audio transcription failed:', err.message);
            }
          }

          if (mimeType.startsWith('image/')) {
            attachments.push({ category: 'image', mimeType, data: dl.buffer });
          } else {
            attachments.push({ category: 'document', mimeType, data: dl.buffer });
          }
        } catch (err) {
          console.error('[slack] failed to download file:', err.message);
        }
      }
    }

    if (!text && attachments.length === 0) return null;

    return {
      channel: 'slack',
      channelChatId: channelId,
      text,
      attachments,
      metadata: {
        channelId,
        threadTs,
        userId,
        eventTs: event.ts,
        isAssistantThread: event.assistant_thread || event.channel_type === 'im',
      },
    };
  }

  async acknowledge(metadata) {
    if (!metadata?.channelId || !metadata?.eventTs) return;
    await addReaction(this.botToken, metadata.channelId, metadata.eventTs, 'thumbsup').catch(() => {});
  }

  startProcessingIndicator(metadata) {
    // Slack doesn't have a long-running typing indicator the way Telegram does.
    // For Assistant threads we can set a status; for normal channels it's a no-op.
    if (metadata?.isAssistantThread && metadata?.channelId && metadata?.threadTs) {
      setAssistantThreadStatus(this.botToken, metadata.channelId, metadata.threadTs).catch(() => {});
    }
    return () => {};
  }

  async sendResponse(channelChatId, text, metadata) {
    const options = {};
    if (metadata?.threadTs) options.threadTs = metadata.threadTs;
    await sendMessage(this.botToken, channelChatId, text, options);
  }

  get supportsStreaming() {
    return false;
  }
}

export { SlackAdapter };
