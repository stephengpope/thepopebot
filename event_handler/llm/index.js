const path = require('path');
const { render_md } = require('../utils/render-md');

function isApprovalMessage(text) {
  const t = String(text || '').trim().toLowerCase();
  return t === 'approved' || t === 'approve' || t === 'yes' || t === 'y' || t.startsWith('yes ');
}

function extractJobDescriptionFromLastAssistant(history) {
  if (!Array.isArray(history) || history.length === 0) return null;

  // Find the most recent assistant message that looks like an approval request + job description
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant') continue;
    const s = String(msg.content || '');

    // Heuristic: looks like the template the bot uses
    if (/job description/i.test(s) && /responding with\s+"approved"|respond with "approved"|responding with "approved"/i.test(s)) {
      // Best effort: grab everything after "Job Description:" if present; else use full message.
      const m = s.match(/job description:\s*([\s\S]*)/i);
      const job = (m ? m[1] : s).trim();
      return job.length ? job : null;
    }
  }
  return null;
}


// Defaults tuned for local inference; override via env.
const DEFAULT_MODEL = process.env.EVENT_HANDLER_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5-coder:14b';
const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

function getOllamaHost() {
  const raw = String(DEFAULT_OLLAMA_HOST || '').trim();
  const noSlash = raw.replace(/\/+$/, '');

  if (!noSlash) return 'http://localhost:11434';
  if (/^https?:\/\//i.test(noSlash)) return noSlash;

  return `http://${noSlash}`;
}


function getModel() {
  return DEFAULT_MODEL;
}

function toolInstruction(tools) {
  // We intentionally do NOT rely on model-native tool calling.
  // Instead, we force a single, parseable JSON toolcall format.
  const toolNames = tools.map((t) => t.name);
  return [
    '## Tool Use',
    'You MAY call tools. If and only if you want to call a tool, output exactly one tool call in the following format, and nothing else:',
    '',
    '<toolcall>{"tool":"TOOL_NAME","args":{...}}</toolcall>',
    '',
    `Valid TOOL_NAME values: ${toolNames.join(', ') || '(none)'}.`,
    'After I return <toolresult>...</toolresult>, continue normally with a user-facing response.',
    'Never wrap <toolcall> in markdown fences. Never output multiple tool calls in one turn.',
  ].join('\n');
}

function extractToolCall(text) {
  const s = String(text || '');
  const m = s.match(/<toolcall>([\s\S]*?)<\/toolcall>/i);
  if (!m) return null;
  const raw = m[1].trim();
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.tool !== 'string') return null;
    if (obj.args && typeof obj.args !== 'object') return null;
    return { tool: obj.tool, args: obj.args || {} };
  } catch {
    return null;
  }
}

async function callOllamaChat({ system, messages, model, maxTokens }) {
  const host = getOllamaHost();
  const r = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages,
      ],
      options: {
        // Keep deterministic-ish for tool parsing.
        temperature: Number(process.env.OLLAMA_TEMPERATURE ?? 0.2),
        num_predict: maxTokens ?? 1024,
      },
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Ollama chat error: HTTP ${r.status} ${t}`);
  }

  const data = await r.json();
  const content = data?.message?.content;
  return String(content || '').trim();
}

/**
 * Process a conversation turn with Ollama, handling tool calls via <toolcall> JSON.
 * History format: [{role:'user'|'assistant', content:'...'}]
 */
async function chat(userMessage, history, toolDefinitions, toolExecutors) {
  const systemPrompt = render_md(path.join(__dirname, '..', '..', 'operating_system', 'CHATBOT.md'));
  const system = `${systemPrompt}\n\n${toolInstruction(toolDefinitions)}`;

  const messages = [...(history || []), { role: 'user', content: String(userMessage || '') }];

  // If user approves, bypass the model and create the job directly from the last drafted description.
  if (isApprovalMessage(userMessage)) {
    const drafted = extractJobDescriptionFromLastAssistant(history || []);
    if (drafted) {
      const executor = toolExecutors['create_job'];
      if (!executor) {
        return { response: 'Approval received, but create_job tool is not available.', history: messages };
      }

      const result = await executor({ job_description: drafted });

      const response = result?.success
        ? `Approved. Job created.\nJob ID: ${result.job_id}\nBranch: ${result.branch}`
        : `Approved, but job creation failed: ${JSON.stringify(result)}`;

      // Update history so conversation stays coherent
      messages.push({ role: 'assistant', content: response });
      return { response, history: messages };
    }
  }


  // Tool loop (bounded)
  for (let i = 0; i < 5; i++) {
    const assistantText = await callOllamaChat({
      system,
      messages,
      model: getModel(),
      maxTokens: 1024,
    });

    messages.push({ role: 'assistant', content: assistantText });

    const tc = extractToolCall(assistantText);
    if (!tc) {
      return { response: assistantText, history: messages };
    }

    const executor = toolExecutors[tc.tool];
    let result;
    if (!executor) {
      result = { error: `Unknown tool: ${tc.tool}` };
    } else {
      try {
        result = await executor(tc.args);
      } catch (err) {
        result = { error: err?.message || String(err) };
      }
    }

    messages.push({
      role: 'user',
      content: `<toolresult>${JSON.stringify(result)}</toolresult>`,
    });
  }

  return {
    response: 'I could not complete the tool sequence safely (too many tool loops).',
    history: messages,
  };
}

async function summarizeJobWithLlm({ systemPromptPath, userMessage }) {
  const systemPrompt = render_md(systemPromptPath);
  const text = await callOllamaChat({
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    model: getModel(),
    maxTokens: 800,
  });
  return text || 'Job completed.';
}

module.exports = {
  chat,
  summarizeJobWithLlm,
};
