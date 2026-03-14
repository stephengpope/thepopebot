import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { clusterDataDir } from '../paths.js';
import { getConfig } from '../config.js';
import { stopContainer as dockerStopContainer, removeContainer, runClusterWorkerContainer, resolveHostPath, listContainers } from '../tools/docker.js';
import { getRoleWithCluster, getClusterRolesByCluster, roleShortId } from '../db/clusters.js';

/**
 * Compute naming for a cluster's Docker resources.
 * @param {object} cluster
 * @returns {{ project: string, dataDir: string }}
 */
export function clusterNaming(cluster) {
  const shortId = cluster.id.replace(/-/g, '').slice(0, 8);
  const project = `cluster-${shortId}`;
  return { project, dataDir: path.join(clusterDataDir, project) };
}

/**
 * Get the data directory path for a cluster.
 */
export function clusterDir(cluster) {
  const shortId = cluster.id.replace(/-/g, '').slice(0, 8);
  return path.join(clusterDataDir, `cluster-${shortId}`);
}

/**
 * Get the data directory path for a role within a cluster.
 */
export function roleDir(cluster, role) {
  return path.join(clusterDir(cluster), 'role-' + roleShortId(role));
}

/**
 * Container name prefix for a role (used for listing/matching).
 */
function roleContainerPrefix(cluster, role) {
  const cid = cluster.id.replace(/-/g, '').slice(0, 8);
  const rid = role.id.replace(/-/g, '').slice(0, 8);
  return `cluster-${cid}-role-${rid}-`;
}

/**
 * Count running containers for a role.
 */
export async function countRunningForRole(cluster, role) {
  const prefix = roleContainerPrefix(cluster, role);
  const containers = await listContainers(prefix);
  return containers.filter((c) => c.state === 'running').length;
}

/**
 * Resolve {{PLACEHOLDER}} template variables in text.
 * Case-insensitive. Only matches known variable names. Unknown {{...}} passes through.
 */
function resolveClusterVariables(text, vars) {
  if (!text) return text;
  const keys = Object.keys(vars).join('|');
  const pattern = new RegExp(`\\{\\{(${keys})\\}\\}`, 'gi');
  return text.replace(pattern, (_, key) => {
    const match = Object.keys(vars).find(k => k.toLowerCase() === key.toLowerCase());
    return match ? vars[match] : `{{${key}}}`;
  });
}

/**
 * Compute template variables for a cluster worker.
 * Returns a vars object for use with resolveClusterVariables().
 */
function buildTemplateVars(cluster, role, workerUuid, payload) {
  const CLUSTER_HOME = '/home/claude-code/workspace';
  const rShortId = roleShortId(role);
  const SELF_WORK_DIR = `${CLUSTER_HOME}/role-${rShortId}/worker-${workerUuid}/`;
  const SELF_TMP_DIR = `${SELF_WORK_DIR}tmp/`;
  const CLUSTER_SHARED_DIR = `${CLUSTER_HOME}/shared/`;
  const clusterFolderNames = cluster.folders ? JSON.parse(cluster.folders) : [];
  const clusterFolders = clusterFolderNames.map(f => `${CLUSTER_SHARED_DIR}${f}/`);

  const manifest = {
    CLUSTER: {
      CLUSTER_HOME,
      CLUSTER_SHARED_DIR,
      CLUSTER_SHARED_FOLDERS: clusterFolders,
    },
    SELF: {
      SELF_ROLE_NAME: role.roleName || '',
      SELF_WORKER_ID: workerUuid,
      SELF_WORK_DIR,
      SELF_TMP_DIR,
    },
  };

  const vars = {
    CLUSTER_HOME,
    CLUSTER_SHARED_DIR,
    CLUSTER_SHARED_FOLDERS: JSON.stringify(clusterFolders),
    SELF_ROLE_NAME: role.roleName || '',
    SELF_WORKER_ID: workerUuid,
    SELF_WORK_DIR,
    SELF_TMP_DIR,
    DATETIME: new Date().toISOString(),
    WORKSPACE: JSON.stringify(manifest, null, 2),
  };
  if (payload && Object.keys(payload).length > 0) {
    vars.WEBHOOK_PAYLOAD = JSON.stringify(payload, null, 2);
  }
  return vars;
}

/**
 * Build the system prompt for a role container.
 * Composes: cluster system prompt + role instructions.
 * All {{PLACEHOLDER}} variables are resolved at build time.
 */
function buildWorkerSystemPrompt(cluster, role, vars) {
  const sections = [];

  // Section A: Cluster system prompt (with variables resolved)
  if (cluster.systemPrompt) {
    sections.push(resolveClusterVariables(cluster.systemPrompt.trim(), vars));
  }

  // Section B: Role instructions (with variables resolved)
  if (role.role) {
    sections.push(`## Your Role: ${role.roleName}\n\n${resolveClusterVariables(role.role.trim(), vars)}`);
  }

  return sections.join('\n\n');
}

// ── Per-role lock to prevent check-then-act race condition ────────
const _locks = new Map();

/**
 * Atomically check concurrency + launch a role container.
 * Serializes per-role so two concurrent triggers can't both pass the gate.
 * Different roles still run in parallel.
 * @param {string|object} roleIdOrData - Role UUID or roleData object (from getRoleWithCluster)
 * @param {object} [payload] - Optional payload (e.g. webhook body)
 * @param {object} [trigger] - Optional trigger metadata
 * @returns {Promise<{ allowed: boolean, reason?: string, containerName?: string, error?: string }>}
 */
export async function acquireAndRunRole(roleIdOrData, payload, trigger) {
  const roleData = typeof roleIdOrData === 'string'
    ? getRoleWithCluster(roleIdOrData)
    : roleIdOrData;

  if (!roleData || !roleData.cluster) {
    return { allowed: false, reason: 'not_found' };
  }

  const key = roleData.id;

  // Chain on the previous promise for this role
  if (!_locks.has(key)) _locks.set(key, Promise.resolve());
  let release;
  const gate = new Promise((r) => { release = r; });
  const prev = _locks.get(key);
  _locks.set(key, gate);
  await prev;

  try {
    if (!roleData.cluster.enabled) {
      return { allowed: false, reason: 'disabled' };
    }

    const runningCount = await countRunningForRole(roleData.cluster, roleData);
    if (runningCount >= roleData.maxConcurrency) {
      console.log(`[cluster] Role ${roleData.roleName} at max concurrency (${runningCount}/${roleData.maxConcurrency}), rejecting`);
      return { allowed: false, reason: 'concurrency' };
    }

    const result = await runClusterRole(roleData, payload, trigger);
    return { allowed: true, ...result };
  } finally {
    release();
  }
}

/**
 * Launch a cluster role container.
 * Called internally by acquireAndRunRole() — do not call directly.
 * @param {object} roleData - Role+cluster object from getRoleWithCluster()
 * @param {object} [payload] - Optional payload (e.g. webhook body)
 * @returns {Promise<{ containerName?: string, error?: string }>}
 */
export async function runClusterRole(roleData, payload, trigger) {
  const { cluster } = roleData;
  const prefix = roleContainerPrefix(cluster, roleData);

  // Generate dynamic worker ID
  const workerUuid = randomUUID().replace(/-/g, '').slice(0, 8);
  const containerName = `${prefix}${workerUuid}`;
  const dataDir = clusterDir(cluster);

  // Ensure role dirs exist
  const rDir = roleDir(cluster, roleData);
  fs.mkdirSync(path.join(rDir, 'shared'), { recursive: true });
  const workerWorkDir = path.join(rDir, `worker-${workerUuid}`);
  fs.mkdirSync(workerWorkDir, { recursive: true });
  fs.mkdirSync(path.join(workerWorkDir, 'tmp'), { recursive: true });

  // Extract prompt from payload (if present) — it becomes the -p user prompt, not part of the data
  const payloadPrompt = payload?.prompt;
  const cleanPayload = payload && payloadPrompt
    ? Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'prompt'))
    : payload;

  const vars = buildTemplateVars(cluster, roleData, workerUuid, cleanPayload);
  const systemPrompt = buildWorkerSystemPrompt(cluster, roleData, vars);
  const prompt = resolveClusterVariables(payloadPrompt || roleData.prompt || 'Execute your role.', vars);

  const env = [];
  if (systemPrompt) {
    env.push(`SYSTEM_PROMPT=${systemPrompt}`);
  }
  if (prompt) {
    env.push(`PROMPT=${prompt}`);
  }
  const oauthToken = getConfig('CLAUDE_CODE_OAUTH_TOKEN');
  if (oauthToken) {
    env.push(`CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`);
  }
  const ghToken = getConfig('GH_TOKEN');
  if (ghToken) {
    env.push(`GH_TOKEN=${ghToken}`);
  }
  env.push(`ROLE_SHORT_ID=${roleShortId(roleData)}`);
  env.push(`ROLE_NAME=${roleData.roleName || 'Role'}`);
  env.push(`WORKER_UUID=${workerUuid}`);
  if (trigger) {
    env.push(`TRIGGER_LOG=${JSON.stringify({ ...trigger, ...(payload ? { payload } : {}) }, null, 2)}`);
  }

  const hostDataDir = await resolveHostPath(dataDir);
  const binds = [`${hostDataDir}:/home/claude-code/workspace`];

  // Write session log files (before container launch — files available immediately)
  const now = new Date();
  const sessionTs = now.toISOString().slice(0, 10) + '_' + now.toISOString().slice(11, 19).replace(/:/g, '-');
  const logRelPath = `logs/role-${roleShortId(roleData)}/${sessionTs}_${workerUuid}`;
  const logDir = path.join(dataDir, logRelPath);
  env.push(`LOG_DIR=${logRelPath}`);
  fs.mkdirSync(logDir, { recursive: true });
  fs.chmodSync(logDir, 0o777);
  fs.writeFileSync(path.join(logDir, 'system-prompt.md'), systemPrompt || '', 'utf8');
  fs.chmodSync(path.join(logDir, 'system-prompt.md'), 0o666);
  fs.writeFileSync(path.join(logDir, 'user-prompt.md'), prompt || '', 'utf8');
  fs.chmodSync(path.join(logDir, 'user-prompt.md'), 0o666);
  fs.writeFileSync(path.join(logDir, 'meta.json'), JSON.stringify({ roleName: roleData.roleName || 'Role', startedAt: new Date().toISOString() }), 'utf8');
  fs.chmodSync(path.join(logDir, 'meta.json'), 0o666);
  if (trigger) {
    const triggerLog = JSON.stringify({ ...trigger, ...(payload ? { payload } : {}) }, null, 2);
    fs.writeFileSync(path.join(logDir, 'trigger.json'), triggerLog, 'utf8');
    fs.chmodSync(path.join(logDir, 'trigger.json'), 0o666);
  }

  console.log(`[cluster] Launching role ${roleData.roleName} (${containerName})${payload ? ` payload=${JSON.stringify(payload)}` : ''}`);

  try {
    const containerWorkDir = workerWorkDir.replace(dataDir, '/home/claude-code/workspace');
    await runClusterWorkerContainer({ containerName, env, binds, workingDir: containerWorkDir });
  } catch (err) {
    console.error(`[cluster] Failed to launch ${containerName}:`, err.message);
    return { containerName, error: err.message };
  }

  // If cleanupWorkerDir is enabled, schedule cleanup after container exits
  if (roleData.cleanupWorkerDir) {
    scheduleWorkerDirCleanup(containerName, workerWorkDir);
  }

  return { containerName };
}

/**
 * Schedule cleanup of a worker directory after its container exits.
 */
function scheduleWorkerDirCleanup(containerName, dirPath) {
  // Poll for container disappearance (AutoRemove handles container removal)
  const interval = setInterval(async () => {
    const containers = await listContainers(containerName);
    const still = containers.find((c) => c.name === containerName);
    if (!still) {
      clearInterval(interval);
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`[cluster] Cleaned up worker dir: ${dirPath}`);
      } catch (err) {
        console.error(`[cluster] Failed to clean up ${dirPath}:`, err.message);
      }
    }
  }, 5000);
}

/**
 * Stop all containers for a role.
 */
export async function stopRoleContainers(cluster, role) {
  const prefix = roleContainerPrefix(cluster, role);
  const containers = await listContainers(prefix);
  for (const c of containers) {
    if (c.state === 'running') {
      try {
        await dockerStopContainer(c.name);
      } catch (err) {
        console.error(`[cluster] Failed to stop ${c.name}:`, err.message);
      }
    }
    // Clean up stopped containers (AutoRemove may not fire on force stop)
    try {
      await removeContainer(c.name);
    } catch {}
  }
}
