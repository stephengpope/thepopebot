import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { ghEnv } from './prerequisites.mjs';

const execAsync = promisify(exec);

const isGiteaBackend = () => process.env.GH_WRAPPER_BACKEND === 'gitea';
const giteaUrl = () => (process.env.GITEA_URL || '').replace(/\/$/, '');

/**
 * Validate a token by making a test API call.
 * Works for both GitHub (PAT) and Gitea (access token) depending on GH_WRAPPER_BACKEND.
 */
export async function validatePAT(token) {
  try {
    if (isGiteaBackend()) {
      const base = giteaUrl();
      if (!base) return { valid: false, error: 'GITEA_URL is not set' };
      const response = await fetch(`${base}/api/v1/user`, {
        headers: { Authorization: `token ${token}` },
      });
      if (!response.ok) return { valid: false, error: 'Invalid token' };
      const user = await response.json();
      return { valid: true, user: user.login };
    }
    // GitHub default
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (!response.ok) return { valid: false, error: 'Invalid token' };
    const user = await response.json();
    return { valid: true, user: user.login };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Check token scopes/permissions.
 * For Gitea, tokens have full access by default; returns hasRepo/hasWorkflow=true.
 */
export async function checkPATScopes(token) {
  try {
    if (isGiteaBackend()) {
      // Gitea tokens don't expose OAuth scopes; assume full access if the token is valid
      const base = giteaUrl();
      const response = await fetch(`${base}/api/v1/user`, {
        headers: { Authorization: `token ${token}` },
      });
      if (!response.ok) return { hasRepo: false, hasWorkflow: false, scopes: [], isFineGrained: false };
      return { hasRepo: true, hasWorkflow: true, scopes: [], isFineGrained: true };
    }
    // GitHub default
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    const scopes = response.headers.get('x-oauth-scopes') || '';
    const scopeList = scopes.split(',').map((s) => s.trim()).filter(Boolean);

    // Classic tokens have x-oauth-scopes header
    if (scopeList.length > 0) {
      return {
        hasRepo: scopeList.includes('repo'),
        hasWorkflow: scopeList.includes('workflow'),
        scopes: scopeList,
        isFineGrained: false,
      };
    }

    // Fine-grained tokens don't have x-oauth-scopes header
    // We can't check permissions directly, so we assume valid if token works
    return {
      hasRepo: true,
      hasWorkflow: true,
      scopes: [],
      isFineGrained: true,
    };
  } catch {
    return { hasRepo: false, hasWorkflow: false, scopes: [], isFineGrained: false };
  }
}

/**
 * Set a GitHub repository secret using gh CLI
 */
export async function setSecret(owner, repo, name, value) {
  try {
    execSync(
      `gh secret set ${name} --repo ${owner}/${repo}`,
      { input: value, encoding: 'utf-8', env: ghEnv(), stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Set multiple GitHub secrets
 */
export async function setSecrets(owner, repo, secrets) {
  const results = {};
  for (const [name, value] of Object.entries(secrets)) {
    results[name] = await setSecret(owner, repo, name, value);
  }
  return results;
}

/**
 * List existing secrets
 */
export async function listSecrets(owner, repo) {
  try {
    const { stdout } = await execAsync(`gh secret list --repo ${owner}/${repo}`, {
      encoding: 'utf-8',
      env: ghEnv(),
    });
    const secrets = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t')[0]);
    return secrets;
  } catch {
    return [];
  }
}

/**
 * Set a GitHub repository variable using gh CLI
 */
export async function setVariable(owner, repo, name, value) {
  try {
    execSync(
      `gh variable set ${name} --repo ${owner}/${repo}`,
      { input: value, encoding: 'utf-8', env: ghEnv(), stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Set multiple GitHub repository variables
 */
export async function setVariables(owner, repo, variables) {
  const results = {};
  for (const [name, value] of Object.entries(variables)) {
    results[name] = await setVariable(owner, repo, name, value);
  }
  return results;
}

/**
 * Generate a random webhook secret
 */
export function generateWebhookSecret() {
  return randomBytes(32).toString('hex');
}

/**
 * Get the token creation URL.
 * For Gitea, returns the user settings/applications page.
 * For GitHub, returns the PAT creation page with pre-selected scopes.
 */
export function getPATCreationURL() {
  if (process.env.GH_WRAPPER_BACKEND === 'gitea') {
    const base = (process.env.GITEA_URL || '').replace(/\/$/, '');
    return base ? `${base}/user/settings/applications` : '';
  }
  return 'https://github.com/settings/personal-access-tokens/new';
}
