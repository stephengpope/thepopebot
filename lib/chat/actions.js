'use server';

import { auth } from '../auth/index.js';
import {
  createChat as dbCreateChat,
  getChatById,
  getChatByWorkspaceId,
  getMessagesByChatId,
  deleteChat as dbDeleteChat,
  updateChatTitle,
  toggleChatStarred,
} from '../db/chats.js';
import {
  getNotifications as dbGetNotifications,
  getUnreadCount as dbGetUnreadCount,
  markAllRead as dbMarkAllRead,
} from '../db/notifications.js';

/**
 * Get the authenticated user or throw.
 */
async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }
  return session.user;
}

/**
 * Get all chats for the authenticated user (includes Telegram chats).
 * @returns {Promise<object[]>}
 */
export async function getChats(limit) {
  const user = await requireAuth();
  const { or, eq, desc } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats, codeWorkspaces } = await import('../db/schema.js');
  const db = getDb();
  let query = db
    .select({
      id: chats.id,
      userId: chats.userId,
      title: chats.title,
      starred: chats.starred,
      chatMode: chats.chatMode,
      codeWorkspaceId: chats.codeWorkspaceId,
      containerName: codeWorkspaces.containerName,
      hasChanges: codeWorkspaces.hasChanges,
      createdAt: chats.createdAt,
      updatedAt: chats.updatedAt,
    })
    .from(chats)
    .leftJoin(codeWorkspaces, eq(chats.codeWorkspaceId, codeWorkspaces.id))
    .where(or(eq(chats.userId, user.id), eq(chats.userId, 'telegram')))
    .orderBy(desc(chats.updatedAt));
  if (limit) query = query.limit(limit);
  return query.all();
}

/**
 * Get messages for a specific chat (with ownership check).
 * @param {string} chatId
 * @returns {Promise<object[]>}
 */
export async function getChatMessages(chatId) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || (chat.userId !== user.id && chat.userId !== 'telegram')) {
    return [];
  }
  return getMessagesByChatId(chatId);
}

/**
 * Create a new chat.
 * @param {string} [id] - Optional chat ID
 * @param {string} [title='New Chat']
 * @returns {Promise<object>}
 */
export async function createChat(id, title = 'New Chat') {
  const user = await requireAuth();
  return dbCreateChat(user.id, title, id);
}

/**
 * Delete a chat (with ownership check).
 * @param {string} chatId
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteChat(chatId) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || chat.userId !== user.id) {
    return { success: false };
  }

  // Clean up associated code workspace container and volume
  if (chat.codeWorkspaceId) {
    try {
      const { deleteCodeWorkspace } = await import('../code/actions.js');
      await deleteCodeWorkspace(chat.codeWorkspaceId);
    } catch {}
  }

  dbDeleteChat(chatId);
  return { success: true };
}

/**
 * Rename a chat (with ownership check).
 * @param {string} chatId
 * @param {string} title
 * @returns {Promise<{success: boolean}>}
 */
export async function renameChat(chatId, title) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || chat.userId !== user.id) {
    return { success: false };
  }
  updateChatTitle(chatId, title);
  return { success: true };
}

/**
 * Toggle a chat's starred status (with ownership check).
 * @param {string} chatId
 * @returns {Promise<{success: boolean, starred?: number}>}
 */
export async function starChat(chatId) {
  const user = await requireAuth();
  const chat = getChatById(chatId);
  if (!chat || chat.userId !== user.id) {
    return { success: false };
  }
  const starred = toggleChatStarred(chatId);
  return { success: true, starred };
}


/**
 * Get notifications, newest first, with pagination.
 * @returns {Promise<{notifications: object[], hasMore: boolean}>}
 */
export async function getNotifications(limit = 25, offset = 0) {
  await requireAuth();
  const rows = dbGetNotifications(limit, offset);
  const hasMore = rows.length > limit;
  return { notifications: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

/**
 * Get count of unread notifications.
 * @returns {Promise<number>}
 */
export async function getUnreadNotificationCount() {
  await requireAuth();
  return dbGetUnreadCount();
}

/**
 * Mark all notifications as read.
 * @returns {Promise<{success: boolean}>}
 */
export async function markNotificationsRead() {
  await requireAuth();
  dbMarkAllRead();
  return { success: true };
}

/**
 * Generate a title for a new chat from the first user message.
 * @param {string} chatId
 * @param {string} firstMessage
 * @returns {Promise<void>}
 */
export async function generateChatTitle(chatId, firstMessage) {
  await requireAuth();
  const { autoTitle } = await import('../ai/index.js');
  return await autoTitle(chatId, firstMessage);
}

// ─────────────────────────────────────────────────────────────────────────────
// App info actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the installed package version and update status (auth-gated, never in client bundle).
 * @returns {Promise<{ version: string, updateAvailable: string|null }>}
 */
export async function getAppVersion() {
  await requireAuth();
  const { getInstalledVersion } = await import('../cron.js');
  const { getAvailableVersion, getReleaseNotes } = await import('../db/update-check.js');
  const version = getInstalledVersion();
  const available = getAvailableVersion();
  const isNewer = available && available !== version;
  return {
    version,
    updateAvailable: isNewer ? available : null,
    changelog: isNewer ? getReleaseNotes() : null,
  };
}

/**
 * Trigger the upgrade-event-handler workflow via GitHub Actions.
 * @returns {Promise<{ success: boolean }>}
 */
export async function triggerUpgrade() {
  await requireAuth();
  const { triggerWorkflowDispatch } = await import('../tools/github.js');
  const { getAvailableVersion } = await import('../db/update-check.js');
  const targetVersion = getAvailableVersion();
  await triggerWorkflowDispatch('upgrade-event-handler.yml', 'main', {
    target_version: targetVersion || '',
  });
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// API Key actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new named API key.
 * @param {string} name - Human-readable name for the key
 * @returns {Promise<{ key: string, record: object } | { error: string }>}
 */
export async function createNewApiKey(name) {
  const user = await requireAuth();
  try {
    const { createApiKeyRecord } = await import('../db/api-keys.js');
    return createApiKeyRecord(name || 'API Key', user.id);
  } catch (err) {
    console.error('Failed to create API key:', err);
    return { error: 'Failed to create API key' };
  }
}

/**
 * List all API keys (metadata only, no hashes).
 * @returns {Promise<object[]>}
 */
export async function getApiKeys() {
  await requireAuth();
  try {
    const { listApiKeys } = await import('../db/api-keys.js');
    return listApiKeys();
  } catch (err) {
    console.error('Failed to list API keys:', err);
    return [];
  }
}

/**
 * Delete a specific API key by ID.
 * @param {string} id - Record ID
 * @returns {Promise<{ success: boolean } | { error: string }>}
 */
export async function deleteApiKey(id) {
  await requireAuth();
  try {
    const { deleteApiKeyById } = await import('../db/api-keys.js');
    deleteApiKeyById(id);
    return { success: true };
  } catch (err) {
    console.error('Failed to delete API key:', err);
    return { error: 'Failed to delete API key' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Token actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new named OAuth token.
 * @param {string} tokenType - Token type slug (e.g. 'claudeCode')
 * @param {string} name - Human-readable name
 * @param {string} token - Raw OAuth token
 * @returns {Promise<{ id: string, name: string, createdAt: number, lastUsedAt: null } | { error: string }>}
 */
export async function createOAuthToken(tokenType, name, token) {
  const user = await requireAuth();
  try {
    const { createOAuthToken: dbCreate } = await import('../db/oauth-tokens.js');
    const { invalidateConfigCache } = await import('../config.js');
    const result = dbCreate(tokenType, name || 'OAuth Token', token, user.id);
    invalidateConfigCache();
    return result;
  } catch (err) {
    console.error('Failed to create OAuth token:', err);
    return { error: 'Failed to create OAuth token' };
  }
}

/**
 * List all OAuth tokens for a type (metadata only).
 * @param {string} tokenType - Token type slug (e.g. 'claudeCode')
 * @returns {Promise<object[]>}
 */
export async function getOAuthTokens(tokenType) {
  await requireAuth();
  try {
    const { listOAuthTokens } = await import('../db/oauth-tokens.js');
    return listOAuthTokens(tokenType);
  } catch (err) {
    console.error('Failed to list OAuth tokens:', err);
    return [];
  }
}

/**
 * Delete an OAuth token by ID.
 * @param {string} id - Record ID
 * @returns {Promise<{ success: boolean } | { error: string }>}
 */
export async function deleteOAuthToken(id) {
  await requireAuth();
  try {
    const { deleteOAuthTokenById } = await import('../db/oauth-tokens.js');
    const { invalidateConfigCache } = await import('../config.js');
    deleteOAuthTokenById(id);
    invalidateConfigCache();
    return { success: true };
  } catch (err) {
    console.error('Failed to delete OAuth token:', err);
    return { error: 'Failed to delete OAuth token' };
  }
}

/**
 * Get the default repo (GH_OWNER/GH_REPO) for agent mode.
 * @returns {Promise<string|null>}
 */
export async function getDefaultRepo() {
  await requireAuth();
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Code mode actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get repositories accessible to the authenticated user.
 * @returns {Promise<{full_name: string, default_branch: string}[]>}
 */
export async function getRepositories() {
  await requireAuth();
  try {
    const { listRepositories } = await import('../tools/github.js');
    return await listRepositories();
  } catch (err) {
    console.error('Failed to get repositories:', err);
    return [];
  }
}

/**
 * Get branches for a repository.
 * @param {string} repoFullName - e.g. "owner/repo"
 * @returns {Promise<{name: string, isDefault: boolean}[]>}
 */
export async function getBranches(repoFullName) {
  await requireAuth();
  try {
    const { listBranches } = await import('../tools/github.js');
    return await listBranches(repoFullName);
  } catch (err) {
    console.error('Failed to get branches:', err);
    return [];
  }
}

/**
 * Get full chat data with optional workspace (left join).
 * @param {string} chatId
 * @returns {Promise<object|null>}
 */
export async function getChatData(chatId) {
  const user = await requireAuth();
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats, codeWorkspaces } = await import('../db/schema.js');
  const db = getDb();
  const row = db
    .select()
    .from(chats)
    .leftJoin(codeWorkspaces, eq(chats.codeWorkspaceId, codeWorkspaces.id))
    .where(eq(chats.id, chatId))
    .get();
  if (!row) return null;
  const chat = row.chats;
  if (chat.userId !== user.id && chat.userId !== 'telegram') return null;
  const ws = row.code_workspaces;
  return {
    ...chat,
    workspace: ws?.id ? ws : null,
  };
}

/**
 * Get full chat data by workspace ID (left join).
 * @param {string} workspaceId
 * @returns {Promise<object|null>}
 */
export async function getChatDataByWorkspace(workspaceId) {
  const user = await requireAuth();
  const { eq } = await import('drizzle-orm');
  const { getDb } = await import('../db/index.js');
  const { chats, codeWorkspaces } = await import('../db/schema.js');
  const db = getDb();
  const row = db
    .select()
    .from(chats)
    .leftJoin(codeWorkspaces, eq(chats.codeWorkspaceId, codeWorkspaces.id))
    .where(eq(chats.codeWorkspaceId, workspaceId))
    .get();
  if (!row) return null;
  const chat = row.chats;
  if (chat.userId !== user.id && chat.userId !== 'telegram') return null;
  const ws = row.code_workspaces;
  return {
    chatId: chat.id,
    ...chat,
    workspace: ws?.id ? ws : null,
  };
}

/**
 * Create a code workspace (DB row + initial feature branch) for a new chat.
 * Called client-side before the stream fires so the workspace ID is available immediately.
 * @param {string} repo - e.g. "owner/repo"
 * @param {string} branch - e.g. "main"
 * @returns {Promise<{id: string, repo: string, branch: string, featureBranch: string, containerName: null}>}
 */
export async function createChatWorkspace(repo, branch) {
  const user = await requireAuth();
  const { createCodeWorkspace, updateFeatureBranch } = await import('../db/code-workspaces.js');
  const workspace = createCodeWorkspace(user.id, { repo, branch });
  const shortId = workspace.id.replace(/-/g, '').slice(0, 8);
  const featureBranch = `thepopebot/new-chat-${shortId}`;
  updateFeatureBranch(workspace.id, featureBranch);
  return {
    id: workspace.id,
    repo: workspace.repo,
    branch: workspace.branch,
    featureBranch,
    containerName: null,
  };
}

/**
 * Update the base branch of a workspace.
 * @param {string} workspaceId
 * @param {string} branch - New base branch name
 * @returns {Promise<{success: boolean}>}
 */
export async function updateWorkspaceBranch(workspaceId, branch) {
  const user = await requireAuth();
  try {
    const { getCodeWorkspaceById, updateBranch } = await import('../db/code-workspaces.js');
    const ws = getCodeWorkspaceById(workspaceId);
    if (!ws || ws.userId !== user.id) {
      return { success: false };
    }
    updateBranch(workspaceId, branch);
    return { success: true };
  } catch (err) {
    console.error('Failed to update workspace branch:', err);
    return { error: 'Failed to update branch' };
  }
}

/**
 * Get workspace details by ID.
 * @param {string} workspaceId
 * @returns {Promise<{id: string, repo: string, branch: string, containerName: string|null}|null>}
 */
export async function getWorkspace(workspaceId) {
  await requireAuth();
  try {
    const { getCodeWorkspaceById } = await import('../db/code-workspaces.js');
    const ws = getCodeWorkspaceById(workspaceId);
    if (!ws) return null;
    return { id: ws.id, repo: ws.repo, branch: ws.branch, containerName: ws.containerName, featureBranch: ws.featureBranch };
  } catch (err) {
    console.error('Failed to get workspace:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull Request actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all open pull requests from GitHub.
 * @returns {Promise<object[]>}
 */
export async function getPullRequests() {
  await requireAuth();
  try {
    const { getOpenPullRequests } = await import('../tools/github.js');
    return await getOpenPullRequests();
  } catch (err) {
    console.error('Failed to get pull requests:', err);
    return [];
  }
}

/**
 * Get the count of open pull requests.
 * @returns {Promise<number>}
 */
export async function getPullRequestCount() {
  await requireAuth();
  try {
    const { getOpenPullRequests } = await import('../tools/github.js');
    const prs = await getOpenPullRequests();
    return prs.length;
  } catch (err) {
    console.error('Failed to get pull request count:', err);
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runners actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get runners status (active + completed jobs with counts).
 * @returns {Promise<object>}
 */
export async function getRunnersStatus(page = 1) {
  await requireAuth();
  try {
    const { getRunnersStatus: fetchStatus } = await import('../tools/github.js');
    return await fetchStatus(page);
  } catch (err) {
    console.error('Failed to get runners status:', err);
    return { error: 'Failed to get runners status', runs: [], hasMore: false };
  }
}

/**
 * Get runners config (crons + triggers).
 * @returns {Promise<{ crons: object[], triggers: object[] }>}
 */
export async function getRunnersConfig() {
  await requireAuth();
  const { PROJECT_ROOT } = await import('../paths.js');
  const fs = await import('fs');
  const path = await import('path');
  let crons = [];
  let triggers = [];
  try { crons = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'agent-job/CRONS.json'), 'utf8')); } catch {}
  try { triggers = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'event-handler/TRIGGERS.json'), 'utf8')); } catch {}
  return { crons, triggers };
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker container actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stop a Docker container by name.
 * @param {string} containerName
 * @returns {Promise<{ success: boolean } | { error: string }>}
 */
export async function stopDockerContainer(containerName) {
  await requireAuth();
  try {
    const { stopContainer } = await import('../tools/docker.js');
    await stopContainer(containerName);
    return { success: true };
  } catch (err) {
    console.error('Failed to stop container:', err);
    return { error: err.message };
  }
}

/**
 * Start a stopped Docker container by name.
 * @param {string} containerName
 * @returns {Promise<{ success: boolean } | { error: string }>}
 */
export async function startDockerContainer(containerName) {
  await requireAuth();
  try {
    const { startContainer } = await import('../tools/docker.js');
    await startContainer(containerName);
    return { success: true };
  } catch (err) {
    console.error('Failed to start container:', err);
    return { error: err.message };
  }
}

/**
 * Remove a Docker container by name.
 * @param {string} containerName
 * @returns {Promise<{ success: boolean } | { error: string }>}
 */
export async function removeDockerContainer(containerName) {
  await requireAuth();
  try {
    const { removeContainer, saveContainerLogs } = await import('../tools/docker.js');
    await saveContainerLogs(containerName);
    await removeContainer(containerName);
    return { success: true };
  } catch (err) {
    console.error('Failed to remove container:', err);
    return { error: err.message };
  }
}

/**
 * List saved container logs from disk.
 * @returns {Promise<Array<{ containerName: string, capturedAt: string }>>}
 */
export async function listSavedContainerLogs() {
  await requireAuth();
  const { PROJECT_ROOT } = await import('../paths.js');
  const path = await import('path');
  const fs = await import('fs');
  const logsDir = path.join(PROJECT_ROOT, 'data', 'logs', 'containers');
  try {
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        const raw = fs.readFileSync(path.join(logsDir, f), 'utf8');
        const { containerName, capturedAt } = JSON.parse(raw);
        return { containerName, capturedAt };
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Read saved container logs from disk.
 * @param {string} containerName
 * @returns {Promise<{ containerName: string, capturedAt: string, logs: string } | null>}
 */
export async function getSavedContainerLogs(containerName) {
  await requireAuth();
  const { PROJECT_ROOT } = await import('../paths.js');
  const path = await import('path');
  const fs = await import('fs');
  const filePath = path.join(PROJECT_ROOT, 'data', 'logs', 'containers', `${containerName}.json`);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Delete saved container logs from disk.
 * @param {string} containerName
 * @returns {Promise<{ success: boolean } | { error: string }>}
 */
export async function deleteSavedContainerLogs(containerName) {
  await requireAuth();
  const { PROJECT_ROOT } = await import('../paths.js');
  const path = await import('path');
  const fs = await import('fs');
  const filePath = path.join(PROJECT_ROOT, 'data', 'logs', 'containers', `${containerName}.json`);
  try {
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — Coding Agents sub-tab
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get settings for the Coding Agents sub-tab.
 * Returns default agent, per-agent config, credential readiness, and available providers.
 */
export async function getCodingAgentSettings() {
  await requireAuth();
  try {
    const { getConfigValue, getSecretStatus, getCustomProviders } = await import('../db/config.js');
    const { getOAuthTokenCount } = await import('../db/oauth-tokens.js');
    const { BUILTIN_PROVIDERS, getAllCredentialKeys } = await import('../llm-providers.js');

    // Current config values (fall back to defaults via getConfig)
    const { getConfig } = await import('../config.js');
    const defaultAgent = getConfig('CODING_AGENT');
    const claudeCodeEnabled = getConfig('CODING_AGENT_CLAUDE_CODE_ENABLED');
    const claudeCodeAuth = getConfig('CODING_AGENT_CLAUDE_CODE_AUTH');
    const claudeCodeBackend = getConfig('CODING_AGENT_CLAUDE_CODE_BACKEND') || 'anthropic';
    const claudeCodeModel = getConfig('CODING_AGENT_CLAUDE_CODE_MODEL') || '';
    const piEnabled = getConfig('CODING_AGENT_PI_ENABLED');
    const piProvider = getConfig('CODING_AGENT_PI_PROVIDER') || '';
    const piModel = getConfig('CODING_AGENT_PI_MODEL') || '';
    const geminiCliEnabled = getConfig('CODING_AGENT_GEMINI_CLI_ENABLED');
    const geminiCliModel = getConfig('CODING_AGENT_GEMINI_CLI_MODEL') || '';
    const codexCliEnabled = getConfig('CODING_AGENT_CODEX_CLI_ENABLED');
    const codexCliAuth = getConfig('CODING_AGENT_CODEX_CLI_AUTH');
    const codexCliModel = getConfig('CODING_AGENT_CODEX_CLI_MODEL') || '';
    const openCodeEnabled = getConfig('CODING_AGENT_OPENCODE_ENABLED');
    const openCodeProvider = getConfig('CODING_AGENT_OPENCODE_PROVIDER') || '';
    const openCodeModel = getConfig('CODING_AGENT_OPENCODE_MODEL') || '';
    const kimiCliEnabled = getConfig('CODING_AGENT_KIMI_CLI_ENABLED');
    const kimiCliProvider = getConfig('CODING_AGENT_KIMI_CLI_PROVIDER') || '';
    const kimiCliModel = getConfig('CODING_AGENT_KIMI_CLI_MODEL') || '';
    const agentModeBranch = getConfig('AGENT_MODE_BRANCH');
    const codeModeBranch = getConfig('CODE_MODE_BRANCH');
    const agentModeGitAction = getConfig('AGENT_MODE_GIT_ACTION');
    const codeModeGitAction = getConfig('CODE_MODE_GIT_ACTION');

    // Credential readiness
    const oauthTokenCount = getOAuthTokenCount('claudeCode');
    const codexOauthTokenCount = getOAuthTokenCount('codex');
    const credentialKeys = getAllCredentialKeys();
    const allSecretKeys = [...credentialKeys];
    const credentialStatuses = getSecretStatus(allSecretKeys);
    const customProviders = getCustomProviders();

    return {
      defaultAgent,
      claudeCode: {
        enabled: claudeCodeEnabled === 'true',
        auth: claudeCodeAuth || 'oauth',
        backend: claudeCodeBackend,
        model: claudeCodeModel,
        oauthTokenCount,
        anthropicKeySet: credentialStatuses.find(s => s.key === 'ANTHROPIC_API_KEY')?.isSet || false,
      },
      pi: {
        enabled: piEnabled === 'true',
        provider: piProvider,
        model: piModel,
      },
      geminiCli: {
        enabled: geminiCliEnabled === 'true',
        model: geminiCliModel,
        googleKeySet: credentialStatuses.find(s => s.key === 'GOOGLE_API_KEY')?.isSet || false,
      },
      codexCli: {
        enabled: codexCliEnabled === 'true',
        auth: codexCliAuth || 'api-key',
        model: codexCliModel,
        oauthTokenCount: codexOauthTokenCount,
        codexKeySet: credentialStatuses.find(s => s.key === 'OPENAI_API_KEY')?.isSet || false,
      },
      openCode: {
        enabled: openCodeEnabled === 'true',
        provider: openCodeProvider,
        model: openCodeModel,
      },
      kimiCli: {
        enabled: kimiCliEnabled === 'true',
        provider: kimiCliProvider,
        model: kimiCliModel,
      },
      modeDefaults: {
        agent: { branch: agentModeBranch, gitAction: agentModeGitAction },
        code: { branch: codeModeBranch, gitAction: codeModeGitAction },
      },
      builtinProviders: BUILTIN_PROVIDERS,
      credentialStatuses,
      customProviders,
    };
  } catch (err) {
    console.error('Failed to get coding agent settings:', err);
    return { error: 'Failed to load coding agent settings' };
  }
}

/**
 * Return the list of coding agents that are enabled and have valid credentials.
 * Used to populate the right-click agent picker on the Interactive toggle.
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
export async function getAvailableCodingAgents() {
  await requireAuth();
  try {
    const settings = await getCodingAgentSettings();
    if (settings.error) return [];

    const statusMap = new Map((settings.credentialStatuses || []).map(s => [s.key, s.isSet]));

    function isProviderReady(provider) {
      const builtin = settings.builtinProviders?.[provider];
      if (builtin?.credentialKey) return statusMap.get(builtin.credentialKey) || false;
      // Custom providers store their own credentials — if selected they're ready
      const custom = (settings.customProviders || []).find(p => p.id === provider);
      return !!custom;
    }

    const available = [];

    if (settings.claudeCode?.enabled) {
      const { claudeCode } = settings;
      const backend = claudeCode.backend || 'anthropic';
      const ready = backend === 'anthropic'
        ? (claudeCode.auth === 'oauth' ? claudeCode.oauthTokenCount > 0 : claudeCode.anthropicKeySet)
        : isProviderReady(backend);
      if (ready) available.push({ value: 'claude-code', label: 'Claude Code' });
    }

    if (settings.pi?.enabled && settings.pi?.provider && isProviderReady(settings.pi.provider)) {
      available.push({ value: 'pi-coding-agent', label: 'Pi' });
    }

    if (settings.geminiCli?.enabled && settings.geminiCli?.googleKeySet) {
      available.push({ value: 'gemini-cli', label: 'Gemini CLI' });
    }

    if (settings.codexCli?.enabled) {
      const { codexCli } = settings;
      const ready = codexCli.auth === 'oauth' ? codexCli.oauthTokenCount > 0 : codexCli.codexKeySet;
      if (ready) available.push({ value: 'codex-cli', label: 'Codex CLI' });
    }

    if (settings.openCode?.enabled && settings.openCode?.provider && isProviderReady(settings.openCode.provider)) {
      available.push({ value: 'opencode', label: 'OpenCode' });
    }

    if (settings.kimiCli?.enabled && settings.kimiCli?.provider && isProviderReady(settings.kimiCli.provider)) {
      available.push({ value: 'kimi-cli', label: 'Kimi CLI' });
    }

    return available;
  } catch {
    return [];
  }
}

/**
 * Update per-agent coding agent config.
 * @param {string} agent - 'claude-code' or 'pi-coding-agent'
 * @param {object} config - Agent-specific config values
 */
export async function updateCodingAgentConfig(agent, config) {
  await requireAuth();
  try {
    const { setConfigValue } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');

    if (agent === 'claude-code') {
      if (config.enabled !== undefined) setConfigValue('CODING_AGENT_CLAUDE_CODE_ENABLED', String(config.enabled));
      if (config.auth !== undefined) setConfigValue('CODING_AGENT_CLAUDE_CODE_AUTH', config.auth);
      if (config.backend !== undefined) setConfigValue('CODING_AGENT_CLAUDE_CODE_BACKEND', config.backend);
      if (config.model !== undefined) setConfigValue('CODING_AGENT_CLAUDE_CODE_MODEL', config.model);
    } else if (agent === 'pi-coding-agent') {
      if (config.enabled !== undefined) setConfigValue('CODING_AGENT_PI_ENABLED', String(config.enabled));
      if (config.provider !== undefined) setConfigValue('CODING_AGENT_PI_PROVIDER', config.provider);
      if (config.model !== undefined) setConfigValue('CODING_AGENT_PI_MODEL', config.model);
    } else if (agent === 'gemini-cli') {
      if (config.enabled !== undefined) setConfigValue('CODING_AGENT_GEMINI_CLI_ENABLED', String(config.enabled));
      if (config.model !== undefined) setConfigValue('CODING_AGENT_GEMINI_CLI_MODEL', config.model);
    } else if (agent === 'codex-cli') {
      if (config.enabled !== undefined) setConfigValue('CODING_AGENT_CODEX_CLI_ENABLED', String(config.enabled));
      if (config.auth !== undefined) setConfigValue('CODING_AGENT_CODEX_CLI_AUTH', config.auth);
      if (config.model !== undefined) setConfigValue('CODING_AGENT_CODEX_CLI_MODEL', config.model);
    } else if (agent === 'opencode') {
      if (config.enabled !== undefined) setConfigValue('CODING_AGENT_OPENCODE_ENABLED', String(config.enabled));
      if (config.provider !== undefined) setConfigValue('CODING_AGENT_OPENCODE_PROVIDER', config.provider);
      if (config.model !== undefined) setConfigValue('CODING_AGENT_OPENCODE_MODEL', config.model);
    } else if (agent === 'kimi-cli') {
      if (config.enabled !== undefined) setConfigValue('CODING_AGENT_KIMI_CLI_ENABLED', String(config.enabled));
      if (config.provider !== undefined) setConfigValue('CODING_AGENT_KIMI_CLI_PROVIDER', config.provider);
      if (config.model !== undefined) setConfigValue('CODING_AGENT_KIMI_CLI_MODEL', config.model);
    } else {
      return { error: 'Invalid agent' };
    }

    invalidateConfigCache();
    if (agent === 'claude-code' && config.backend !== undefined) {
      await syncLitellmConfig();
    }
    return { success: true };
  } catch (err) {
    console.error('Failed to update coding agent config:', err);
    return { error: 'Failed to update config' };
  }
}

/**
 * Set the default coding agent.
 * @param {string} agent - 'claude-code' or 'pi-coding-agent'
 */
export async function setCodingAgentDefault(agent) {
  await requireAuth();
  try {
    const { setConfigValue } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    setConfigValue('CODING_AGENT', agent);
    invalidateConfigCache();
    return { success: true };
  } catch (err) {
    console.error('Failed to set default coding agent:', err);
    return { error: 'Failed to set default agent' };
  }
}

const MODE_BRANCH_VALUES = new Set(['default', 'dynamic']);
const MODE_GIT_ACTION_VALUES = new Set(['commit', 'push', 'create-pr', 'pull']);

/**
 * Get the admin-configured default git action for a chat mode.
 * Used by the chat UI to seed the workspace command dropdown.
 * @param {'agent'|'code'} mode
 */
export async function getModeGitActionDefault(mode) {
  await requireAuth();
  if (mode !== 'agent' && mode !== 'code') return null;
  const { getConfig } = await import('../config.js');
  return getConfig(mode === 'code' ? 'CODE_MODE_GIT_ACTION' : 'AGENT_MODE_GIT_ACTION') || null;
}

/**
 * Set a per-mode default (branch behavior or git action).
 * @param {'agent'|'code'} mode
 * @param {'branch'|'gitAction'} field
 * @param {string} value
 */
export async function setModeDefault(mode, field, value) {
  await requireAuth();
  try {
    if (mode !== 'agent' && mode !== 'code') return { error: 'Invalid mode' };
    if (field === 'branch' && !MODE_BRANCH_VALUES.has(value)) return { error: 'Invalid branch value' };
    if (field === 'gitAction' && !MODE_GIT_ACTION_VALUES.has(value)) return { error: 'Invalid git action value' };

    const keyMap = {
      'agent.branch': 'AGENT_MODE_BRANCH',
      'code.branch': 'CODE_MODE_BRANCH',
      'agent.gitAction': 'AGENT_MODE_GIT_ACTION',
      'code.gitAction': 'CODE_MODE_GIT_ACTION',
    };
    const key = keyMap[`${mode}.${field}`];
    if (!key) return { error: 'Invalid field' };

    const { setConfigValue } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    setConfigValue(key, value);
    invalidateConfigCache();
    return { success: true };
  } catch (err) {
    console.error('Failed to set mode default:', err);
    return { error: 'Failed to set mode default' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — General sub-tab
// ─────────────────────────────────────────────────────────────────────────────

const GENERAL_SETTINGS_KEYS = new Set(['UPGRADE_INCLUDE_BETA']);

/**
 * Get settings for the General sub-tab.
 */
export async function getGeneralSettings() {
  await requireAuth();
  try {
    const { getConfigValue } = await import('../db/config.js');
    const settings = {};
    for (const key of GENERAL_SETTINGS_KEYS) {
      settings[key] = getConfigValue(key) || undefined;
    }
    return { settings };
  } catch (err) {
    console.error('Failed to get general settings:', err);
    return { error: 'Failed to load settings' };
  }
}

/**
 * Update a setting on the General tab.
 */
export async function updateGeneralSetting(key, value) {
  await requireAuth();
  if (!GENERAL_SETTINGS_KEYS.has(key)) {
    return { error: 'Invalid key' };
  }
  try {
    const { setConfigValue } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    setConfigValue(key, value);
    invalidateConfigCache();
    return { success: true };
  } catch (err) {
    console.error('Failed to update general setting:', err);
    return { error: 'Failed to update setting' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — API Keys sub-tab
// ─────────────────────────────────────────────────────────────────────────────

// Allowed secret keys for the API Keys tab
const API_KEY_SECRETS = new Set([
  'GH_TOKEN',
  'GH_WEBHOOK_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'ASSEMBLYAI_API_KEY',
]);

/**
 * Get settings for the API Keys sub-tab.
 */
export async function getApiKeySettings() {
  await requireAuth();
  try {
    const { getSecretStatus } = await import('../db/config.js');
    const statuses = getSecretStatus([...API_KEY_SECRETS]);
    return { secrets: statuses };
  } catch (err) {
    console.error('Failed to get API key settings:', err);
    return { error: 'Failed to load settings' };
  }
}

/**
 * Update a setting on the API Keys tab.
 */
export async function updateApiKeySetting(key, value) {
  const user = await requireAuth();
  if (!API_KEY_SECRETS.has(key)) {
    return { error: 'Invalid key' };
  }
  try {
    const { setConfigSecret, deleteConfigSecret } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');

    if (value) {
      setConfigSecret(key, value, user.id);
    } else {
      deleteConfigSecret(key);
    }

    invalidateConfigCache();
    return { success: true };
  } catch (err) {
    console.error('Failed to update API key setting:', err);
    return { error: 'Failed to update setting' };
  }
}

/**
 * Regenerate a webhook secret (generate random value).
 */
export async function regenerateWebhookSecret(key) {
  const user = await requireAuth();
  if (key !== 'TELEGRAM_WEBHOOK_SECRET' && key !== 'GH_WEBHOOK_SECRET') {
    return { error: 'Invalid key' };
  }
  try {
    const { randomBytes } = await import('crypto');
    const secret = randomBytes(32).toString('hex');
    const { setConfigSecret } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    setConfigSecret(key, secret, user.id);
    invalidateConfigCache();
    return { success: true };
  } catch (err) {
    console.error('Failed to regenerate webhook secret:', err);
    return { error: 'Failed to regenerate secret' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — Telegram setup flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get Telegram status: bot info (if token valid) and webhook info.
 * Used by the admin UI to render the current state of each setup step.
 */
export async function getTelegramStatus() {
  await requireAuth();
  try {
    const { getConfigSecret } = await import('../db/config.js');
    const { validateBotToken, getTelegramWebhookInfo } = await import('../tools/telegram.js');

    const botToken = getConfigSecret('TELEGRAM_BOT_TOKEN');
    const webhookSecret = getConfigSecret('TELEGRAM_WEBHOOK_SECRET');

    let botInfo = null;
    let webhookInfo = null;
    if (botToken) {
      const v = await validateBotToken(botToken);
      if (v.valid) botInfo = { username: v.botInfo.username, id: v.botInfo.id };
      try {
        const info = await getTelegramWebhookInfo(botToken);
        if (info.ok) {
          webhookInfo = {
            url: info.result.url || null,
            hasCustomCertificate: info.result.has_custom_certificate,
            pendingUpdates: info.result.pending_update_count,
            lastErrorMessage: info.result.last_error_message || null,
          };
        }
      } catch {
        // ignore — webhook info is best-effort
      }
    }

    return {
      botInfo,
      botTokenSet: !!botToken,
      webhookSecretSet: !!webhookSecret,
      webhookInfo,
    };
  } catch (err) {
    console.error('Failed to get Telegram status:', err);
    return { error: 'Failed to load Telegram status' };
  }
}

/**
 * Validate a Telegram bot token without saving it.
 * Called from the UI as the user pastes a token to show live feedback.
 */
export async function validateTelegramToken(token) {
  await requireAuth();
  if (!token) return { valid: false, error: 'Token is required' };
  try {
    const { validateBotToken } = await import('../tools/telegram.js');
    const result = await validateBotToken(token);
    if (result.valid) {
      return { valid: true, botInfo: { username: result.botInfo.username, id: result.botInfo.id } };
    }
    return { valid: false, error: result.error };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Register the Telegram webhook with the currently saved bot token.
 * Generates a fresh webhook secret, saves it, and calls Telegram's setWebhook.
 * APP_URL must be configured.
 */
export async function registerTelegramWebhook() {
  const user = await requireAuth();
  try {
    const { getConfigSecret, setConfigSecret } = await import('../db/config.js');
    const { invalidateConfigCache, getConfig } = await import('../config.js');
    const { setTelegramWebhook, generateWebhookSecret } = await import('../tools/telegram.js');

    const botToken = getConfigSecret('TELEGRAM_BOT_TOKEN');
    if (!botToken) return { error: 'Bot token must be set first' };

    const appUrl = getConfig('APP_URL');
    if (!appUrl) return { error: 'APP_URL must be configured first' };

    const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/telegram/webhook`;
    const secret = generateWebhookSecret();
    setConfigSecret('TELEGRAM_WEBHOOK_SECRET', secret, user.id);
    invalidateConfigCache();

    const result = await setTelegramWebhook(botToken, webhookUrl, secret);
    if (!result.ok) {
      return { error: result.description || 'Failed to register webhook' };
    }
    return { success: true, webhookUrl };
  } catch (err) {
    console.error('Failed to register Telegram webhook:', err);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — Chat sub-tab
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get settings for the Helper LLM page (and Providers page — both share this).
 */
export async function getChatSettings() {
  await requireAuth();
  try {
    const { getSecretStatus, getConfigValue, getCustomProviders } = await import('../db/config.js');
    const { BUILTIN_PROVIDERS, getAllCredentialKeys } = await import('../llm-providers.js');

    // Get status of all built-in provider credentials
    const credentialKeys = getAllCredentialKeys();
    const credentialStatuses = getSecretStatus(credentialKeys);

    // Get custom providers (masked)
    const customProviders = getCustomProviders();

    // Get active helper LLM config
    const activeProvider = getConfigValue('LLM_PROVIDER') || '';
    const activeModel = getConfigValue('LLM_MODEL') || '';
    const maxTokens = getConfigValue('LLM_MAX_TOKENS') || '4096';
    const agentBackend = getConfigValue('AGENT_BACKEND') || '';

    return {
      builtinProviders: BUILTIN_PROVIDERS,
      credentialStatuses,
      customProviders,
      active: {
        provider: activeProvider,
        model: activeModel,
        maxTokens,
        agentBackend,
      },
    };
  } catch (err) {
    console.error('Failed to get helper LLM settings:', err);
    return { error: 'Failed to load helper LLM settings' };
  }
}

/**
 * Update a provider credential (API key or OAuth token).
 */
export async function updateProviderCredential(credentialKey, value) {
  const user = await requireAuth();
  try {
    const { getAllCredentialKeys } = await import('../llm-providers.js');
    const allowedKeys = getAllCredentialKeys();
    if (!allowedKeys.includes(credentialKey)) {
      return { error: 'Invalid credential key' };
    }
    const { setConfigSecret, deleteConfigSecret } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    if (value) {
      setConfigSecret(credentialKey, value, user.id);
    } else {
      deleteConfigSecret(credentialKey);
    }
    invalidateConfigCache();
    await syncLitellmConfig();
    return { success: true };
  } catch (err) {
    console.error('Failed to update provider credential:', err);
    return { error: 'Failed to update credential' };
  }
}

/**
 * Sync LiteLLM config: write the active provider's API key and custom providers
 * directly into yaml config files, then restart the litellm container.
 * Non-destructive — skips silently if the litellm dir doesn't exist.
 */
async function syncLitellmConfig() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { PROJECT_ROOT } = await import('../paths.js');
    const litellmDir = path.default.join(PROJECT_ROOT, 'event-handler/litellm');
    if (!fs.default.existsSync(litellmDir)) return;

    const { getConfig } = await import('../config.js');
    const { BUILTIN_PROVIDERS } = await import('../llm-providers.js');

    // Build main.yaml with the active backend's API key baked in
    const backend = getConfig('CODING_AGENT_CLAUDE_CODE_BACKEND') || 'anthropic';
    const provider = BUILTIN_PROVIDERS[backend];
    let apiKey = '';
    if (provider?.litellmProxy) {
      apiKey = getConfig(provider.credentials[0].key) || '';
    }

    let yaml = '# Managed by thepopebot — do not edit manually.\n';
    yaml += '# LiteLLM proxy config. Docs: https://docs.litellm.ai/docs/\n\n';
    yaml += 'model_list:\n';
    if (provider?.litellmProxy && apiKey) {
      yaml += `  - model_name: "${provider.litellmPrefix}/*"\n`;
      yaml += `    litellm_params:\n`;
      yaml += `      model: "${provider.litellmPrefix}/*"\n`;
      yaml += `      api_key: "${apiKey}"\n`;
    }

    // Add custom providers
    const { getCustomProviders } = await import('../db/config.js');
    const customProviders = getCustomProviders();
    for (const p of customProviders) {
      yaml += `  - model_name: "${p.key}/*"\n`;
      yaml += `    litellm_params:\n`;
      yaml += `      model: "openai/*"\n`;
      yaml += `      api_base: "${p.baseUrl}"\n`;
      if (p.apiKey) yaml += `      api_key: "${p.apiKey}"\n`;
    }

    fs.default.writeFileSync(path.default.join(litellmDir, 'main.yaml'), yaml);

    // Restart litellm container to pick up new config
    const { restartLitellm } = await import('../tools/docker.js');
    restartLitellm(); // fire-and-forget — don't block the UI
  } catch (err) {
    console.error('Failed to sync LiteLLM config:', err);
  }
}

/**
 * Add a custom LLM provider.
 */
export async function addCustomProvider(config) {
  const user = await requireAuth();
  try {
    const { setCustomProvider } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    // Generate slug from name
    const slug = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setCustomProvider(slug, config, user.id);
    invalidateConfigCache();
    await syncLitellmConfig();
    return { success: true, key: slug };
  } catch (err) {
    console.error('Failed to add custom provider:', err);
    return { error: 'Failed to add provider' };
  }
}

/**
 * Update a custom LLM provider.
 */
export async function updateCustomProvider(key, config) {
  const user = await requireAuth();
  try {
    const { setCustomProvider } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    setCustomProvider(key, config, user.id);
    invalidateConfigCache();
    await syncLitellmConfig();
    return { success: true };
  } catch (err) {
    console.error('Failed to update custom provider:', err);
    return { error: 'Failed to update provider' };
  }
}

/**
 * Delete a custom LLM provider.
 */
export async function removeCustomProvider(key) {
  const user = await requireAuth();
  try {
    const { deleteCustomProvider } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    deleteCustomProvider(key);
    invalidateConfigCache();
    await syncLitellmConfig();
    return { success: true };
  } catch (err) {
    console.error('Failed to delete custom provider:', err);
    return { error: 'Failed to delete provider' };
  }
}

/**
 * Set the active LLM configuration (provider, model, max tokens, web search).
 */
export async function setActiveLlm(provider, model, maxTokens) {
  const user = await requireAuth();
  try {
    const { setConfigValue } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    setConfigValue('LLM_PROVIDER', provider, user.id);
    setConfigValue('LLM_MODEL', model, user.id);
    if (maxTokens) setConfigValue('LLM_MAX_TOKENS', maxTokens, user.id);
    invalidateConfigCache();
    return { success: true };
  } catch (err) {
    console.error('Failed to set active LLM:', err);
    return { error: 'Failed to update LLM configuration' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — GitHub sub-tab
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get GitHub secrets and variables.
 */
// Known GitHub secrets and variables (mirrors setup/lib/targets.mjs)
const GITHUB_SECRETS = [
  { name: 'GH_WEBHOOK_SECRET', label: 'Webhook Secret' },
];

const GITHUB_VARIABLES = [
  { name: 'AUTO_MERGE', label: 'Auto Merge' },
  { name: 'ALLOWED_PATHS', label: 'Allowed Paths' },
  { name: 'RUNS_ON', label: 'Runs On' },
  { name: 'APP_URL', label: 'App URL' },
];

/**
 * Get GitHub secrets and variables config.
 * Fetches real lists from GitHub API and merges with known names.
 */
export async function getGitHubConfig() {
  await requireAuth();
  const { getConfig } = await import('../config.js');
  const token = getConfig('GH_TOKEN');
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;

  if (!token || !owner || !repo) {
    return { error: 'GitHub not configured' };
  }

  const { listGitHubSecrets, listGitHubVariables } = await import('../github-api.js');

  // Fetch actual secrets/variables from GitHub (names only for secrets)
  const [remoteSecrets, remoteVariables] = await Promise.all([
    listGitHubSecrets(),
    listGitHubVariables(),
  ]);

  // Build secrets list: known names + any extras from GitHub, with isSet flag
  const remoteSecretNames = new Set(
    Array.isArray(remoteSecrets) ? remoteSecrets.map((s) => s.name) : []
  );
  const secrets = GITHUB_SECRETS.map((s) => ({ ...s, isSet: remoteSecretNames.has(s.name) }));
  // Add any secrets on GitHub that aren't in our known list
  for (const name of remoteSecretNames) {
    if (!GITHUB_SECRETS.find((s) => s.name === name)) {
      secrets.push({ name, isSet: true });
    }
  }

  // Build variables list: known names + any extras, with current value
  const remoteVarMap = new Map(
    Array.isArray(remoteVariables) ? remoteVariables.map((v) => [v.name, v.value]) : []
  );
  const variables = GITHUB_VARIABLES.map((v) => ({ ...v, value: remoteVarMap.get(v.name) ?? '', isSet: remoteVarMap.has(v.name) }));
  for (const [name, value] of remoteVarMap) {
    if (!GITHUB_VARIABLES.find((v) => v.name === name)) {
      variables.push({ name, value, isSet: true });
    }
  }

  return { secrets, variables };
}

/**
 * Update a GitHub repository secret.
 */
export async function updateGitHubSecret(name, value) {
  await requireAuth();
  try {
    const { setGitHubSecret } = await import('../github-api.js');
    return await setGitHubSecret(name, value);
  } catch (err) {
    console.error('Failed to update GitHub secret:', err);
    return { error: err.message };
  }
}

/**
 * Delete a GitHub repository secret.
 */
export async function deleteGitHubSecretAction(name) {
  await requireAuth();
  try {
    const { deleteGitHubSecret } = await import('../github-api.js');
    return await deleteGitHubSecret(name);
  } catch (err) {
    console.error('Failed to delete GitHub secret:', err);
    return { error: err.message };
  }
}

/**
 * Update a GitHub repository variable.
 */
export async function updateGitHubVariable(name, value) {
  await requireAuth();
  try {
    const { setGitHubVariable } = await import('../github-api.js');
    return await setGitHubVariable(name, value);
  } catch (err) {
    console.error('Failed to update GitHub variable:', err);
    return { error: err.message };
  }
}

/**
 * Delete a GitHub repository variable.
 */
// ─────────────────────────────────────────────────────────────────────────────
// Settings — Jobs sub-tab (agent job secrets)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all agent job secrets (metadata only).
 */
export async function getAgentJobSecrets() {
  await requireAuth();
  try {
    const { listAgentJobSecrets } = await import('../db/config.js');
    return listAgentJobSecrets();
  } catch (err) {
    console.error('Failed to get agent job secrets:', err);
    return [];
  }
}

/**
 * Update or create an agent job secret.
 * @param {string} name - Must match [A-Z0-9_]+
 * @param {string} value
 */
export async function updateAgentJobSecret(name, value) {
  const user = await requireAuth();
  if (!name || !/^[A-Z0-9_]+$/.test(name)) {
    return { error: 'Invalid name — must be uppercase letters, numbers, and underscores only' };
  }
  try {
    const { setAgentJobSecret } = await import('../db/config.js');
    setAgentJobSecret(name, value, user.id);
    return { success: true };
  } catch (err) {
    console.error('Failed to update agent job secret:', err);
    return { error: 'Failed to update secret' };
  }
}

/**
 * Initiate an OAuth authorization flow.
 * Encrypts client credentials into the state param and returns the data
 * needed for the client to build the authorize URL.
 */
export async function initiateOAuthFlow({ secretName, clientId, clientSecret, tokenUrl, scopes, secretType, returnPath }) {
  await requireAuth();
  if (!secretName || !clientId || !clientSecret || !tokenUrl) {
    return { error: 'Missing required fields' };
  }
  try {
    const { createOAuthState } = await import('../oauth/helper.js');
    const redirectUri = `${process.env.AUTH_URL}/api/oauth/callback`;
    const state = createOAuthState({ secretName, clientId, clientSecret, tokenUrl, secretType: secretType || 'agent_job_secret', returnPath: returnPath || '/admin/event-handler/agent-secrets' });
    return { state, redirectUri };
  } catch (err) {
    console.error('Failed to initiate OAuth flow:', err);
    return { error: 'Failed to initiate OAuth flow' };
  }
}

/**
 * Get stored OAuth credentials for an agent job secret (for re-authorization pre-fill).
 * @param {string} name
 */
export async function getOAuthSecretCredentials(name) {
  await requireAuth();
  try {
    const { getAgentJobSecretOAuthCredentials } = await import('../db/config.js');
    return getAgentJobSecretOAuthCredentials(name) || { error: 'Not an OAuth secret' };
  } catch (err) {
    console.error('Failed to get OAuth credentials:', err);
    return { error: 'Failed to get credentials' };
  }
}

/**
 * Delete an agent job secret.
 * @param {string} name
 */
export async function deleteAgentJobSecretAction(name) {
  await requireAuth();
  try {
    const { deleteAgentJobSecret } = await import('../db/config.js');
    deleteAgentJobSecret(name);
    return { success: true };
  } catch (err) {
    console.error('Failed to delete agent job secret:', err);
    return { error: 'Failed to delete secret' };
  }
}

export async function deleteGitHubVariableAction(name) {
  await requireAuth();
  try {
    const { deleteGitHubVariable } = await import('../github-api.js');
    return await deleteGitHubVariable(name);
  } catch (err) {
    console.error('Failed to delete GitHub variable:', err);
    return { error: err.message };
  }
}

/**
 * Issue (or re-issue) a Telegram verification code for the current user.
 * Returns the code, expiry, and the bot's @username for instructions.
 */
export async function issueTelegramCode() {
  const user = await requireAuth();
  const { issueCode } = await import('../db/user-channels.js');
  const { getConfig } = await import('../config.js');
  const { validateBotToken } = await import('../tools/telegram.js');

  try {
    const row = issueCode(user.id, 'telegram');
    const botToken = getConfig('TELEGRAM_BOT_TOKEN');
    let botUsername = null;
    if (botToken) {
      const info = await validateBotToken(botToken);
      if (info.valid) botUsername = info.botInfo.username;
    }
    return { code: row.code, expiresAt: row.codeExpiresAt, botUsername };
  } catch (err) {
    // If already verified, surface that so the UI can offer "unlink first"
    return { error: err.message };
  }
}

/**
 * Unlink the current user's Telegram channel binding.
 */
export async function unlinkTelegramChannel() {
  const user = await requireAuth();
  const { unlink } = await import('../db/user-channels.js');
  unlink(user.id, 'telegram');
  return { ok: true };
}


