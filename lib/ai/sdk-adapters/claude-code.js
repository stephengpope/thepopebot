import path from 'path';
import fs from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getConfig } from '../../config.js';
import { buildAgentAuthEnv } from '../../tools/docker.js';
import { createAgentJobApiKey } from '../../db/api-keys.js';
import { getAllAgentJobSecrets } from '../../db/config.js';
import { claudeSearchOptions } from './web-search.js';

/**
 * Claude Agent SDK adapter. Wraps the SDK's query() and yields
 * the unified chunk format consumed by chatStream/api.js.
 *
 * @param {object} opts
 * @param {string} opts.prompt - User message
 * @param {string} opts.workspaceDir - Absolute path to workspace (git repo root)
 * @param {string} [opts.systemPrompt] - System prompt (agent mode only)
 * @param {string} [opts.sessionId] - Session ID to resume
 * @param {string} [opts.permissionMode] - 'plan' or 'code'
 * @param {Array} [opts.attachments] - Image attachments
 * @yields {{ type: 'text'|'tool-call'|'tool-result'|'meta'|'result'|'unknown', ... }}
 */
/**
 * Encode an absolute path the same way Claude Code encodes cwd for session storage.
 * Non-alphanumeric characters are replaced with '-'.
 */
function encodeCwd(absolutePath) {
  return absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Ensure the interactive container can find SDK-created sessions on the shared volume.
 *
 * The SDK stores sessions at $HOME/.claude/projects/<encoded-cwd>/. The interactive
 * container uses cwd=/home/coding-agent/workspace[/scope], but the SDK adapter uses
 * cwd=/app/data/workspaces/workspace-XXX/workspace[/scope] — different encoded paths.
 *
 * Creates a symlink so the interactive container's encoded path resolves to the
 * SDK adapter's encoded path, both on the same volume.
 *
 * @param {string} wsBaseDir - Volume root (e.g., /app/data/workspaces/workspace-XXX)
 * @param {string} sdkCwd - SDK's working directory (scoped, e.g., .../workspace/agents/gary-vee)
 * @param {string} interactiveCwd - Interactive container's equivalent cwd (e.g., /home/coding-agent/workspace/agents/gary-vee)
 */
function ensureSessionSymlink(wsBaseDir, sdkCwd, interactiveCwd) {
  const projectsDir = path.join(wsBaseDir, '.claude', 'projects');
  const sdkEncoded = encodeCwd(sdkCwd);
  const interactiveEncoded = encodeCwd(interactiveCwd);

  // Both point to the same dir — no symlink needed
  if (sdkEncoded === interactiveEncoded) return;

  fs.mkdirSync(path.join(projectsDir, sdkEncoded), { recursive: true });

  const symlinkPath = path.join(projectsDir, interactiveEncoded);
  try {
    const existing = fs.readlinkSync(symlinkPath);
    if (existing === sdkEncoded) return; // already correct
    fs.unlinkSync(symlinkPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // It's a real directory (not a symlink) — don't touch it
      if (err.code === 'EINVAL') return;
    }
  }

  try {
    fs.symlinkSync(sdkEncoded, symlinkPath);
  } catch {}
}

export async function* claudeCodeStream({ prompt, workspaceDir, systemPrompt, sessionId, permissionMode, attachments, workspaceId, chatMode, userId }) {
  // Point HOME at the workspace volume root (always one level above 'workspace/').
  // workspaceDir may be scoped (e.g., .../workspace/agents/gary-vee), so we can't
  // use path.dirname — derive from workspaceId instead.
  const { workspaceDir: getWsDir } = await import('../../tools/docker.js');
  const wsBaseDir = getWsDir(workspaceId);

  // Build the interactive container's equivalent cwd for session symlink
  const repoRoot = path.join(wsBaseDir, 'workspace');
  const scope = workspaceDir.startsWith(repoRoot) ? workspaceDir.slice(repoRoot.length) : '';
  const interactiveCwd = '/home/coding-agent/workspace' + scope;
  ensureSessionSymlink(wsBaseDir, workspaceDir, interactiveCwd);

  // Build a local env object with auth credentials from the settings DB.
  // Passed via the SDK's `env` option — no process.env mutation needed.
  const env = { ...process.env };
  env.HOME = wsBaseDir;
  try {
    const { env: authEnvPairs } = buildAgentAuthEnv('claude-code');
    for (const pair of authEnvPairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      }
    }

    // Clear conflicting auth vars so the SDK picks the right credential
    // Priority: ANTHROPIC_AUTH_TOKEN > CLAUDE_CODE_OAUTH_TOKEN > ANTHROPIC_API_KEY
    if (env.ANTHROPIC_AUTH_TOKEN) {
      delete env.ANTHROPIC_API_KEY;
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
    } else if (env.CLAUDE_CODE_OAUTH_TOKEN) {
      delete env.ANTHROPIC_API_KEY;
    }
  } catch (err) {
    console.error('[claude-code-sdk] Failed to resolve auth:', err.message);
    // Fall through — env may already have the right vars from process.env
  }

  env.USER_ID = userId;

  // Inject agent job secrets when in agent chat mode
  if (chatMode === 'agent') {
    const shortId = (workspaceId || '').replace(/-/g, '').slice(0, 8);
    const { key: agentJobToken } = createAgentJobApiKey(`claude-code-sdk-${shortId}`);
    env.AGENT_JOB_TOKEN = agentJobToken;
    const appUrl = getConfig('APP_URL');
    if (appUrl) env.APP_URL = appUrl;

    // Inject plain secrets as env vars (oauth types are null — agent fetches via skill)
    const jobSecrets = getAllAgentJobSecrets();
    for (const { key, value } of jobSecrets) {
      if (value !== null && !env[key]) {
        env[key] = value;
      }
    }
  }

  // Work around SDK musl/glibc detection bug — force glibc binary on Linux
  let executablePath;
  if (process.platform === 'linux') {
    try {
      executablePath = require.resolve(`@anthropic-ai/claude-agent-sdk-linux-${process.arch}/claude`);
    } catch {}
  }

  const options = {
    cwd: workspaceDir,
    env,
    includePartialMessages: true,
    model: getConfig('CODING_AGENT_CLAUDE_CODE_MODEL') || undefined,
    ...claudeSearchOptions(getConfig('CODING_AGENT_CLAUDE_CODE_SEARCH')),
    ...(executablePath ? { pathToClaudeCodeExecutable: executablePath } : {}),
  };

  // Permission mode: plan = read-only, anything else = full write access
  options.permissionMode = permissionMode === 'plan' ? 'plan' : 'bypassPermissions';

  if (sessionId) options.resume = sessionId;
  if (systemPrompt) {
    options.systemPrompt = { type: 'preset', preset: 'claude_code', append: systemPrompt };
  }

  // Build prompt — plain string when no attachments, SDKUserMessage with content blocks when there are
  let sdkPrompt = prompt;
  if (attachments?.length) {
    const content = [{ type: 'text', text: prompt }];
    for (const att of attachments) {
      if (att.category === 'image') {
        const data = att.dataUrl
          ? att.dataUrl.replace(/^data:[^;]+;base64,/, '')
          : att.data.toString('base64');
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: att.mimeType, data },
        });
      }
    }
    async function* makePrompt() {
      yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
    }
    sdkPrompt = makePrompt();
  }

  // Track tool call state for mapping stream events
  const activeToolCalls = new Map(); // index → { id, name, argsJson }
  const toolNamesById = new Map(); // toolCallId → toolName (persists for tool-result lookup)
  const activeThinkingBlocks = new Set(); // indices of active thinking blocks

  let sdkQuery;
  try {
    sdkQuery = query({ prompt: sdkPrompt, options });
    for await (const message of sdkQuery) {
      // ── system messages ──
      if (message.type === 'system') {
        if (message.subtype === 'init') {
          yield { type: 'meta', sessionId: message.session_id };
        }
        continue;
      }

      // ── rate limit events ──
      if (message.type === 'rate_limit_event') continue;

      // ── streaming events ──
      if (message.type === 'stream_event') {
        const event = message.event;

        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            activeToolCalls.set(event.index, { id: block.id, name: block.name, argsJson: '' });
            toolNamesById.set(block.id, block.name);
            yield { type: 'tool-call', toolCallId: block.id, toolName: block.name, args: {} };
          } else if (block.type === 'thinking') {
            activeThinkingBlocks.add(event.index);
            yield { type: 'thinking-start' };
          }
          // Skip 'text' start (deltas handle text)
          continue;
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const tc = activeToolCalls.get(event.index);
            if (tc) tc.argsJson += event.delta.partial_json;
          } else if (event.delta.type === 'thinking_delta') {
            yield { type: 'thinking', delta: event.delta.thinking };
          }
          continue;
        }

        if (event.type === 'content_block_stop') {
          if (activeThinkingBlocks.has(event.index)) {
            activeThinkingBlocks.delete(event.index);
            yield { type: 'thinking-end' };
          }
          const tc = activeToolCalls.get(event.index);
          if (tc && tc.argsJson) {
            try {
              const args = JSON.parse(tc.argsJson);
              yield { type: 'tool-call', toolCallId: tc.id, toolName: tc.name, args };
            } catch {}
          }
          activeToolCalls.delete(event.index);
          continue;
        }

        // message_start, message_delta, message_stop — skip
        continue;
      }

      // ── user messages (tool results) ──
      if (message.type === 'user') {
        const blocks = message.message?.content || [];
        for (const block of blocks) {
          if (block.type === 'tool_result') {
            const content = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n')
                : JSON.stringify(block.content);
            yield { type: 'tool-result', toolCallId: block.tool_use_id, toolName: toolNamesById.get(block.tool_use_id), result: content };
          }
        }
        continue;
      }

      // ── assistant messages — redundant with streaming, skip ──
      // But extract tool names so resumed tool-results can carry them.
      if (message.type === 'assistant') {
        const blocks = message.message?.content || [];
        for (const block of blocks) {
          if (block.type === 'tool_use' && block.id && block.name) {
            toolNamesById.set(block.id, block.name);
          }
        }
        continue;
      }

      // ── result ──
      if (message.type === 'result') {
        console.log(`[claude-code-sdk] ${message.subtype} cost=$${message.total_cost_usd?.toFixed(4)} duration=${message.duration_ms}ms`);
        yield {
          type: 'result',
          text: message.result || '',
          cost: message.total_cost_usd,
          duration: message.duration_ms,
          subtype: message.subtype,
        };
        continue;
      }

      // ── unknown ──
      yield { type: 'unknown', raw: message };
    }
  } catch (err) {
    console.error('[claude-code-sdk] Stream error:', err);
    throw err;
  } finally {
    // Returning from the chat consumer must also stop the SDK process and any
    // pending MCP work, rather than only closing its message iterator.
    sdkQuery?.close();
  }
}
