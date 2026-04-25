import http from 'http';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config.js';
import { getCustomProvider } from '../db/config.js';
import { BUILTIN_PROVIDERS } from '../llm-providers.js';
import { PROJECT_ROOT } from '../paths.js';

const workspacesDir = path.join(PROJECT_ROOT, 'data/workspaces');

// UID/GID of the coding-agent user inside agent containers (pinned in Dockerfile)
const CODING_AGENT_UID = 1001;

/**
 * Shared parser for Docker multiplexed stream format.
 * Every Docker log/exec stream wraps output in 8-byte frames:
 * [type(1B) + padding(3B) + size(4B big-endian)] + payload
 * Type 1 = stdout, Type 2 = stderr.
 *
 * Usage:
 *   Streaming: const parser = new DockerFrameParser();
 *              parser.push(chunk) → [{ stream, text }, ...]
 *   Batch:     DockerFrameParser.parse(buf) → [{ stream, text }, ...]
 */
class DockerFrameParser {
  constructor() { this.buf = Buffer.alloc(0); }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames = [];
    while (this.buf.length >= 8) {
      const size = this.buf.readUInt32BE(4);
      if (this.buf.length < 8 + size) break;
      frames.push({
        stream: this.buf[0] === 2 ? 'stderr' : 'stdout',
        text: this.buf.slice(8, 8 + size).toString('utf8'),
      });
      this.buf = this.buf.slice(8 + size);
    }
    return frames;
  }

  static parse(buf) {
    return new DockerFrameParser().push(buf);
  }
}

/**
 * Make a request to the Docker Engine API via Unix socket.
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {object} [body] - Request body
 * @returns {Promise<object>} Parsed JSON response
 */
function dockerApi(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: '/var/run/docker.sock',
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, data: { message: data } });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Make a raw streaming request to the Docker Engine API via Unix socket.
 * Returns the raw http.IncomingMessage (readable stream).
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @returns {Promise<http.IncomingMessage>}
 */
function dockerApiStream(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: '/var/run/docker.sock',
      path,
      method,
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/**
 * Derive the workspace directory path from a workspace ID.
 * @param {string} workspaceId
 * @returns {string}
 */
function workspaceDir(workspaceId) {
  const shortId = workspaceId.replace(/-/g, '').slice(0, 8);
  return path.join(workspacesDir, `workspace-${shortId}`);
}

/**
 * Auto-detect the Docker network by inspecting the event-handler container.
 * @returns {Promise<string>} Network name
 */
async function detectNetwork() {
  try {
    const { status, data } = await dockerApi('GET', '/containers/thepopebot-event-handler/json');
    if (status === 200 && data.NetworkSettings?.Networks) {
      const networks = Object.keys(data.NetworkSettings.Networks);
      if (networks.length > 0) return networks[0];
    }
  } catch {}
  return 'bridge';
}

/**
 * Generic container creation and start.
 * @param {object} options
 * @param {string} options.containerName - Docker container name
 * @param {string} options.image - Docker image reference
 * @param {string[]} [options.env] - Environment variables
 * @param {object} [options.hostConfig] - Docker HostConfig overrides
 * @returns {Promise<{containerId: string, containerName: string}>}
 */
async function runContainer({ containerName, image, env = [], workingDir, hostConfig = {} }) {
  const network = await detectNetwork();
  if (!hostConfig.NetworkMode) {
    hostConfig.NetworkMode = network;
  }

  // Pull image if not present locally
  const inspectRes = await dockerApi('GET', `/images/${encodeURIComponent(image)}/json`);
  if (inspectRes.status !== 200) {
    const [fromImage, tag] = image.includes(':') ? image.split(':') : [image, 'latest'];
    const pullRes = await dockerApi('POST', `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`);
    if (pullRes.status !== 200) {
      throw new Error(`Docker pull failed (${pullRes.status}): ${pullRes.data?.message || JSON.stringify(pullRes.data)}`);
    }
    // Docker pull streams newline-delimited JSON — errors appear inside the stream, not as HTTP status
    const raw = pullRes.data?.message || (typeof pullRes.data === 'string' ? pullRes.data : '');
    if (raw) {
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.error) {
            throw new Error(`Docker pull failed: ${obj.error}`);
          }
        } catch (e) {
          if (e.message.startsWith('Docker pull failed')) throw e;
        }
      }
    }
  }

  // Create container
  const createRes = await dockerApi('POST', `/containers/create?name=${encodeURIComponent(containerName)}`, {
    Image: image,
    Env: env,
    ...(workingDir ? { WorkingDir: workingDir } : {}),
    HostConfig: hostConfig,
  });

  if (createRes.status !== 201) {
    throw new Error(`Docker create failed (${createRes.status}): ${createRes.data?.message || JSON.stringify(createRes.data)}`);
  }

  const containerId = createRes.data.Id;

  // Start container
  const startRes = await dockerApi('POST', `/containers/${containerId}/start`);
  if (startRes.status !== 204 && startRes.status !== 304) {
    throw new Error(`Docker start failed (${startRes.status}): ${startRes.data?.message || JSON.stringify(startRes.data)}`);
  }

  return { containerId, containerName };
}

/**
 * Create and start an interactive code workspace Docker container.
 * @param {object} options
 * @param {string} options.containerName - Docker container name
 * @param {string} options.repo - GitHub repo full name (e.g. "owner/repo")
 * @param {string} options.branch - Git branch name
 * @param {string} [options.codingAgent] - Coding agent identifier (falls back to CODING_AGENT config)
 * @param {string} [options.featureBranch] - Feature branch to create after cloning
 * @param {string} [options.workspaceId] - Workspace ID (for bind mount)
 * @param {boolean} [options.injectSecrets] - Inject agent job secrets into container env
 * @param {string} [options.systemPrompt] - Pre-rendered system prompt (written to volume as SYSTEM.md)
 * @param {string} [options.scope] - Subdirectory scope within the repo (e.g., 'agents/gary-v')
 * @returns {Promise<{containerId: string, containerName: string}>}
 */
async function runInteractiveContainer({ containerName, repo, branch, codingAgent, featureBranch, workspaceId, injectSecrets, systemPrompt, continueSession = true, scope }) {
  const agent = codingAgent || getConfig('CODING_AGENT') || 'claude-code';
  const version = process.env.THEPOPEBOT_VERSION;
  const image = `stephengpope/thepopebot:coding-agent-${agent}-${version}`;

  const env = [
    `RUNTIME=interactive`,
    `REPO=${repo}`,
    `BRANCH=${branch}`,
  ];

  // Auth env vars based on agent type
  const { env: authEnv, backendApi } = buildAgentAuthEnv(agent);
  env.push(...authEnv);

  const ghToken = getConfig('GH_TOKEN');
  if (ghToken) {
    env.push(`GH_TOKEN=${ghToken}`);
  }
  if (featureBranch) {
    env.push(`FEATURE_BRANCH=${featureBranch}`);
  }
  if (continueSession) {
    env.push(`CONTINUE_SESSION=1`);
  }
  if (scope) {
    env.push(`SCOPE=${scope}`);
  }

  // Inject agent job secrets when running in agent chat mode
  if (injectSecrets) {
    const { getAllAgentJobSecrets } = await import('../db/config.js');
    const jobSecrets = getAllAgentJobSecrets();
    for (const { key, value } of jobSecrets) {
      if (value !== null && !env.some(e => e.startsWith(`${key}=`))) {
        env.push(`${key}=${value}`);
      }
    }
    // Create per-container API key for agent-secrets access
    const { createAgentJobApiKey } = await import('../db/api-keys.js');
    const { key: agentJobToken } = createAgentJobApiKey(containerName);
    env.push(`AGENT_JOB_TOKEN=${agentJobToken}`);
    const appUrl = getConfig('APP_URL');
    if (appUrl) env.push(`APP_URL=${appUrl}`);
  }

  const hostConfig = {};
  if (workspaceId) {
    const dir = workspaceDir(workspaceId);
    const wsDir = path.join(dir, 'workspace');
    fs.mkdirSync(wsDir, { recursive: true });

    // Write pre-rendered system prompt to volume (read by container setup scripts)
    const systemPromptPath = path.join(dir, 'SYSTEM.md');
    if (systemPrompt) {
      fs.writeFileSync(systemPromptPath, systemPrompt, 'utf8');
    } else {
      // Remove stale prompt if no system prompt for this mode
      try { fs.unlinkSync(systemPromptPath); } catch {}
    }

    const hostDir = await resolveHostPath(dir);
    hostConfig.Binds = [`${hostDir}:/home/coding-agent`];
  }

  const result = await runContainer({ containerName, image, env, hostConfig });
  return { ...result, backendApi };
}

/**
 * Inspect a Docker container by name.
 * @param {string} containerName
 * @returns {Promise<object|null>} Container info or null if not found
 */
async function inspectContainer(containerName) {
  const { status, data } = await dockerApi('GET', `/containers/${encodeURIComponent(containerName)}/json`);
  if (status === 404) return null;
  if (status === 200) return data;
  throw new Error(`Docker inspect failed (${status}): ${data?.message || JSON.stringify(data)}`);
}

/**
 * Start a stopped Docker container.
 * @param {string} containerName
 */
async function startContainer(containerName) {
  const { status, data } = await dockerApi('POST', `/containers/${encodeURIComponent(containerName)}/start`);
  if (status === 204 || status === 304) return;
  throw new Error(`Docker start failed (${status}): ${data?.message || JSON.stringify(data)}`);
}

/**
 * Force-remove a Docker container.
 * @param {string} containerName
 */
async function removeContainer(containerName) {
  const { status, data } = await dockerApi('DELETE', `/containers/${encodeURIComponent(containerName)}?force=true`);
  if (status === 204 || status === 404) return;
  throw new Error(`Docker remove failed (${status}): ${data?.message || JSON.stringify(data)}`);
}

/**
 * Build auth env vars for a coding agent based on its type and config.
 * @param {string} agent - 'claude-code', 'pi-coding-agent', 'gemini-cli', 'codex-cli', 'opencode'
 * @returns {{ env: string[], backendApi: string }} Environment variable strings and resolved backend
 */
function buildAgentAuthEnv(agent) {
  const env = [];
  let backendApi = 'anthropic';

  if (agent === 'claude-code') {
    backendApi = getConfig('CODING_AGENT_CLAUDE_CODE_BACKEND') || 'anthropic';

    if (backendApi === 'anthropic') {
      // Native Anthropic auth — OAuth or API Key
      const authMode = getConfig('CODING_AGENT_CLAUDE_CODE_AUTH') || 'oauth';
      if (authMode === 'oauth') {
        const token = getConfig('CLAUDE_CODE_OAUTH_TOKEN');
        if (token) env.push(`CLAUDE_CODE_OAUTH_TOKEN=${token}`);
      } else {
        const key = getConfig('ANTHROPIC_API_KEY');
        if (key) env.push(`ANTHROPIC_API_KEY=${key}`);
      }
      const model = getConfig('CODING_AGENT_CLAUDE_CODE_MODEL');
      if (model) env.push(`LLM_MODEL=${model}`);
    } else {
      const provider = BUILTIN_PROVIDERS[backendApi];
      if (provider?.anthropicEndpoint) {
        // Native Anthropic-compatible endpoint (DeepSeek, MiniMax, Kimi, OpenRouter)
        const apiKey = getConfig(provider.credentials[0].key);
        if (apiKey) env.push(`ANTHROPIC_AUTH_TOKEN=${apiKey}`);
        env.push(`ANTHROPIC_BASE_URL=${provider.anthropicEndpoint}`);
        const model = getConfig('CODING_AGENT_CLAUDE_CODE_MODEL');
        if (model) env.push(`ANTHROPIC_MODEL=${model}`);
      } else if (provider?.litellmProxy) {
        // Builtin OpenAI-only provider → route through LiteLLM sidecar
        const apiKey = getConfig(provider.credentials[0].key);
        if (apiKey) env.push(`ANTHROPIC_AUTH_TOKEN=${apiKey}`);
        env.push(`ANTHROPIC_BASE_URL=http://litellm:4000`);
        const model = getConfig('CODING_AGENT_CLAUDE_CODE_MODEL');
        if (model) env.push(`ANTHROPIC_MODEL=${provider.litellmPrefix}/${model}`);
      } else if (!provider) {
        // Custom provider → also route through LiteLLM
        const custom = getCustomProvider(backendApi);
        if (custom) {
          env.push(`ANTHROPIC_AUTH_TOKEN=${custom.apiKey || 'not-needed'}`);
          env.push(`ANTHROPIC_BASE_URL=http://litellm:4000`);
          const model = getConfig('CODING_AGENT_CLAUDE_CODE_MODEL');
          if (model) env.push(`ANTHROPIC_MODEL=${backendApi}/${model}`);
        }
      }
    }
  } else if (agent === 'pi-coding-agent' || agent === 'opencode' || agent === 'kimi-cli') {
    // Pi, OpenCode, and Kimi share the same multi-provider auth pattern
    const configPrefix = agent === 'opencode' ? 'CODING_AGENT_OPENCODE' : agent === 'kimi-cli' ? 'CODING_AGENT_KIMI_CLI' : 'CODING_AGENT_PI';
    const provider = getConfig(`${configPrefix}_PROVIDER`) || 'anthropic';
    backendApi = provider;
    const model = getConfig(`${configPrefix}_MODEL`);
    if (model) env.push(`LLM_MODEL=${model}`);

    const builtinKeyMap = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', google: 'GOOGLE_API_KEY', deepseek: 'DEEPSEEK_API_KEY', minimax: 'MINIMAX_API_KEY', mistral: 'MISTRAL_API_KEY', xai: 'XAI_API_KEY', openrouter: 'OPENROUTER_API_KEY', nvidia: 'NVIDIA_API_KEY' };
    if (builtinKeyMap[provider]) {
      const key = getConfig(builtinKeyMap[provider]);
      if (key) env.push(`${builtinKeyMap[provider]}=${key}`);
    } else {
      // Custom provider
      const custom = getCustomProvider(provider);
      if (custom) {
        env.push(`CUSTOM_OPENAI_BASE_URL=${custom.baseUrl}`);
        if (custom.apiKey) env.push(`CUSTOM_API_KEY=${custom.apiKey}`);
        if (custom.models?.[0] && !model) env.push(`LLM_MODEL=${custom.models[0]}`);
      }
    }
  } else if (agent === 'gemini-cli') {
    backendApi = 'google';
    const key = getConfig('GOOGLE_API_KEY');
    if (key) env.push(`GOOGLE_API_KEY=${key}`);
    const model = getConfig('CODING_AGENT_GEMINI_CLI_MODEL');
    if (model) env.push(`LLM_MODEL=${model}`);
  } else if (agent === 'codex-cli') {
    backendApi = 'openai';
    const authMode = getConfig('CODING_AGENT_CODEX_CLI_AUTH') || 'api-key';
    if (authMode === 'oauth') {
      const token = getConfig('CODEX_OAUTH_TOKEN');
      if (token) env.push(`CODEX_OAUTH_TOKEN=${token}`);
    } else {
      const key = getConfig('OPENAI_API_KEY');
      if (key) env.push(`OPENAI_API_KEY=${key}`);
    }
    const model = getConfig('CODING_AGENT_CODEX_CLI_MODEL');
    if (model) env.push(`LLM_MODEL=${model}`);
  }
  return { env, backendApi };
}

/**
 * Create and start a headless coding agent container.
 * Runs a task via the agent, commits, and merges back. Ephemeral — exits when done.
 * @param {object} options
 * @param {string} options.containerName - Docker container name
 * @param {string} options.repo - GitHub repo full name
 * @param {string} options.branch - Base branch
 * @param {string} [options.featureBranch] - Feature branch name
 * @param {string} [options.workspaceId] - Workspace ID (for bind mount, or null for ephemeral)
 * @param {string} options.taskPrompt - Task description for the agent
 * @param {string} [options.mode='plan'] - Permission mode
 * @param {string} [options.codingAgent] - Agent override (falls back to CODING_AGENT config)
 * @param {string} [options.systemPrompt] - Optional system prompt
 * @param {boolean} [options.continueSession] - Continue most recent session
 * @param {boolean} [options.injectSecrets] - Inject agent job secrets into container env
 * @param {string} [options.scope] - Subdirectory scope within the repo (e.g., 'agents/gary-v')
 * @returns {Promise<{containerId: string, containerName: string}>}
 */
async function runHeadlessContainer({ containerName, repo, branch, featureBranch, workspaceId, taskPrompt, mode = 'plan', codingAgent, systemPrompt, continueSession = true, injectSecrets, scope }) {
  const agent = codingAgent || getConfig('CODING_AGENT') || 'claude-code';
  const version = process.env.THEPOPEBOT_VERSION;
  const image = `stephengpope/thepopebot:coding-agent-${agent}-${version}`;

  const env = [
    `RUNTIME=headless`,
    `REPO=${repo}`,
    `BRANCH=${branch}`,
    `PROMPT=${taskPrompt}`,
  ];
  if (featureBranch) {
    env.push(`FEATURE_BRANCH=${featureBranch}`);
  }
  if (mode) {
    // Map 'dangerous' to 'code', keep 'plan' as-is
    const permission = mode === 'dangerous' ? 'code' : mode;
    env.push(`PERMISSION=${permission}`);
  }
  if (continueSession) {
    env.push(`CONTINUE_SESSION=1`);
  }
  if (scope) {
    env.push(`SCOPE=${scope}`);
  }

  // Auth env vars based on agent type
  const { env: authEnv, backendApi } = buildAgentAuthEnv(agent);
  env.push(...authEnv);

  const ghToken = getConfig('GH_TOKEN');
  if (ghToken) {
    env.push(`GH_TOKEN=${ghToken}`);
  }

  // Inject agent job secrets when running in agent chat mode
  if (injectSecrets) {
    const { getAllAgentJobSecrets } = await import('../db/config.js');
    const jobSecrets = getAllAgentJobSecrets();
    for (const { key, value } of jobSecrets) {
      if (value !== null && !env.some(e => e.startsWith(`${key}=`))) {
        env.push(`${key}=${value}`);
      }
    }
    // Create per-container API key for agent-secrets access
    const { createAgentJobApiKey } = await import('../db/api-keys.js');
    const { key: agentJobToken } = createAgentJobApiKey(containerName);
    env.push(`AGENT_JOB_TOKEN=${agentJobToken}`);
    const appUrl = getConfig('APP_URL');
    if (appUrl) env.push(`APP_URL=${appUrl}`);
  }

  const hostConfig = {};
  if (workspaceId) {
    const dir = workspaceDir(workspaceId);
    const wsDir = path.join(dir, 'workspace');
    fs.mkdirSync(wsDir, { recursive: true });

    // Write pre-rendered system prompt to volume (read by container setup scripts)
    const systemPromptPath = path.join(dir, 'SYSTEM.md');
    if (systemPrompt) {
      fs.writeFileSync(systemPromptPath, systemPrompt, 'utf8');
    } else {
      try { fs.unlinkSync(systemPromptPath); } catch {}
    }

    const hostDir = await resolveHostPath(dir);
    hostConfig.Binds = [`${hostDir}:/home/coding-agent`];
  }

  // Debug: log env var keys being passed (not values)
  console.log(`[headless] agent=${agent} image=${image} backendApi=${backendApi} authEnv=[${authEnv.map(e => e.split('=')[0]).join(',')}] envCount=${env.length}`);

  const result = await runContainer({ containerName, image, env, hostConfig });
  return { ...result, backendApi };
}

/**
 * Create and start a cluster worker container.
 * @param {object} options
 * @param {string} options.containerName - Stable container name
 * @param {string} [options.image] - Docker image (defaults to coding-agent image)
 * @param {string} [options.codingAgent] - Agent override (falls back to CODING_AGENT config)
 * @param {string[]} [options.env] - Environment variables
 * @param {string[]} [options.binds] - Bind mount strings
 * @returns {Promise<{containerId: string, containerName: string}>}
 */
async function runClusterWorkerContainer({ containerName, image, codingAgent, env = [], binds = [], workingDir }) {
  const version = process.env.THEPOPEBOT_VERSION;
  const agent = codingAgent || getConfig('CODING_AGENT') || 'claude-code';
  const resolvedImage = image || `stephengpope/thepopebot:coding-agent-${agent}-${version}`;

  // Prepend RUNTIME and agent auth env vars
  const { env: authEnv, backendApi } = buildAgentAuthEnv(agent);
  const fullEnv = [
    `RUNTIME=cluster-worker`,
    ...authEnv,
    ...env,
  ];

  const result = await runContainer({
    containerName,
    image: resolvedImage,
    env: fullEnv,
    workingDir,
    hostConfig: {
      AutoRemove: true,
      ...(binds.length > 0 ? { Binds: binds } : {}),
    },
  });
  return { ...result, backendApi };
}

/**
 * Check if a workspace directory exists on disk.
 * @param {string} workspaceId
 * @returns {boolean}
 */
function workspaceDirExists(workspaceId) {
  return fs.existsSync(workspaceDir(workspaceId));
}

/**
 * Run a workspace command container (ephemeral).
 * Mounts the existing workspace directory and runs a command/* runtime.
 * @param {object} options
 * @param {string} options.containerName - Docker container name
 * @param {string} options.command - Command name (e.g. 'commit-to-main', 'create-pr', 'rebase')
 * @param {string} options.workspaceId - Workspace ID (for bind mount)
 * @param {string} options.repo - GitHub repo full name
 * @param {string} options.branch - Base branch
 * @param {string} [options.featureBranch] - Feature branch name
 * @param {string} [options.prompt] - Task prompt for agent-run steps
 * @param {boolean} [options.draft] - Whether to create a draft PR
 * @param {string} [options.codingAgent] - Agent override
 * @returns {Promise<{containerId: string, containerName: string}>}
 */
async function runCommandContainer({ containerName, command, workspaceId, repo, branch, featureBranch, prompt, draft, codingAgent }) {
  const agent = codingAgent || getConfig('CODING_AGENT') || 'claude-code';
  const version = process.env.THEPOPEBOT_VERSION;
  const image = `stephengpope/thepopebot:coding-agent-${agent}-${version}`;

  const env = [
    `RUNTIME=command/${command}`,
    `REPO=${repo}`,
    `BRANCH=${branch || 'main'}`,
  ];

  if (featureBranch) {
    env.push(`FEATURE_BRANCH=${featureBranch}`);
  }
  if (prompt) {
    env.push(`PROMPT=${prompt}`);
  }
  if (draft) {
    env.push(`DRAFT=1`);
  }

  // Auth env vars based on agent type
  const { env: authEnv } = buildAgentAuthEnv(agent);
  env.push(...authEnv);

  const ghToken = getConfig('GH_TOKEN');
  if (ghToken) {
    env.push(`GH_TOKEN=${ghToken}`);
  }

  const dir = workspaceDir(workspaceId);
  const hostDir = await resolveHostPath(dir);
  const hostConfig = {
    Binds: [`${hostDir}:/home/coding-agent`],
  };

  console.log(`[command] command=${command} agent=${agent} image=${image} workspace=${dir}`);

  return runContainer({ containerName, image, env, hostConfig });
}

/**
 * Execute a command inside a running container and return stdout.
 * Uses Docker Engine API exec endpoints via Unix socket.
 * @param {string} containerName
 * @param {string} cmd - Shell command to run
 * @param {number} [timeoutMs=5000] - Timeout in milliseconds
 * @returns {Promise<string|null>} stdout or null on failure
 */
async function execInContainer(containerName, cmd, timeoutMs = 5000) {
  try {
    // Create exec instance
    const createRes = await dockerApi('POST',
      `/containers/${encodeURIComponent(containerName)}/exec`,
      { Cmd: ['sh', '-c', cmd], AttachStdout: true, AttachStderr: false }
    );
    if (createRes.status !== 201 || !createRes.data?.Id) {
      console.error(`[execInContainer] exec create failed (${createRes.status}): container=${containerName}`, createRes.data?.message || '');
      return null;
    }

    const execId = createRes.data.Id;

    // Start exec and capture raw output as Buffer (not string — avoids binary corruption)
    const buf = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      const req = http.request({
        socketPath: '/var/run/docker.sock',
        path: `/exec/${execId}/start`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
      });
      req.on('error', (err) => { clearTimeout(timer); reject(err); });
      req.write(JSON.stringify({ Detach: false, Tty: false }));
      req.end();
    });

    // Parse Docker multiplexed frames, keep stdout only
    const frames = DockerFrameParser.parse(buf);
    let stdout = '';
    for (const f of frames) { if (f.stream === 'stdout') stdout += f.text; }

    return stdout;
  } catch (err) {
    console.error(`[execInContainer] container=${containerName} cmd=${cmd}`, err.message || err);
    return null;
  }
}

/**
 * Tail container logs as a readable stream.
 * @param {string} containerName
 * @returns {Promise<http.IncomingMessage>} Raw readable stream of stdout+stderr
 */
async function tailContainerLogs(containerName) {
  const res = await dockerApiStream('GET',
    `/containers/${encodeURIComponent(containerName)}/logs?stdout=true&stderr=true&follow=true&tail=all`
  );
  return res;
}

/**
 * Wait for a container to exit and return its exit code.
 * @param {string} containerName
 * @returns {Promise<number>} Exit code
 */
async function waitForContainer(containerName) {
  const { status, data } = await dockerApi('POST', `/containers/${encodeURIComponent(containerName)}/wait`);
  if (status === 200) return data.StatusCode;
  throw new Error(`Docker wait failed (${status}): ${data?.message || JSON.stringify(data)}`);
}

/**
 * Get all logs from a container (stdout + stderr).
 * Parses Docker's multiplexed stream format (8-byte frame headers).
 * @param {string} containerName
 * @returns {Promise<string>} Combined output
 */
async function getContainerLogs(containerName) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: '/var/run/docker.sock',
      path: `/containers/${encodeURIComponent(containerName)}/logs?stdout=true&stderr=true&follow=false`,
      method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // Parse Docker multiplexed frames, keep both stdout and stderr
        const frames = DockerFrameParser.parse(buf);
        let output = '';
        for (const f of frames) output += f.text;
        resolve(output);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Remove the workspace directory from disk.
 * @param {string} workspaceId
 */
function removeWorkspaceDir(workspaceId) {
  const dir = workspaceDir(workspaceId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Stop a running Docker container.
 * @param {string} containerName
 */
async function stopContainer(containerName) {
  const { status, data } = await dockerApi('POST', `/containers/${encodeURIComponent(containerName)}/stop`);
  if (status === 204 || status === 304 || status === 404) return;
  throw new Error(`Docker stop failed (${status}): ${data?.message || JSON.stringify(data)}`);
}

/**
 * Restart the litellm container (if running) to pick up new env/config.
 * Silently ignores if the container doesn't exist.
 */
async function restartLitellm() {
  try {
    // Find litellm container by name pattern (compose names it with a project prefix)
    const filters = JSON.stringify({ name: ['litellm'], status: ['running'] });
    const { status, data } = await dockerApi('GET', `/containers/json?filters=${encodeURIComponent(filters)}`);
    if (status !== 200 || !data?.length) return;
    const containerId = data[0].Id;
    await dockerApi('POST', `/containers/${containerId}/restart`);
  } catch {
    // Silently ignore — litellm may not be running
  }
}

/**
 * Resolve a container-internal path to the corresponding host path for bind mounts.
 * Inside the event-handler container, paths like /app/data/... need to be translated
 * to the actual host path. Inspects our own container's mounts to find the best match.
 * @param {string} containerPath
 * @returns {Promise<string>} Host path, or original if not running in Docker
 */
let _hostMounts = undefined;
async function resolveHostPath(containerPath) {
  if (_hostMounts === undefined) {
    _hostMounts = [];
    try {
      const { status, data } = await dockerApi('GET', '/containers/thepopebot-event-handler/json');
      if (status === 200 && data.Mounts) {
        for (const m of data.Mounts) {
          if (m.Type === 'bind' && m.Destination && m.Source) {
            _hostMounts.push({ dest: m.Destination, source: m.Source });
          }
        }
        // Sort by destination length descending for longest-prefix-first matching
        _hostMounts.sort((a, b) => b.dest.length - a.dest.length);
      }
    } catch {}
  }
  for (const mount of _hostMounts) {
    if (containerPath === mount.dest) {
      return mount.source;
    }
    if (containerPath.startsWith(mount.dest + '/')) {
      return mount.source + containerPath.slice(mount.dest.length);
    }
  }
  return containerPath;
}

/**
 * Get live stats for a container (CPU, memory, network).
 * @param {string} containerName
 * @returns {Promise<{ cpu: number, memUsage: number, memLimit: number, netRx: number, netTx: number } | null>}
 */
async function getContainerStats(containerName) {
  try {
    const { status, data } = await dockerApi('GET',
      `/containers/${encodeURIComponent(containerName)}/stats?stream=false`
    );
    if (status !== 200 || !data) return null;

    // CPU % from delta
    const cpuDelta = (data.cpu_stats?.cpu_usage?.total_usage || 0) - (data.precpu_stats?.cpu_usage?.total_usage || 0);
    const systemDelta = (data.cpu_stats?.system_cpu_usage || 0) - (data.precpu_stats?.system_cpu_usage || 0);
    const numCpus = data.cpu_stats?.online_cpus || data.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
    const cpu = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

    // Memory
    const memUsage = data.memory_stats?.usage || 0;
    const memLimit = data.memory_stats?.limit || 0;

    // Network (sum all interfaces)
    let netRx = 0, netTx = 0;
    if (data.networks) {
      for (const iface of Object.values(data.networks)) {
        netRx += iface.rx_bytes || 0;
        netTx += iface.tx_bytes || 0;
      }
    }

    return { cpu: Math.round(cpu * 100) / 100, memUsage, memLimit, netRx, netTx };
  } catch {
    return null;
  }
}

/**
 * List containers matching a name prefix.
 * @param {string} namePrefix - Container name prefix to filter by
 * @returns {Promise<Array<{ id: string, name: string, state: string }>>}
 */
async function listContainers(namePrefix) {
  const filters = JSON.stringify({ name: [`^/${namePrefix}`] });
  const { status, data } = await dockerApi('GET',
    `/containers/json?all=true&filters=${encodeURIComponent(filters)}`
  );
  if (status !== 200 || !Array.isArray(data)) return [];
  return data.map((c) => ({
    id: c.Id,
    name: (c.Names?.[0] || '').replace(/^\//, ''),
    state: c.State,
  }));
}

/**
 * List all containers on the detected compose network.
 * @returns {Promise<Array<{ id: string, name: string, state: string, status: string, image: string }>>}
 */
async function listNetworkContainers() {
  const network = await detectNetwork();
  const filters = JSON.stringify({ network: [network] });
  const { status, data } = await dockerApi('GET',
    `/containers/json?all=true&filters=${encodeURIComponent(filters)}`
  );
  if (status !== 200 || !Array.isArray(data)) return [];
  return data.map((c) => ({
    id: c.Id,
    name: (c.Names?.[0] || '').replace(/^\//, ''),
    state: c.State,
    status: c.Status,
    image: c.Image,
  }));
}

/**
 * Create a named Docker volume.
 * @param {string} name - Volume name
 * @returns {Promise<string>} Volume name
 */
async function createVolume(name) {
  const { status, data } = await dockerApi('POST', '/volumes/create', { Name: name });
  if (status !== 201 && status !== 200) {
    throw new Error(`Docker volume create failed (${status}): ${data?.message || JSON.stringify(data)}`);
  }
  return name;
}

/**
 * Remove a Docker volume by name.
 * @param {string} name - Volume name
 */
async function removeVolume(name) {
  const { status, data } = await dockerApi('DELETE', `/volumes/${encodeURIComponent(name)}`);
  if (status === 204 || status === 404) return;
  throw new Error(`Docker volume remove failed (${status}): ${data?.message || JSON.stringify(data)}`);
}

/**
 * Create and start an agent-job container.
 * Runs an autonomous task: clones repo, runs agent, commits, creates PR.
 * Uses a named volume for workspace (cleaned up by caller after exit).
 * @param {object} options
 * @param {string} options.agentJobId - Agent job UUID
 * @param {string} options.repo - GitHub owner/repo slug
 * @param {string} options.branch - Branch name (agent-job/{id})
 * @param {string} options.title - Job title for commit/PR
 * @param {string} options.description - Job description (agent prompt)
 * @param {string} [options.codingAgent] - Agent override
 * @param {string} [options.llmModel] - Model override
 * @returns {Promise<{containerId: string, containerName: string, volumeName: string}>}
 */
async function runAgentJobContainer({ agentJobId, repo, branch, title, description, codingAgent, llmModel, scope }) {
  const agent = codingAgent || getConfig('CODING_AGENT') || 'claude-code';
  const version = process.env.THEPOPEBOT_VERSION;
  const image = `stephengpope/thepopebot:coding-agent-${agent}-${version}`;

  const shortId = agentJobId.replace(/-/g, '').slice(0, 8);
  const containerName = `thepopebot-agent-job-${shortId}`;
  const volumeName = `agent-job-${shortId}`;

  // Create named volume for workspace
  await createVolume(volumeName);

  const env = [
    `RUNTIME=agent-job`,
    `REPO=${repo}`,
    `BRANCH=${branch}`,
    `AGENT_JOB_ID=${agentJobId}`,
    `AGENT_JOB_TITLE=${title}`,
    `AGENT_JOB_DESCRIPTION=${description}`,
  ];

  if (llmModel) {
    env.push(`LLM_MODEL=${llmModel}`);
  }
  if (scope) {
    env.push(`SCOPE=${scope}`);
  }

  // Auth env vars based on agent type
  const { env: authEnv, backendApi } = buildAgentAuthEnv(agent);
  env.push(...authEnv);

  const ghToken = getConfig('GH_TOKEN');
  if (ghToken) {
    env.push(`GH_TOKEN=${ghToken}`);
  }

  // Inject APP_URL so agents can call back to the event handler
  const appUrl = getConfig('APP_URL');
  if (appUrl) env.push(`APP_URL=${appUrl}`);

  // Create per-container API key for agent-secrets access
  const { createAgentJobApiKey } = await import('../db/api-keys.js');
  const { key: agentJobToken } = createAgentJobApiKey(containerName);
  env.push(`AGENT_JOB_TOKEN=${agentJobToken}`);

  // Inject agent job secrets (plain secrets as env vars; oauth types are null — agent must fetch via get)
  const { getAllAgentJobSecrets } = await import('../db/config.js');
  const jobSecrets = getAllAgentJobSecrets();
  for (const { key, value } of jobSecrets) {
    if (value !== null && !env.some(e => e.startsWith(`${key}=`))) {
      env.push(`${key}=${value}`);
    }
  }

  console.log(`[agent-job] id=${shortId} agent=${agent} image=${image} backendApi=${backendApi}`);

  const result = await runContainer({
    containerName,
    image,
    env,
    hostConfig: {
      AutoRemove: true,
      Binds: [`${volumeName}:/home/coding-agent`],
    },
  });

  return { ...result, volumeName, backendApi };
}

async function saveContainerLogs(containerName) {
  const logsDir = path.join(PROJECT_ROOT, 'data', 'logs', 'containers');
  fs.mkdirSync(logsDir, { recursive: true });
  try {
    const logs = await getContainerLogs(containerName);
    if (!logs) return;
    const meta = { containerName, capturedAt: new Date().toISOString(), logs };
    fs.writeFileSync(
      path.join(logsDir, `${containerName}.json`),
      JSON.stringify(meta)
    );
  } catch {}
}

export {
  CODING_AGENT_UID,
  DockerFrameParser,
  runInteractiveContainer,
  runHeadlessContainer,
  runClusterWorkerContainer,
  runCommandContainer,
  runAgentJobContainer,
  workspaceDirExists,
  workspaceDir,
  inspectContainer,
  startContainer,
  stopContainer,
  removeContainer,
  execInContainer,
  tailContainerLogs,
  waitForContainer,
  getContainerLogs,
  removeWorkspaceDir,
  resolveHostPath,
  getContainerStats,
  listContainers,
  listNetworkContainers,
  createVolume,
  removeVolume,
  saveContainerLogs,
  restartLitellm,
  buildAgentAuthEnv,
};
