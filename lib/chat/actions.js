'use server';

import { auth } from '../auth/index.js';
import {
  createChat as dbCreateChat,
  getChatById,
  getChatByWorkspaceId,
  getMessagesByChatId,
  deleteChat as dbDeleteChat,
  deleteAllChatsByUser,
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
      codeWorkspaceId: chats.codeWorkspaceId,
      containerName: codeWorkspaces.containerName,
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
 * Delete all chats for the authenticated user.
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteAllChats() {
  const user = await requireAuth();
  deleteAllChatsByUser(user.id);
  return { success: true };
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
 * @param {string} name - Human-readable name
 * @param {string} token - Raw OAuth token
 * @returns {Promise<{ id: string, name: string, createdAt: number, lastUsedAt: null } | { error: string }>}
 */
export async function createOAuthToken(name, token) {
  const user = await requireAuth();
  try {
    const { createOAuthToken: dbCreate } = await import('../db/oauth-tokens.js');
    const { invalidateConfigCache } = await import('../config.js');
    const result = dbCreate(name || 'OAuth Token', token, user.id);
    invalidateConfigCache();
    return result;
  } catch (err) {
    console.error('Failed to create OAuth token:', err);
    return { error: 'Failed to create OAuth token' };
  }
}

/**
 * List all OAuth tokens (metadata only).
 * @returns {Promise<object[]>}
 */
export async function getOAuthTokens() {
  await requireAuth();
  try {
    const { listOAuthTokens } = await import('../db/oauth-tokens.js');
    return listOAuthTokens();
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
    return { id: ws.id, repo: ws.repo, branch: ws.branch, containerName: ws.containerName, codingAgent: ws.codingAgent, featureBranch: ws.featureBranch };
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
  const { cronsFile, triggersFile } = await import('../paths.js');
  const fs = await import('fs');
  let crons = [];
  let triggers = [];
  try { crons = JSON.parse(fs.readFileSync(cronsFile, 'utf8')); } catch {}
  try { triggers = JSON.parse(fs.readFileSync(triggersFile, 'utf8')); } catch {}
  return { crons, triggers };
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
const API_KEY_CONFIGS = new Set(['TELEGRAM_CHAT_ID']);

/**
 * Get settings for the API Keys sub-tab.
 */
export async function getApiKeySettings() {
  await requireAuth();
  try {
    const { getSecretStatus, getConfigValue } = await import('../db/config.js');
    const secretKeys = [...API_KEY_SECRETS];
    const statuses = getSecretStatus(secretKeys);
    const telegramChatId = getConfigValue('TELEGRAM_CHAT_ID');
    return { secrets: statuses, telegramChatId };
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
  try {
    const { setConfigSecret, setConfigValue, deleteConfigSecret } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');

    if (API_KEY_SECRETS.has(key)) {
      if (value) {
        setConfigSecret(key, value, user.id);
      } else {
        deleteConfigSecret(key);
      }
    } else if (API_KEY_CONFIGS.has(key)) {
      setConfigValue(key, value, user.id);
    } else {
      return { error: 'Invalid key' };
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
// Settings — Chat sub-tab
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get settings for the Chat sub-tab.
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

    // Get active config values
    const activeProvider = getConfigValue('LLM_PROVIDER') || process.env.LLM_PROVIDER || 'anthropic';
    const activeModel = getConfigValue('LLM_MODEL') || process.env.LLM_MODEL || '';
    const maxTokens = getConfigValue('LLM_MAX_TOKENS') || process.env.LLM_MAX_TOKENS || '4096';
    const webSearch = getConfigValue('WEB_SEARCH') || process.env.WEB_SEARCH || 'true';
    const agentBackend = getConfigValue('AGENT_BACKEND') || process.env.AGENT_BACKEND || 'claude-code';

    return {
      builtinProviders: BUILTIN_PROVIDERS,
      credentialStatuses,
      customProviders,
      active: {
        provider: activeProvider,
        model: activeModel,
        maxTokens,
        webSearch,
        agentBackend,
      },
    };
  } catch (err) {
    console.error('Failed to get chat settings:', err);
    return { error: 'Failed to load chat settings' };
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
    return { success: true };
  } catch (err) {
    console.error('Failed to update provider credential:', err);
    return { error: 'Failed to update credential' };
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
    return { success: true };
  } catch (err) {
    console.error('Failed to delete custom provider:', err);
    return { error: 'Failed to delete provider' };
  }
}

/**
 * Set the active LLM configuration (provider, model, max tokens, web search).
 */
export async function setActiveLlm(provider, model, maxTokens, webSearch) {
  const user = await requireAuth();
  try {
    const { setConfigValue } = await import('../db/config.js');
    const { invalidateConfigCache } = await import('../config.js');
    setConfigValue('LLM_PROVIDER', provider, user.id);
    setConfigValue('LLM_MODEL', model, user.id);
    if (maxTokens) setConfigValue('LLM_MAX_TOKENS', maxTokens, user.id);
    if (webSearch !== undefined) setConfigValue('WEB_SEARCH', webSearch, user.id);
    invalidateConfigCache();
    // Reset the agent singleton so it picks up new config
    try {
      const { resetAgent } = await import('../ai/agent.js');
      resetAgent();
    } catch {
      // Non-fatal — agent may not be initialized yet
    }
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
  { name: 'AGENT_GH_TOKEN', label: 'GitHub Token' },
  { name: 'AGENT_ANTHROPIC_API_KEY', label: 'Anthropic API Key' },
  { name: 'AGENT_OPENAI_API_KEY', label: 'OpenAI API Key' },
  { name: 'AGENT_GOOGLE_API_KEY', label: 'Google API Key' },
  { name: 'AGENT_NOVITA_API_KEY', label: 'Novita API Key' },
  { name: 'AGENT_CUSTOM_API_KEY', label: 'Custom API Key' },
  { name: 'AGENT_CLAUDE_CODE_OAUTH_TOKEN', label: 'Claude Code OAuth' },
  { name: 'AGENT_LLM_BRAVE_API_KEY', label: 'Brave API Key' },
  { name: 'GH_WEBHOOK_SECRET', label: 'Webhook Secret' },
];

const GITHUB_VARIABLES = [
  { name: 'LLM_PROVIDER', label: 'LLM Provider' },
  { name: 'LLM_MODEL', label: 'LLM Model' },
  { name: 'OPENAI_BASE_URL', label: 'OpenAI Base URL' },
  { name: 'AGENT_BACKEND', label: 'Agent Backend' },
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

