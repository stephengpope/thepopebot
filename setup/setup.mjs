#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import * as clack from '@clack/prompts';

import { initDatabase } from '../lib/db/index.js';

import {
  checkPrerequisites,
  runGhAuth,
  ghEnv,
  canOpenBrowser,
} from './lib/prerequisites.mjs';
import {
  promptForPAT,
  confirm,
  pressEnter,
  maskSecret,
  keepOrReconfigure,
  openOrShowURL,
} from './lib/prompts.mjs';
import {
  validatePAT,
  checkPATScopes,
  generateWebhookSecret,
  getPATCreationURL,
} from './lib/github.mjs';
import dotenv from 'dotenv';
import { loadEnvFile } from './lib/env.mjs';
import { syncConfig } from './lib/sync.mjs';

const logo = `
 _____ _          ____                  ____        _
|_   _| |__   ___|  _ \\ ___  _ __   ___| __ )  ___ | |_
  | | | '_ \\ / _ \\ |_) / _ \\| '_ \\ / _ \\  _ \\ / _ \\| __|
  | | | | | |  __/  __/ (_) | |_) |  __/ |_) | (_) | |_
  |_| |_| |_|\\___|_|   \\___/| .__/ \\___|____/ \\___/ \\__|
                            |_|
`;

async function main() {
  console.log(chalk.cyan(logo));
  clack.intro('Interactive Setup Wizard');

  const TOTAL_STEPS = 5;
  let currentStep = 0;

  // Load existing .env (always exists after init — seed .env has AUTH_SECRET etc.)
  const env = loadEnvFile();

  dotenv.config();

  if (env) {
    clack.log.info('Existing .env detected — previously configured values can be skipped.');
  }

  // Flat object collecting all config values for sync
  const collected = {};
  let owner = null;
  let repo = null;

  // ─── Step 1: Prerequisites ───────────────────────────────────────────
  clack.log.step(`[${++currentStep}/${TOTAL_STEPS}] Checking prerequisites`);
  clack.log.info('Your agent needs a few tools installed on your machine. Let\'s make sure everything is ready.');

  const s = clack.spinner();
  s.start('Checking system requirements...');
  const prereqs = await checkPrerequisites();
  s.stop('Prerequisites checked');

  // Node.js
  if (prereqs.node.ok) {
    clack.log.success(`Node.js ${prereqs.node.version}`);
  } else if (prereqs.node.installed) {
    clack.log.error(`Node.js ${prereqs.node.version} (need >= 18)`);
    clack.cancel('Please upgrade Node.js to version 18 or higher.');
    process.exit(1);
  } else {
    clack.log.error('Node.js not found');
    clack.cancel('Please install Node.js 18+: https://nodejs.org');
    process.exit(1);
  }

  // Package manager
  if (prereqs.packageManager.installed) {
    clack.log.success(`Package manager: ${prereqs.packageManager.name}`);
  } else {
    clack.log.error('No package manager found (need pnpm or npm)');
    process.exit(1);
  }

  // Git
  if (!prereqs.git.installed) {
    clack.log.error('Git not found');
    process.exit(1);
  }
  clack.log.success('Git installed');

  // gh CLI
  if (prereqs.gh.installed) {
    if (prereqs.gh.authenticated) {
      clack.log.success('GitHub CLI authenticated');
    } else {
      clack.log.warn('GitHub CLI installed but not authenticated');
      const shouldAuth = await confirm('Run gh auth login now?');
      if (shouldAuth) {
        try {
          runGhAuth();
          clack.log.success('GitHub CLI authenticated');
        } catch {
          clack.log.error('Failed to authenticate gh CLI');
          process.exit(1);
        }
      } else {
        clack.log.error('GitHub CLI authentication required');
        process.exit(1);
      }
    }
  } else {
    clack.log.error('GitHub CLI (gh) not found');
    const installCmd = process.platform === 'darwin'
      ? 'brew install gh'
      : process.platform === 'win32'
        ? 'winget install GitHub.cli'
        : 'sudo apt install gh  (or see https://github.com/cli/cli#installation)';
    clack.log.info(`Install the GitHub CLI, then re-run setup:\n\n  ${installCmd}\n`);
    clack.cancel('Missing prerequisite: gh CLI');
    process.exit(1);
  }

  // Initialize git repo if needed
  if (!prereqs.git.initialized) {
    const initSpinner = clack.spinner();
    initSpinner.start('Initializing git repo...');
    execSync('git init', { stdio: 'ignore' });
    initSpinner.stop('Git repo initialized');
  }

  // Set git identity from GitHub if not configured
  try {
    execSync('git config user.name', { stdio: 'ignore' });
    execSync('git config user.email', { stdio: 'ignore' });
  } catch {
    try {
      const ghUser = JSON.parse(execSync('gh api user', { encoding: 'utf-8', env: ghEnv() }));
      execSync(`git config --global user.name "${ghUser.name || ghUser.login}"`, { stdio: 'ignore' });
      execSync(`git config --global user.email "${ghUser.login}@users.noreply.github.com"`, { stdio: 'ignore' });
      clack.log.success('Git identity set from GitHub');
    } catch {
      clack.log.error(
        'Could not set git identity automatically. Git requires your name and email to make commits.\n' +
        'Please run the following commands and re-run setup:\n\n' +
        '  git config --global user.name "Your Name"\n' +
        '  git config --global user.email "you@example.com"'
      );
      process.exit(1);
    }
  }

  if (prereqs.git.remoteInfo) {
    owner = prereqs.git.remoteInfo.owner;
    repo = prereqs.git.remoteInfo.repo;
    clack.log.success(`Repository: ${owner}/${repo}`);
  } else {
    clack.log.warn('No GitHub remote detected. We\'ll set one up.');

    // Stage and commit
    execSync('git add .', { stdio: 'ignore' });
    try {
      execSync('git diff --cached --quiet', { stdio: 'ignore' });
      clack.log.success('Nothing new to commit');
    } catch {
      const commitSpinner = clack.spinner();
      commitSpinner.start('Creating initial commit...');
      try {
        execSync('git commit -m "initial commit [skip ci]"', { stdio: 'ignore' });
        commitSpinner.stop('Created initial commit');
      } catch (err) {
        commitSpinner.stop('Failed to create initial commit');
        const errMsg = err.toString();
        if (errMsg.includes('Author identity unknown') || errMsg.includes('unable to auto-detect email')) {
          clack.log.error(
            'Git identity not configured. Run:\n' +
            '  git config --global user.email "you@example.com"\n' +
            '  git config --global user.name "Your Name"'
          );
          process.exit(1);
        }
        throw err;
      }
    }

    // Ask for project name
    const dirName = path.basename(process.cwd());
    const projectName = await clack.text({
      message: 'Name your project:',
      initialValue: dirName,
      validate: (input) => {
        if (!input) return 'Name is required';
      },
    });
    if (clack.isCancel(projectName)) {
      clack.cancel('Setup cancelled.');
      process.exit(0);
    }

    clack.log.info('Create a GitHub repo:');
    clack.log.info('  1. Create a new private repository');
    clack.log.info('  2. Do NOT initialize with a README');
    clack.log.info('  3. Copy the HTTPS URL');

    await openOrShowURL(
      `https://github.com/new?name=${encodeURIComponent(projectName)}&visibility=private`,
      'GitHub repo creation page'
    );

    // Ask for the remote URL and add it
    let remoteAdded = false;
    while (!remoteAdded) {
      const remoteUrl = await clack.text({
        message: 'Paste the HTTPS repository URL:',
        validate: (input) => {
          if (!input) return 'URL is required';
          if (!input.startsWith('https://github.com/')) return 'Must be an HTTPS GitHub URL (https://github.com/...)';
        },
      });
      if (clack.isCancel(remoteUrl)) {
        clack.cancel('Setup cancelled.');
        process.exit(0);
      }

      try {
        const url = remoteUrl.replace(/\/$/, '').replace(/\.git$/, '') + '.git';
        execSync(`git remote add origin "${url}"`, { stdio: 'ignore' });
        remoteAdded = true;
      } catch {
        try {
          const url = remoteUrl.replace(/\/$/, '').replace(/\.git$/, '') + '.git';
          execSync(`git remote set-url origin "${url}"`, { stdio: 'ignore' });
          remoteAdded = true;
        } catch {
          clack.log.error('Failed to set remote. Try again.');
        }
      }
    }

    const { getGitRemoteInfo } = await import('./lib/prerequisites.mjs');
    const remoteInfo = getGitRemoteInfo();
    if (remoteInfo) {
      owner = remoteInfo.owner;
      repo = remoteInfo.repo;
      clack.log.success(`Repository: ${owner}/${repo}`);
    } else {
      clack.log.error('Could not detect repository from remote.');
      process.exit(1);
    }
  }

  // Add owner/repo to collected
  collected.GH_OWNER = owner;
  collected.GH_REPO = repo;

  // Track whether we need to push after getting the PAT
  let needsPush = false;
  try {
    execSync('git rev-parse --verify origin/main', { stdio: 'ignore' });
  } catch {
    needsPush = true;
  }

  // Docker check (informational — needed for server start)
  if (prereqs.docker.installed) {
    if (prereqs.docker.running) {
      clack.log.success('Docker installed and running');
    } else {
      clack.log.warn('Docker installed but daemon is not running. You\'ll need it to start the server.');
      clack.log.info('Make sure the Docker daemon is started before then.');
    }
  } else {
    clack.log.warn('Docker not installed (needed to run the server)');
    clack.log.info('Install Docker: https://docs.docker.com/get-docker/');
  }

  // Initialize database (needed for storing secrets)
  try {
    initDatabase();
  } catch (err) {
    clack.log.warn(`Database init: ${err.message}`);
  }

  // ─── Step 2: GitHub PAT ──────────────────────────────────────────────
  clack.log.step(`[${++currentStep}/${TOTAL_STEPS}] GitHub Personal Access Token`);
  clack.log.info('Your agent needs permission to create branches and pull requests in your GitHub repo. A Personal Access Token (PAT) grants this access.');

  // Check DB first for existing GH_TOKEN, then fall back to .env
  let existingGhToken = null;
  try {
    const { getConfigSecret } = await import('../lib/db/config.js');
    existingGhToken = getConfigSecret('GH_TOKEN');
  } catch {}
  if (!existingGhToken) existingGhToken = env?.GH_TOKEN || null;

  let pat = null;
  if (await keepOrReconfigure('GitHub PAT', existingGhToken ? maskSecret(existingGhToken) : null)) {
    pat = existingGhToken;
  }

  if (!pat) {
    clack.log.info(
      `Create a fine-grained PAT scoped to ${owner}/${repo} only:\n` +
      `  Repository access: Only select repositories > ${owner}/${repo}\n` +
      '  Actions: Read and write\n' +
      '  Administration: Read and write (required for self-hosted runners)\n' +
      '  Contents: Read and write\n' +
      '  Metadata: Read-only (required, auto-selected)\n' +
      '  Pull requests: Read and write\n' +
      '  Secrets: Read and write\n' +
      '  Variables: Read and write\n' +
      '  Workflows: Read and write'
    );

    await openOrShowURL(getPATCreationURL(), 'GitHub PAT creation page');

    let patValid = false;
    while (!patValid) {
      pat = await promptForPAT();

      const validateSpinner = clack.spinner();
      validateSpinner.start('Validating PAT...');
      const validation = await validatePAT(pat);

      if (!validation.valid) {
        validateSpinner.stop(`Invalid PAT: ${validation.error}`);
        continue;
      }

      const scopes = await checkPATScopes(pat);
      if (!scopes.hasRepo || !scopes.hasWorkflow) {
        validateSpinner.stop('PAT missing required scopes');
        clack.log.info(`Found scopes: ${scopes.scopes.join(', ') || 'none'}`);
        continue;
      }

      if (scopes.isFineGrained) {
        validateSpinner.stop(`Fine-grained PAT valid for user: ${validation.user}`);
      } else {
        validateSpinner.stop(`PAT valid for user: ${validation.user}`);
      }
      patValid = true;
    }
  }

  collected.GH_TOKEN = pat;

  // Push to GitHub now that we have the PAT
  if (needsPush) {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();

    let pushed = false;
    while (!pushed) {
      const authedUrl = remote.replace('https://github.com/', `https://x-access-token:${pat}@github.com/`);
      execSync(`git remote set-url origin "${authedUrl}"`, { stdio: 'ignore' });

      const pushSpinner = clack.spinner();
      pushSpinner.start('Pushing to GitHub...');
      try {
        execSync('git branch -M main', { stdio: 'ignore' });
        execSync('git push -u origin main 2>&1', { encoding: 'utf-8' });
        pushSpinner.stop('Pushed to GitHub');
        pushed = true;
      } catch (err) {
        pushSpinner.stop('Failed to push');
        const output = (err.stdout || '') + (err.stderr || '');
        if (output) clack.log.error(output.trim());
        execSync(`git remote set-url origin "${remote}"`, { stdio: 'ignore' });
        clack.log.info('Your PAT may not have write access to this repository.');
        pat = await promptForPAT();
        collected.GH_TOKEN = pat;
        continue;
      }

      // Reset remote URL back to clean HTTPS (no token embedded)
      execSync(`git remote set-url origin "${remote}"`, { stdio: 'ignore' });
    }
  }

  // ─── Step 3: App URL ─────────────────────────────────────────────────
  clack.log.step(`[${++currentStep}/${TOTAL_STEPS}] App URL`);
  clack.log.info('Your agent runs as a web server that receives notifications from GitHub when jobs finish. It needs a public URL to receive those webhooks.');

  let appUrl = null;

  if (await keepOrReconfigure('APP_URL', env?.APP_URL || null)) {
    appUrl = env.APP_URL;
  }

  if (!appUrl) {
    clack.log.info(
      'Your app needs a public URL so GitHub can send webhook notifications.\n' +
      '  Examples:\n' +
      '    ngrok: https://abc123.ngrok.io\n' +
      '    VPS:   https://mybot.example.com\n' +
      '    PaaS:  https://mybot.vercel.app'
    );

    while (!appUrl) {
      const urlInput = await clack.text({
        message: 'Enter your APP_URL (https://...):',
        validate: (input) => {
          if (!input) return 'URL is required';
          if (!input.startsWith('https://')) return 'URL must start with https://';
        },
      });
      if (clack.isCancel(urlInput)) {
        clack.cancel('Setup cancelled.');
        process.exit(0);
      }
      appUrl = urlInput.replace(/\/$/, '');
    }
  }

  collected.APP_URL = appUrl;
  collected.APP_HOSTNAME = new URL(appUrl).hostname;

  // Generate GH_WEBHOOK_SECRET if not already in DB
  let existingWebhookSecret = null;
  try {
    const { getConfigSecret } = await import('../lib/db/config.js');
    existingWebhookSecret = getConfigSecret('GH_WEBHOOK_SECRET');
  } catch {}
  collected.GH_WEBHOOK_SECRET = existingWebhookSecret || env?.GH_WEBHOOK_SECRET || generateWebhookSecret();

  // ─── Step 4: Sync Config ─────────────────────────────────────────────
  clack.log.step(`[${++currentStep}/${TOTAL_STEPS}] Sync config`);

  if (!owner || !repo) {
    clack.log.warn('Could not detect repository. Please enter manually.');
    const ownerInput = await clack.text({ message: 'GitHub owner/org:' });
    if (clack.isCancel(ownerInput)) { clack.cancel('Setup cancelled.'); process.exit(0); }
    owner = ownerInput;
    const repoInput = await clack.text({ message: 'Repository name:' });
    if (clack.isCancel(repoInput)) { clack.cancel('Setup cancelled.'); process.exit(0); }
    repo = repoInput;
    collected.GH_OWNER = owner;
    collected.GH_REPO = repo;
  }

  const report = await syncConfig(env, collected, { owner, repo });

  if (report.secrets.length > 0) {
    clack.log.info(`GitHub secrets set: ${report.secrets.join(', ')}`);
  }
  if (report.variables.length > 0) {
    clack.log.info(`GitHub variables set: ${report.variables.join(', ')}`);
  }

  // ─── Step 5: Start Server ─────────────────────────────────────────────
  clack.log.step(`[${++currentStep}/${TOTAL_STEPS}] Start Server`);

  clack.log.info('Starting server...');
  try {
    execSync('docker compose up -d', { stdio: 'inherit' });
    clack.log.success('Server started');
  } catch (err) {
    const output = (err.stderr || err.stdout || err.message || '').toString().trim();
    clack.log.warn('Failed to start.');
    if (output) clack.log.error(output);
    clack.log.info('Fix the issue above, then run: docker compose up -d');
  }

  // ─── Done ─────────────────────────────────────────────────────────────

  let summary = '';
  summary += `Repository:   ${owner}/${repo}\n`;
  summary += `App URL:      ${appUrl}\n`;
  summary += `GitHub PAT:   ${maskSecret(pat)}`;

  clack.note(summary, 'Configuration');

  clack.log.info('Create your admin account, then configure your LLM provider, API keys, and agent settings under Admin.');

  if (canOpenBrowser()) {
    const open = (await import('open')).default;
    const shouldOpen = await confirm(`Open ${appUrl} in your browser?`, true);
    if (shouldOpen) {
      await open(appUrl);
    }
  } else {
    clack.log.info(`Visit ${appUrl} to create your admin account.`);
  }

  clack.outro('Setup complete!');
}

main().catch((error) => {
  clack.log.error(`Setup failed: ${error.message}`);
  process.exit(1);
});
