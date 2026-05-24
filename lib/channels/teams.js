import { ChannelAdapter } from './base.js';
import {
  verifyJwt,
  sendActivity,
  sendTypingActivity,
} from '../tools/teams.js';

/**
 * TeamsAdapter — handles Microsoft Teams Bot Framework webhooks.
 *
 * The Bot Framework sends signed Activities (JSON) via POST to our messaging
 * endpoint. We validate the JWT in the Authorization header against Microsoft's
 * signing keys, then normalize the Activity into the framework's common
 * message shape.
 *
 * channelChatId format: the Activity's `conversation.id`. This is unique within
 * Teams (per tenant) and is what we hand to the Connector when sending replies.
 *
 * `serviceUrl` is required to send replies — we stash it in metadata so the
 * webhook handler can pass it to `sendActivity`.
 */
class TeamsAdapter extends ChannelAdapter {
  constructor(appId, appPassword) {
    super();
    this.appId = appId;
    this.appPassword = appPassword;
  }

  async receive(request) {
    if (!this.appId || !this.appPassword) {
      console.error('[teams] App ID or Password not configured — rejecting webhook');
      return null;
    }

    const authHeader = request.headers.get('authorization') || '';
    const valid = await verifyJwt(authHeader, this.appId);
    if (!valid) {
      console.error('[teams] JWT verification failed — rejecting webhook');
      return null;
    }

    let activity;
    try {
      activity = await request.json();
    } catch {
      return null;
    }

    // Only handle inbound messages — ignore conversationUpdate, typing, etc.
    if (activity.type !== 'message') return null;
    if (!activity.conversation?.id || !activity.serviceUrl) return null;

    // Strip <at>@BotName</at> mentions from text — they're noise for the LLM.
    let text = activity.text || '';
    text = text.replace(/<at>.*?<\/at>/gi, '').trim();

    // Teams attachments come through as activity.attachments with contentUrl
    // pointing at a Teams-hosted file. For an MVP we surface text-only messages
    // and leave file attachment handling as a follow-up — Teams file download
    // requires its own auth path (graph token or sharepoint OBO flow).
    const attachments = [];

    if (!text && attachments.length === 0) return null;

    return {
      channel: 'teams',
      channelChatId: activity.conversation.id,
      text,
      attachments,
      metadata: {
        conversationId: activity.conversation.id,
        serviceUrl: activity.serviceUrl,
        activityId: activity.id,
        replyToId: activity.replyToId || null,
        tenantId: activity.channelData?.tenant?.id || null,
        fromId: activity.from?.id || null,
        fromName: activity.from?.name || null,
        recipientId: activity.recipient?.id || null,
      },
    };
  }

  async acknowledge(metadata) {
    // Teams has no built-in "message receipt" affordance — typing activity
    // happens in startProcessingIndicator. No-op here.
  }

  startProcessingIndicator(metadata) {
    if (!metadata?.serviceUrl || !metadata?.conversationId) return () => {};

    let stopped = false;
    const tick = () => {
      if (stopped) return;
      sendTypingActivity({
        appId: this.appId,
        appPassword: this.appPassword,
        serviceUrl: metadata.serviceUrl,
        conversationId: metadata.conversationId,
      }).catch(() => {});
    };

    tick();
    // Teams typing indicators last ~10s; re-emit every 8s to stay visible.
    const interval = setInterval(tick, 8000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }

  async sendResponse(channelChatId, text, metadata) {
    if (!metadata?.serviceUrl) {
      throw new Error('Teams sendResponse requires metadata.serviceUrl');
    }
    await sendActivity({
      appId: this.appId,
      appPassword: this.appPassword,
      serviceUrl: metadata.serviceUrl,
      conversationId: channelChatId,
      replyToActivityId: metadata.activityId,
      text,
    });
  }

  get supportsStreaming() {
    return false;
  }
}

export { TeamsAdapter };
