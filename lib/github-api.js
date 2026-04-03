/**
 * GitHub REST API for managing repository secrets and variables.
 * Uses GH_TOKEN from DB config, GH_OWNER/GH_REPO from process.env.
 */

import { getConfig } from './config.js';

const API_BASE = 'https://api.github.com';

function getRepoPath() {
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

function getToken() {
  return getConfig('GH_TOKEN');
}

async function ghFetch(path, options = {}) {
  const token = getToken();
  if (!token) throw new Error('GitHub not configured');

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Repositories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all repositories accessible by the authenticated user.
 */
export async function listGitHubRepos() {
  try {
    const repos = [];
    let page = 1;
    while (true) {
      const data = await ghFetch(`/user/repos?type=all&sort=updated&per_page=100&page=${page}`);
      if (data.length === 0) break;
      repos.push(...data);
      page++;
    }
    return repos.map((r) => ({
      name: r.full_name,
      isPrivate: r.private,
      updatedAt: r.updated_at,
    }));
  } catch (err) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Secrets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all repository action secrets (name + updated_at only — values never returned).
 */
export async function listGitHubSecrets() {
  const repo = getRepoPath();
  if (!repo) return { error: 'GitHub not configured' };
  try {
    const data = await ghFetch(`/repos/${repo}/actions/secrets`);
    return data.secrets.map((s) => ({ name: s.name, updatedAt: s.updated_at }));
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Set a repository secret (encrypted with repo public key per GitHub API requirement).
 */
export async function setGitHubSecret(name, value) {
  const repo = getRepoPath();
  if (!repo) return { error: 'GitHub not configured' };
  try {
    const pubKey = await ghFetch(`/repos/${repo}/actions/secrets/public-key`);

    const sodium = await import('libsodium-wrappers');
    await sodium.default.ready;
    const binKey = sodium.default.from_base64(pubKey.key, sodium.default.base64_variants.ORIGINAL);
    const binValue = sodium.default.from_string(value);
    const encrypted = sodium.default.crypto_box_seal(binValue, binKey);
    const encryptedBase64 = sodium.default.to_base64(encrypted, sodium.default.base64_variants.ORIGINAL);

    await ghFetch(`/repos/${repo}/actions/secrets/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        encrypted_value: encryptedBase64,
        key_id: pubKey.key_id,
      }),
    });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Delete a repository secret.
 */
export async function deleteGitHubSecret(name) {
  const repo = getRepoPath();
  if (!repo) return { error: 'GitHub not configured' };
  try {
    await ghFetch(`/repos/${repo}/actions/secrets/${name}`, { method: 'DELETE' });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Variables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all repository action variables (name + value + updated_at).
 */
export async function listGitHubVariables() {
  const repo = getRepoPath();
  if (!repo) return { error: 'GitHub not configured' };
  try {
    const data = await ghFetch(`/repos/${repo}/actions/variables`);
    return data.variables.map((v) => ({
      name: v.name,
      value: v.value,
      updatedAt: v.updated_at,
    }));
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Set a repository variable (create or update).
 */
export async function setGitHubVariable(name, value) {
  const repo = getRepoPath();
  if (!repo) return { error: 'GitHub not configured' };
  try {
    // Try PATCH first (update existing)
    try {
      await ghFetch(`/repos/${repo}/actions/variables/${name}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value }),
      });
      return { success: true };
    } catch {
      // If PATCH fails (404), try POST (create new)
      await ghFetch(`/repos/${repo}/actions/variables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, value }),
      });
      return { success: true };
    }
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Delete a repository variable.
 */
export async function deleteGitHubVariable(name) {
  const repo = getRepoPath();
  if (!repo) return { error: 'GitHub not configured' };
  try {
    await ghFetch(`/repos/${repo}/actions/variables/${name}`, { method: 'DELETE' });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}
