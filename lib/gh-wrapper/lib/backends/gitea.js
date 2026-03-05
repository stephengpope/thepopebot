'use strict';

/**
 * Gitea backend for gh-wrapper.
 *
 * Translates gh CLI commands to Gitea API calls at runtime.
 * The code calling `gh` never knows it is talking to Gitea.
 *
 * Gitea API reference: https://gitea.io/api/swagger
 *
 * gh commands handled:
 *   auth   status | login [--with-token] | setup-git
 *   secret set <NAME> --repo <owner/repo>          (value via stdin)
 *   secret list   --repo <owner/repo>
 *   variable set <NAME> --repo <owner/repo>        (value via stdin)
 *   api    <endpoint> [-q/--jq <expr>]
 *   pr     view  | list | diff | create | merge
 *   release list | create
 */

const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const config = require('../config.js');
const { parseArgs, parseRepo, getJqExpr } = require('../args.js');
const { giteaRequest, readStdin } = require('../http.js');
const { applyJq, applyJqLines } = require('../jq-lite.js');

// ---------------------------------------------------------------------------
// Gitea version / quirk detection
// ---------------------------------------------------------------------------

// Cached Gitea version string (lazy-loaded on first use).
let _giteaVersion = null;

/**
 * Return the Gitea server version string, e.g. "1.25.0+dev-foo".
 * Result is cached after the first call.
 * Respects GITEA_QUIRKS env var for manual override (useful in CI/test).
 */
async function getGiteaVersion() {
  if (_giteaVersion !== null) return _giteaVersion;
  if (process.env.GITEA_QUIRKS) {
    _giteaVersion = process.env.GITEA_QUIRKS;
    return _giteaVersion;
  }
  try {
    const data = await giteaRequest('GET', `${apiBase()}/version`, null, token());
    _giteaVersion = (data && data.version) ? data.version : '';
  } catch {
    _giteaVersion = '';
  }
  return _giteaVersion;
}

/**
 * Returns true when the Gitea server is known to silently drop body fields
 * whose names contain underscores (affects Gitea 1.25.x).
 *
 * Manual override: set GITEA_QUIRKS=underscore (or GITEA_QUIRKS=1.25).
 */
async function hasUnderscoreQuirk() {
  const ver = await getGiteaVersion();
  return ver.startsWith('1.25') || ver === 'underscore';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiBase() {
  if (!config.giteaUrl) {
    throw new Error('GITEA_URL is not set. Please set GITEA_URL to your Gitea instance URL.');
  }
  return `${config.giteaUrl}/api/v1`;
}

function token() {
  if (!config.token) {
    throw new Error('No Gitea token found. Set GITEA_TOKEN or GH_TOKEN.');
  }
  return config.token;
}

/** Output JSON (or raw string) like gh CLI does. */
function outputJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/** Apply --json field filter then optional --jq/−q expression and print. */
function outputWithFilters(data, jsonFields, jqExpr) {
  let out = data;

  // --json: filter object (or array of objects) to only the listed fields
  if (jsonFields && out && typeof out === 'object') {
    const fields = jsonFields.split(',').map(f => f.trim()).filter(Boolean);
    if (fields.length) {
      if (Array.isArray(out)) {
        out = out.map(item => {
          const filtered = {};
          for (const f of fields) filtered[f] = item && item[f] !== undefined ? item[f] : null;
          return filtered;
        });
      } else {
        const filtered = {};
        for (const f of fields) filtered[f] = out[f] !== undefined ? out[f] : null;
        out = filtered;
      }
    }
  }

  // --jq / -q: apply expression
  if (jqExpr) {
    const lines = applyJqLines(jqExpr, out, true /* raw */);
    for (const line of lines) process.stdout.write(line + '\n');
    return;
  }

  outputJson(out);
}

/** Map Gitea PR mergeable field to GitHub's string enum. */
function mergeableStr(gitea) {
  if (gitea === null || gitea === undefined) return 'UNKNOWN';
  if (gitea === true) return 'MERGEABLE';
  return 'CONFLICTING';
}

/** Map a Gitea PR object to GitHub-compatible shape. */
function mapPr(pr) {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body || '',
    state: pr.state ? pr.state.toUpperCase() : 'UNKNOWN',
    url: pr.html_url,
    headRefName: pr.head ? pr.head.ref : null,
    baseRefName: pr.base ? pr.base.ref : null,
    isCrossRepository: pr.head && pr.base && pr.head.repo && pr.base.repo
      ? pr.head.repo.full_name !== pr.base.repo.full_name
      : false,
    mergeable: mergeableStr(pr.mergeable),
    mergedAt: pr.merged_time || pr.merged_at || null,
    merged: pr.merged || false,
    commits: [], // populated separately if needed
  };
}

/** Get current git branch. */
function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/** Detect owner/repo from git remote when --repo is not supplied. */
function repoFromGit() {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    // https://gitea.example.com/owner/repo.git  or  git@gitea.example.com:owner/repo.git
    const httpsMatch = remote.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      const [owner, repo] = httpsMatch[1].split('/');
      return { owner, repo };
    }
    const sshMatch = remote.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      const [owner, repo] = sshMatch[1].split('/');
      return { owner, repo };
    }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

// gh auth status
async function authStatus() {
  const data = await giteaRequest('GET', `${apiBase()}/user`, null, token());
  process.stdout.write(`Logged in to ${config.giteaUrl} as ${data.login} (GITEA_TOKEN)\n`);
}

// gh auth login [--with-token]
async function authLogin(flags) {
  if (flags['with-token']) {
    // Token is piped via stdin; we validate it and report success
    const tok = (await readStdin()).trim();
    if (!tok) throw new Error('No token provided on stdin');
    const data = await giteaRequest('GET', `${apiBase()}/user`, null, tok);
    process.stdout.write(`Logged in to ${config.giteaUrl} as ${data.login}\n`);
    return;
  }
  // Interactive login not supported in shim; instruct the user
  process.stderr.write('gh-wrapper (gitea): interactive login not supported.\n');
  process.stderr.write(`  Please set GITEA_TOKEN=<your-token> and GITEA_URL=${config.giteaUrl || '<url>'}\n`);
  process.exit(1);
}

// gh auth setup-git
async function authSetupGit() {
  const tok = token();
  const parsed = new URL(config.giteaUrl);
  const host = parsed.hostname;

  // Write credentials to ~/.git-credentials (store helper format)
  const credLine = `${parsed.protocol}//${tok}@${host}\n`;
  const credFile = path.join(os.homedir(), '.git-credentials');
  let existing = '';
  try { existing = fs.readFileSync(credFile, 'utf-8'); } catch { /* first run */ }

  const hostPrefix = `${parsed.protocol}//${host}`;
  const filteredLines = existing.split('\n').filter(l => !l.startsWith(hostPrefix) && l.trim() !== '');
  filteredLines.push(credLine.trim());
  fs.writeFileSync(credFile, filteredLines.join('\n') + '\n', { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(credFile, 0o600);

  // Configure git to use the credentials store
  execSync('git config --global credential.helper store', { stdio: 'ignore' });

  // Also configure insteadOf for SSH-style clones of this host if needed
  process.stdout.write(`✓ Configured git credentials for ${host}\n`);
}

// gh secret set NAME --repo owner/repo  (value via stdin)
async function secretSet(name, repoFlag) {
  const r = parseRepo(repoFlag) || repoFromGit();
  if (!r) throw new Error('--repo is required (or run from inside a git repo)');
  const value = (await readStdin()).trim();
  if (!value) throw new Error(`No value provided for secret ${name} (pipe the value via stdin)`);

  const encoded = Buffer.from(value).toString('base64');
  const url = `${apiBase()}/repos/${r.owner}/${r.repo}/actions/secrets/${name}`;
  try {
    await giteaRequest('PUT', url, { data: encoded, name }, token());
  } catch (err) {
    if (err.status === 404) {
      // Gitea versions that don't support encrypted secrets fall back to POST
      await giteaRequest('POST', `${apiBase()}/repos/${r.owner}/${r.repo}/actions/secrets`,
        { data: encoded, name }, token());
    } else {
      throw err;
    }
  }
  process.stdout.write(`✓ Set secret ${name} on ${r.owner}/${r.repo}\n`);
}

// gh secret list --repo owner/repo
async function secretList(repoFlag) {
  const r = parseRepo(repoFlag) || repoFromGit();
  if (!r) throw new Error('--repo is required');
  const data = await giteaRequest('GET', `${apiBase()}/repos/${r.owner}/${r.repo}/actions/secrets`, null, token());
  const secrets = data && data.data ? data.data : (Array.isArray(data) ? data : []);
  for (const s of secrets) {
    const updated = s.updated || s.updated_at || s.created || '';
    process.stdout.write(`${s.name}\t${updated}\n`);
  }
}

// gh variable set NAME --repo owner/repo  (value via stdin)
async function variableSet(name, repoFlag) {
  const r = parseRepo(repoFlag) || repoFromGit();
  if (!r) throw new Error('--repo is required');
  const value = (await readStdin()).trim();

  const base = `${apiBase()}/repos/${r.owner}/${r.repo}/actions/variables`;
  try {
    // Try to update first; if 404, create
    await giteaRequest('PUT', `${base}/${name}`, { name, value }, token());
  } catch (err) {
    if (err.status === 404 || err.status === 405) {
      await giteaRequest('POST', base, { name, value }, token());
    } else {
      throw err;
    }
  }
  process.stdout.write(`✓ Set variable ${name} on ${r.owner}/${r.repo}\n`);
}

// gh api <endpoint> [-q expr]
async function apiCall(endpoint, flags) {
  if (!endpoint) throw new Error('Usage: gh api <endpoint>');
  // Strip leading slash; endpoint may already include /api/v1 in some cases
  const cleanEndpoint = endpoint.replace(/^\//, '');
  const url = cleanEndpoint.startsWith('api/v1/')
    ? `${config.giteaUrl}/${cleanEndpoint}`
    : `${apiBase()}/${cleanEndpoint}`;

  const method = (flags['method'] || flags['X'] || 'GET').toUpperCase();
  let body = null;
  if (flags['field'] || flags['raw-field']) {
    body = {};
    // --field key=value  (treated as JSON if value looks like JSON, else string)
    const fields = [].concat(flags['field'] || [], flags['raw-field'] || []);
    for (const f of fields) {
      const eq = f.indexOf('=');
      if (eq > 0) {
        const k = f.slice(0, eq);
        const v = f.slice(eq + 1);
        body[k] = v;
      }
    }
  }

  const data = await giteaRequest(method, url, body, token());

  // GitHub returns some special-shaped objects. Map common ones.
  // /user → Gitea /api/v1/user is directly compatible
  const jqExpr = getJqExpr(flags);
  outputWithFilters(data, flags.json || null, jqExpr);
}

// gh pr view <number> --repo ... [--json fields] [--jq expr]
async function prView(prNumber, repoFlag, flags) {
  const r = parseRepo(repoFlag) || repoFromGit();
  if (!r) throw new Error('--repo is required');
  if (!prNumber) throw new Error('PR number required');

  const pr = await giteaRequest('GET', `${apiBase()}/repos/${r.owner}/${r.repo}/pulls/${prNumber}`, null, token());
  let mapped = mapPr(pr);

  // If commits were requested, fetch them
  if (flags.json && flags.json.includes('commits')) {
    try {
      const commits = await giteaRequest('GET',
        `${apiBase()}/repos/${r.owner}/${r.repo}/pulls/${prNumber}/commits`, null, token());
      mapped.commits = (commits || []).map(c => ({
        messageHeadline: (c.commit && c.commit.message) ? c.commit.message.split('\n')[0] : '',
        sha: c.sha,
      }));
    } catch { /* optional */ }
  }

  outputWithFilters(mapped, flags.json || null, getJqExpr(flags));
}

// gh pr list [--head branch] [--state all|open|closed] --repo ... [--json] [--jq]
async function prList(flags) {
  const r = parseRepo(flags.repo) || repoFromGit();
  if (!r) throw new Error('--repo is required');

  const stateParam = flags.state === 'all' ? 'open&state=closed' : (flags.state || 'open');
  let url = `${apiBase()}/repos/${r.owner}/${r.repo}/pulls?state=${stateParam}&limit=50`;
  if (flags.head) url += `&head=${encodeURIComponent(flags.head)}`;

  const prs = await giteaRequest('GET', url, null, token());
  const mapped = (Array.isArray(prs) ? prs : []).map(mapPr);

  outputWithFilters(mapped, flags.json || null, getJqExpr(flags));
}

// gh pr diff <number> --name-only --repo ...
async function prDiff(prNumber, flags) {
  const r = parseRepo(flags.repo) || repoFromGit();
  if (!r) throw new Error('--repo is required');
  if (!prNumber) throw new Error('PR number required');

  const files = await giteaRequest('GET',
    `${apiBase()}/repos/${r.owner}/${r.repo}/pulls/${prNumber}/files`, null, token());

  if (flags['name-only']) {
    for (const f of (Array.isArray(files) ? files : [])) {
      process.stdout.write((f.filename || f.name || '') + '\n');
    }
  } else {
    // Full diff — Gitea returns file diffs in the 'patch' field
    for (const f of (Array.isArray(files) ? files : [])) {
      if (f.patch) process.stdout.write(f.patch + '\n');
    }
  }
}

// gh pr create --title ... --body ... --base main [--repo owner/repo]
async function prCreate(flags) {
  const r = parseRepo(flags.repo) || repoFromGit();
  if (!r) throw new Error('--repo is required or run from inside a git repo');

  const head = flags.head || currentBranch();
  if (!head) throw new Error('Could not determine head branch. Use --head <branch> or run from a git repo.');

  const base = flags.base || 'main';
  const title = flags.title || head;
  const body = flags.body || '';

  const pr = await giteaRequest('POST', `${apiBase()}/repos/${r.owner}/${r.repo}/pulls`, {
    title,
    body,
    head,
    base,
  }, token());

  process.stdout.write(`${pr.html_url}\n`);
}

// gh pr merge <number-or-branch> [--squash] [--auto] [--delete-branch] --repo ...
async function prMerge(target, flags) {
  const r = parseRepo(flags.repo) || repoFromGit();
  if (!r) throw new Error('--repo is required');

  let prNumber = target;

  // If target looks like a branch name (not a number), find the PR number
  if (target && isNaN(Number(target))) {
    const prs = await giteaRequest('GET',
      `${apiBase()}/repos/${r.owner}/${r.repo}/pulls?state=open&limit=50`, null, token());
    const match = (Array.isArray(prs) ? prs : []).find(p => p.head && p.head.ref === target);
    if (!match) throw new Error(`No open PR found for branch: ${target}`);
    prNumber = match.number;
  }

  const mergeStyle = flags.squash ? 'squash' : flags.rebase ? 'rebase' : 'merge';
  const wantDeleteBranch = flags['delete-branch'] === true || flags['delete-branch'] === 'true';
  const underscoreQuirk = await hasUnderscoreQuirk();

  const body = { Do: mergeStyle };
  if (!underscoreQuirk) {
    // Gitea 1.25 silently drops fields with underscores; skip and handle manually below
    body.delete_branch_after_merge = wantDeleteBranch;
  }

  // --auto: Gitea doesn't have auto-merge in the same way; we just merge directly
  await giteaRequest('POST',
    `${apiBase()}/repos/${r.owner}/${r.repo}/pulls/${prNumber}/merge`, body, token());
  process.stdout.write(`✓ Merged PR #${prNumber}\n`);

  // Workaround for Gitea 1.25: delete branch via a separate API call
  if (underscoreQuirk && wantDeleteBranch) {
    try {
      const pr = await giteaRequest('GET',
        `${apiBase()}/repos/${r.owner}/${r.repo}/pulls/${prNumber}`, null, token());
      const headBranch = pr && pr.head && pr.head.ref;
      if (headBranch) {
        await giteaRequest('DELETE',
          `${apiBase()}/repos/${r.owner}/${r.repo}/branches/${encodeURIComponent(headBranch)}`,
          null, token());
        process.stdout.write(`✓ Deleted branch ${headBranch}\n`);
      }
    } catch (err) {
      process.stderr.write(`gh-wrapper: warning: could not delete branch after merge: ${err.message}\n`);
    }
  }
}

// gh release list --limit N --json tagName --jq expr
async function releaseList(flags) {
  const r = parseRepo(flags.repo) || repoFromGit();
  if (!r) throw new Error('--repo is required');

  const limit = flags.limit || 30;
  const releases = await giteaRequest('GET',
    `${apiBase()}/repos/${r.owner}/${r.repo}/releases?limit=${limit}`, null, token());

  // Map to GitHub-compatible shape
  const mapped = (Array.isArray(releases) ? releases : []).map(rel => ({
    tagName: rel.tag_name,
    name: rel.name,
    body: rel.body || '',
    isDraft: rel.draft || false,
    isPrerelease: rel.prerelease || false,
    createdAt: rel.created_at,
    publishedAt: rel.published_at || rel.created_at,
    url: rel.html_url,
    id: rel.id,
  }));

  outputWithFilters(mapped, flags.json || null, getJqExpr(flags));
}

// gh release create TAG [--title ...] [--notes ...] [--notes-file file] [--prerelease]
async function releaseCreate(tag, flags) {
  const r = parseRepo(flags.repo) || repoFromGit();
  if (!r) throw new Error('--repo is required');
  if (!tag) throw new Error('Tag name required');

  let notes = flags.notes || '';
  if (flags['notes-file']) {
    notes = fs.readFileSync(flags['notes-file'], 'utf-8');
  }

  const prerelease = flags.prerelease === true || flags['pre-release'] === true
    || /-(alpha|beta|rc)/.test(tag);

  const underscoreQuirk = await hasUnderscoreQuirk();
  const targetCommitish = flags.target || flags['target-commitish'];

  const releaseBody = {
    tag_name: tag,
    name: flags.title || tag,
    body: notes,
    draft: flags.draft === true,
    prerelease,
  };

  if (!underscoreQuirk) {
    // Gitea 1.25 silently drops fields with underscores; skip target_commitish
    releaseBody.target_commitish = targetCommitish || 'main';
  } else if (targetCommitish) {
    process.stderr.write(
      `gh-wrapper: warning: Gitea 1.25 ignores target_commitish — ensure tag "${tag}" already points to the correct commit.\n`,
    );
  }

  const rel = await giteaRequest('POST',
    `${apiBase()}/repos/${r.owner}/${r.repo}/releases`, releaseBody, token());

  process.stdout.write(`${rel.html_url}\n`);
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

async function run(argv) {
  const parsed = parseArgs(argv);
  const { command, subcommand, positional, flags } = parsed;

  switch (command) {
    // ── auth ──────────────────────────────────────────────────────────────
    case 'auth':
      switch (subcommand) {
        case 'status':    return authStatus();
        case 'login':     return authLogin(flags);
        case 'setup-git': return authSetupGit();
        default:
          process.stderr.write(`gh-wrapper: unknown auth subcommand: ${subcommand}\n`);
          process.exit(1);
      }
      break;

    // ── secret ────────────────────────────────────────────────────────────
    case 'secret':
      switch (subcommand) {
        case 'set':  return secretSet(positional[0], flags.repo);
        case 'list': return secretList(flags.repo);
        default:
          process.stderr.write(`gh-wrapper: unknown secret subcommand: ${subcommand}\n`);
          process.exit(1);
      }
      break;

    // ── variable ──────────────────────────────────────────────────────────
    case 'variable':
      if (subcommand === 'set') return variableSet(positional[0], flags.repo);
      process.stderr.write(`gh-wrapper: unknown variable subcommand: ${subcommand}\n`);
      process.exit(1);
      break;

    // ── api ───────────────────────────────────────────────────────────────
    case 'api':
      // For 'api', the first positional (parsed as subcommand slot) is the endpoint
      return apiCall(subcommand || positional[0], flags);

    // ── pr ────────────────────────────────────────────────────────────────
    case 'pr':
      switch (subcommand) {
        case 'view':   return prView(positional[0], flags.repo, flags);
        case 'list':   return prList(flags);
        case 'diff':   return prDiff(positional[0], flags);
        case 'create': return prCreate(flags);
        case 'merge':  return prMerge(positional[0], flags);
        default:
          process.stderr.write(`gh-wrapper: unknown pr subcommand: ${subcommand}\n`);
          process.exit(1);
      }
      break;

    // ── release ───────────────────────────────────────────────────────────
    case 'release':
      switch (subcommand) {
        case 'list':   return releaseList(flags);
        case 'create': return releaseCreate(positional[0], flags);
        default:
          process.stderr.write(`gh-wrapper: unknown release subcommand: ${subcommand}\n`);
          process.exit(1);
      }
      break;

    // ── repo (stub) ───────────────────────────────────────────────────────
    case 'repo':
      if (subcommand === 'create') {
        const repoName = positional[0];
        if (!repoName) throw new Error('Repository name required');
        // repoName may be 'owner/repo' or just 'repo' (create under authenticated user)
        const isOrg = repoName.includes('/');
        const [orgOrUser, name] = isOrg ? repoName.split('/') : [null, repoName];
        const body = {
          name: name || repoName,
          description: flags.description || '',
          private: flags.private === true,
          auto_init: flags['add-readme'] === true,
        };
        const url = orgOrUser
          ? `${apiBase()}/orgs/${orgOrUser}/repos`
          : `${apiBase()}/user/repos`;
        const repo = await giteaRequest('POST', url, body, token());
        process.stdout.write(`${repo.html_url}\n`);
        return;
      }
      process.stderr.write(`gh-wrapper: repo ${subcommand} not implemented\n`);
      process.exit(1);
      break;

    // ── version / help (pass through gracefully) ──────────────────────────
    case '--version':
    case 'version':
      process.stdout.write('gh-wrapper (gitea backend) 1.0.0\n');
      return;

    case '--help':
    case 'help':
    case null:
    case undefined:
      process.stdout.write('gh-wrapper: drop-in gh shim for Gitea\n');
      process.stdout.write('Set GH_WRAPPER_BACKEND=gitea to use Gitea backend.\n');
      return;

    default:
      process.stderr.write(`gh-wrapper: unknown command: ${command}\n`);
      process.exit(1);
  }
}

module.exports = { run };
