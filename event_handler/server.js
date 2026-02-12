const express = require('express');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { createJob } = require('./tools/create-job');
const { loadCrons } = require('./cron');
const { loadTriggers } = require('./triggers');
const { setWebhook, sendMessage, formatJobNotification, downloadFile, reactToMessage, startTypingIndicator } = require('./tools/telegram');
const { isWhisperEnabled, transcribeAudio } = require('./tools/openai');
const { chat, summarizeJobWithLlm } = require('./llm');
const { toolDefinitions, toolExecutors } = require('./claude/tools');
const { getHistory, updateHistory } = require('./claude/conversation');
const { githubApi, getJobStatus } = require('./tools/github');
const { render_md } = require('./utils/render-md');

const app = express();

console.log("[ENV] GH_TOKEN present:", Boolean(process.env.GH_TOKEN), "len:", (process.env.GH_TOKEN || "").length);
console.log("[ENV] GITHUB_TOKEN present:", Boolean(process.env.GITHUB_TOKEN), "len:", (process.env.GITHUB_TOKEN || "").length);

app.use(helmet());
app.use(express.json());

// --- Approval-loop stopper (minimal, deterministic) ---
const pendingJobDraft = new Map(); // chatId -> drafted job description awaiting approval

function isApproval(text) {
  const t = String(text || '').trim().toLowerCase();
  return t === 'approved' || t === 'approve' || t === 'yes' || t === 'y';
}

function extractJobDraftFromAssistant(text) {
  const s = String(text || '');
  const m = s.match(/Job Description:\s*([\s\S]*?)$/i);
  const draft = (m ? m[1] : '').trim();
  return draft.length ? draft : null;
}
// --- end approval-loop stopper ---

const { API_KEY, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, GH_WEBHOOK_SECRET, GH_OWNER, GH_REPO, TELEGRAM_CHAT_ID, TELEGRAM_VERIFICATION } = process.env;

// Bot token from env, can be overridden by /telegram/register
let telegramBotToken = TELEGRAM_BOT_TOKEN || null;

// Routes that have their own authentication
const PUBLIC_ROUTES = ['/telegram/webhook', '/github/webhook'];

// Global x-api-key auth (skip for routes with their own auth)
app.use((req, res, next) => {
  if (PUBLIC_ROUTES.includes(req.path)) {
    return next();
  }
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.use(loadTriggers());

// GET /ping - health check endpoint
app.get('/ping', (req, res) => {
  res.json({ message: 'Pong!' });
});

// GET /jobs/status - get running job status
app.get('/jobs/status', async (req, res) => {
  try {
    const result = await getJobStatus(req.query.job_id);
    res.json(result);
  } catch (err) {
    console.error('Failed to get job status:', err);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// POST /webhook - create a new job
app.post('/webhook', async (req, res) => {
  const { job } = req.body;
  if (!job) return res.status(400).json({ error: 'Missing job field' });

  try {
    const result = await createJob(job);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// POST /telegram/register - register a Telegram webhook
app.post('/telegram/register', async (req, res) => {
  const { bot_token, webhook_url } = req.body;
  if (!bot_token || !webhook_url) {
    return res.status(400).json({ error: 'Missing bot_token or webhook_url' });
  }

  try {
    const result = await setWebhook(bot_token, webhook_url, TELEGRAM_WEBHOOK_SECRET);
    telegramBotToken = bot_token;
    res.json({ success: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register webhook' });
  }
});

// POST /telegram/webhook - receive Telegram updates
app.post('/telegram/webhook', async (req, res) => {
  // Validate secret token if configured
  // Always return 200 to prevent Telegram retry loops on mismatch
  if (TELEGRAM_WEBHOOK_SECRET) {
    const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (headerSecret !== TELEGRAM_WEBHOOK_SECRET) {
      return res.status(200).json({ ok: true });
    }
  }

  const update = req.body;
  const message = update.message || update.edited_message;

  if (message && message.chat && telegramBotToken) {
    const chatId = String(message.chat.id);

    let messageText = null;

    if (message.text) {
      messageText = message.text;
    }

    // Check for verification code - this works even before TELEGRAM_CHAT_ID is set
    if (TELEGRAM_VERIFICATION && messageText === TELEGRAM_VERIFICATION) {
      await sendMessage(telegramBotToken, chatId, `Your chat ID:\n<code>${chatId}</code>`);
      return res.status(200).json({ ok: true });
    }

    // Security: if no TELEGRAM_CHAT_ID configured, ignore all messages (except verification above)
    if (!TELEGRAM_CHAT_ID) {
      return res.status(200).json({ ok: true });
    }

    // Security: only accept messages from configured chat
    if (chatId !== TELEGRAM_CHAT_ID) {
      return res.status(200).json({ ok: true });
    }

    // Acknowledge receipt with a thumbs up (await so it completes before typing indicator starts)
    await reactToMessage(telegramBotToken, chatId, message.message_id).catch(() => {});

    if (message.voice) {
      // Handle voice messages
      if (!isWhisperEnabled()) {
        await sendMessage(telegramBotToken, chatId, 'Voice messages are not supported. Please set OPENAI_API_KEY to enable transcription.');
        return res.status(200).json({ ok: true });
      }

      try {
        const { buffer, filename } = await downloadFile(telegramBotToken, message.voice.file_id);
        messageText = await transcribeAudio(buffer, filename);
      } catch (err) {
        console.error('Failed to transcribe voice:', err);
        await sendMessage(telegramBotToken, chatId, 'Sorry, I could not transcribe your voice message.');
        return res.status(200).json({ ok: true });
      }
    }

    // Acknowledge receipt immediately so Telegram doesn't wait/retry
    res.status(200).json({ ok: true });

    if (messageText) {
      const stopTyping = startTypingIndicator(telegramBotToken, chatId);
      try {
        // Get conversation history
        const history = getHistory(chatId);

        // --- Approval shortcut: if there's a pending draft and user approves, create job directly ---
        if (isApproval(messageText)) {
          const draft = pendingJobDraft.get(chatId);
          if (draft) {
            try {
              const result = await createJob(draft);
              pendingJobDraft.delete(chatId);

              const msg = result?.job_id
                ? `✅ Approved. Job created.\nJob ID: ${result.job_id}\nBranch: ${result.branch || '(see job)'}`
                : '✅ Approved. Job created.';

              await sendMessage(telegramBotToken, chatId, msg);
            } catch (err) {
              await sendMessage(
                telegramBotToken,
                chatId,
                `✅ Approved, but job creation failed:\n${err?.message || String(err)}`
              ).catch(() => {});
            } finally {
              stopTyping();
            }
            return; // do not call the LLM for this update
          }
        }

        // Process with LLM
        const { response, history: newHistory } = await chat(
          messageText,
          history,
          toolDefinitions,
          toolExecutors
        );

        // Cache drafted job description if assistant is asking for approval
        const maybeDraft = extractJobDraftFromAssistant(response);
        if (
          maybeDraft &&
          /respond with\s+"approved"|respond with\s+approved|responding with\s+"approved"/i.test(response)
        ) {
          pendingJobDraft.set(chatId, maybeDraft);
        }

        updateHistory(chatId, newHistory);

        // Send response (auto-splits if needed)
        await sendMessage(telegramBotToken, chatId, response);
      } catch (err) {
        console.error('Failed to process message with Claude:', err);
        await sendMessage(telegramBotToken, chatId, 'Sorry, I encountered an error processing your message.').catch(() => {});
      } finally {
        stopTyping();
      }
    }
  } else {
    // No message to process — still acknowledge
    res.status(200).json({ ok: true });
  }
});

/**
 * Extract job ID from branch name (e.g., "job/abc123" -> "abc123")
 */
function extractJobId(branchName) {
  if (!branchName || !branchName.startsWith('job/')) return null;
  return branchName.slice(4);
}

/**
 * Summarize a completed job using Claude — returns the raw message to send
 * @param {Object} results - Job results from webhook payload
 * @param {string} results.job - Original task (job.md)
 * @param {string} results.commit_message - Final commit message
 * @param {string[]} results.changed_files - List of changed file paths
 * @param {string} results.pr_status - PR state (open, closed, merged)
 * @param {string} results.log - Agent session log (JSONL)
 * @param {string} results.pr_url - PR URL
 * @returns {Promise<string>} The message to send to Telegram
 */
async function summarizeJob(results) {
  try {
    // System prompt from JOB_SUMMARY.md (supports {{includes}})
    // User message: structured job results
    const userMessage = [
      results.job ? `## Task\n${results.job}` : '',
      results.commit_message ? `## Commit Message\n${results.commit_message}` : '',
      results.changed_files?.length ? `## Changed Files\n${results.changed_files.join('\n')}` : '',
      results.pr_status ? `## PR Status\n${results.pr_status}` : '',
      results.merge_result ? `## Merge Result\n${results.merge_result}` : '',
      results.pr_url ? `## PR URL\n${results.pr_url}` : '',
      results.log ? `## Agent Log\n${results.log}` : '',
    ].filter(Boolean).join('\n\n');

    return await summarizeJobWithLlm({
      systemPromptPath: path.join(__dirname, '..', 'operating_system', 'JOB_SUMMARY.md'),
      userMessage,
    });
  } catch (err) {
    console.error('Failed to summarize job:', err);
    return 'Job completed.';
  }
}

// POST /github/webhook - receive GitHub PR notifications
app.post('/github/webhook', async (req, res) => {
  // Validate webhook secret
  if (GH_WEBHOOK_SECRET) {
    const headerSecret = req.headers['x-github-webhook-secret-token'];
    if (headerSecret !== GH_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event !== 'pull_request') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const pr = payload.pull_request;
  if (!pr) return res.status(200).json({ ok: true, skipped: true });

  const branchName = pr.head?.ref;
  const jobId = extractJobId(branchName);
  if (!jobId) return res.status(200).json({ ok: true, skipped: true, reason: 'not a job branch' });

  if (!TELEGRAM_CHAT_ID || !telegramBotToken) {
    console.log(`Job ${jobId} completed but no chat ID to notify`);
    return res.status(200).json({ ok: true, skipped: true, reason: 'no chat to notify' });
  }

  try {
    // All job data comes from the webhook payload — no GitHub API calls needed
    const results = payload.job_results || {};
    results.pr_url = pr.html_url;

    const message = await summarizeJob(results);

    await sendMessage(telegramBotToken, TELEGRAM_CHAT_ID, message);

    // Add the summary to chat memory so Claude has context in future conversations
    const history = getHistory(TELEGRAM_CHAT_ID);
    history.push({ role: 'assistant', content: message });
    updateHistory(TELEGRAM_CHAT_ID, history);

    console.log(`Notified chat ${TELEGRAM_CHAT_ID} about job ${jobId.slice(0, 8)}`);

    res.status(200).json({ ok: true, notified: true });
  } catch (err) {
    console.error('Failed to process GitHub webhook:', err);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Error handler - don't leak stack traces
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
  loadCrons();
});
