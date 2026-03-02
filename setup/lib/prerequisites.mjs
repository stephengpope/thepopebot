import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Return process.env suitable for invoking the gh CLI (or gh-wrapper shim).
 *
 * GitHub mode: strips GITHUB_TOKEN and GH_TOKEN so the real gh CLI uses the
 * interactive session rather than the ambient token.
 *
 * Gitea mode: strips only GITHUB_TOKEN (which would confuse the shim) but
 * keeps GH_TOKEN — the shim uses it as the Gitea API token when
 * GITEA_TOKEN is not explicitly set.
 */
export function ghEnv() {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  if (process.env.GH_WRAPPER_BACKEND !== 'gitea') {
    delete env.GH_TOKEN;
  }
  return env;
}

/**
 * Check if a command exists
 */
function commandExists(cmd) {
  const checkCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    execSync(`${checkCmd} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Node.js version
 */
function getNodeVersion() {
  try {
    const version = execSync('node --version', { encoding: 'utf-8' }).trim();
    return version.replace('v', '');
  } catch {
    return null;
  }
}

/**
 * Check if gh CLI is authenticated
 */
async function isGhAuthenticated() {
  try {
    await execAsync('gh auth status', { env: ghEnv() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get git remote info (owner/repo).
 * Works with GitHub remotes (github.com) and Gitea remotes (any host).
 */
function getGitRemoteInfo() {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    // HTTPS: https://host/owner/repo.git
    const httpsMatch = remote.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
    // SSH: git@host:owner/repo.git
    const sshMatch = remote.match(/@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
    return null;
  } catch {
    return null;
  }
}

/**
 * Get package manager (pnpm preferred, npm fallback)
 */
function getPackageManager() {
  if (commandExists('pnpm')) return 'pnpm';
  if (commandExists('npm')) return 'npm';
  return null;
}

/**
 * Check all prerequisites and return status
 */
export async function checkPrerequisites() {
  const results = {
    node: { installed: false, version: null, ok: false },
    packageManager: { installed: false, name: null },
    gh: { installed: false, authenticated: false },
    ngrok: { installed: false },
    git: { installed: false, remoteInfo: null },
  };

  // Check Node.js
  const nodeVersion = getNodeVersion();
  if (nodeVersion) {
    results.node.installed = true;
    results.node.version = nodeVersion;
    const [major] = nodeVersion.split('.').map(Number);
    results.node.ok = major >= 18;
  }

  // Check package manager
  const pm = getPackageManager();
  if (pm) {
    results.packageManager.installed = true;
    results.packageManager.name = pm;
  }

  // Check gh CLI
  results.gh.installed = commandExists('gh');
  if (results.gh.installed) {
    results.gh.authenticated = await isGhAuthenticated();
  }

  // Check ngrok
  results.ngrok.installed = commandExists('ngrok');

  // Check git
  results.git.installed = commandExists('git');
  if (results.git.installed) {
    // Initialize git repo if needed (must happen before remote check)
    try {
      execSync('git rev-parse --git-dir', { stdio: 'ignore' });
      results.git.initialized = true;
    } catch {
      results.git.initialized = false;
    }
    results.git.remoteInfo = getGitRemoteInfo();
  }

  return results;
}

/**
 * Install a global npm package
 */
export async function installGlobalPackage(packageName) {
  const pm = getPackageManager();
  const cmd = pm === 'pnpm' ? `pnpm add -g ${packageName}` : `npm install -g ${packageName}`;
  await execAsync(cmd);
}

/**
 * Run gh auth login
 */
export async function runGhAuth() {
  // This needs to be interactive, so we use execSync
  execSync('gh auth login', { stdio: 'inherit', env: ghEnv() });
}

export { commandExists, getGitRemoteInfo, getPackageManager };
