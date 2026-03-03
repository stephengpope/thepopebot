#!/usr/bin/env node

import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDirLink } from '../setup/lib/fs-utils.mjs';

/**
 * Return true when `filePath` is a plain text file whose content exactly
 * matches `expectedTarget`.  This is the artifact produced by Windows git
 * (core.symlinks=false) when it checks out a mode-120000 symlink entry: the
 * blob content (e.g. "../skills/active") is written as a regular file instead
 * of creating an OS symlink.  Detecting this lets init() replace the text file
 * with a real symlink rather than silently skipping symlink creation.
 */
function isTextFileSymlink(filePath, expectedTarget) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) return false; // directory, real symlink, etc.
    return fs.readFileSync(filePath, 'utf8').trim() === expectedTarget;
  } catch {
    return false;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const command = process.argv[2];
const args = process.argv.slice(3);

// Files tightly coupled to the package version that are auto-updated by init.
// These live in the user's project because GitHub/Docker require them at specific paths,
// but they shouldn't drift from the package version.
const MANAGED_PATHS = [
  '.github/workflows/',
  'docker/event-handler/',
  'docker-compose.yml',
  '.dockerignore',
  'CLAUDE.md',
];

function isManaged(relPath) {
  return MANAGED_PATHS.some(p => relPath === p || relPath.startsWith(p));
}

// Files that must never be scaffolded directly (use .template suffix instead).
const EXCLUDED_FILENAMES = ['CLAUDE.md'];

// Files ending in .template are scaffolded with the suffix stripped.
// e.g. .gitignore.template → .gitignore, CLAUDE.md.template → CLAUDE.md
function destPath(templateRelPath) {
  if (templateRelPath.endsWith('.template')) {
    return templateRelPath.slice(0, -'.template'.length);
  }
  return templateRelPath;
}

function templatePath(userPath, templatesDir) {
  const withSuffix = userPath + '.template';
  if (fs.existsSync(path.join(templatesDir, withSuffix))) {
    return withSuffix;
  }
  return userPath;
}

/**
 * Parse upgrade target from CLI arg into an npm install specifier.
 * Examples: undefined → "latest", "@beta" → "beta", "@rc" → "rc", "1.2.72" → "1.2.72"
 */
function parseUpgradeTarget(arg) {
  if (!arg) return 'latest';
  if (arg.startsWith('@')) return arg.slice(1); // @beta → beta, @rc → rc, @latest → latest
  return arg; // bare version like 1.2.72
}

function printUsage() {
  console.log(`
Usage: thepopebot <command>

Commands:
  init                              Scaffold a new thepopebot project
  upgrade|update [@beta|version]    Upgrade thepopebot (install, init, build, commit, push)
  setup                             Run interactive setup wizard
  setup-telegram                    Reconfigure Telegram webhook
  reset-auth                        Regenerate AUTH_SECRET (invalidates all sessions)
  reset [file]                      Restore a template file (or list available templates)
  diff [file]                       Show differences between project files and package templates
  set-agent-secret <KEY> [VALUE]    Set a GitHub secret with AGENT_ prefix (also updates .env)
  set-agent-llm-secret <KEY> [VALUE]  Set a GitHub secret with AGENT_LLM_ prefix
  set-var <KEY> [VALUE]             Set a GitHub repository variable
`);
}

/**
 * Collect all template files as relative paths.
 */
function getTemplateFiles(templatesDir) {
  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (!EXCLUDED_FILENAMES.includes(entry.name)) {
        files.push(path.relative(templatesDir, fullPath));
      }
    }
  }
  walk(templatesDir);
  return files;
}

async function init() {
  let cwd = process.cwd();
  const packageDir = path.join(__dirname, '..');
  const templatesDir = path.join(packageDir, 'templates');
  const noManaged = args.includes('--no-managed');

  // Guard: warn if the directory is not empty (unless it's an existing thepopebot project)
  const entries = fs.readdirSync(cwd);
  if (entries.length > 0) {
    const pkgPath = path.join(cwd, 'package.json');
    let isExistingProject = false;
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = pkg.dependencies || {};
        const devDeps = pkg.devDependencies || {};
        if (deps.thepopebot || devDeps.thepopebot) {
          isExistingProject = true;
        }
      } catch {}
    }

    if (!isExistingProject) {
      console.log('\nThis directory is not empty.');
      const { text, isCancel } = await import('@clack/prompts');
      const dirName = await text({
        message: 'Project directory name:',
        defaultValue: 'my-popebot',
      });
      if (isCancel(dirName)) {
        console.log('\nCancelled.\n');
        process.exit(0);
      }
      const newDir = path.resolve(cwd, dirName);
      fs.mkdirSync(newDir, { recursive: true });
      process.chdir(newDir);
      cwd = newDir;
      console.log(`\nCreated ${dirName}/`);
    }
  }

  console.log('\nScaffolding thepopebot project...\n');

  const templateFiles = getTemplateFiles(templatesDir);
  const created = [];
  const skipped = [];
  const changed = [];
  const updated = [];

  for (const relPath of templateFiles) {
    const src = path.join(templatesDir, relPath);
    const outPath = destPath(relPath);
    const dest = path.join(cwd, outPath);

    if (!fs.existsSync(dest)) {
      // File doesn't exist — create it
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      created.push(outPath);
      console.log(`  Created ${outPath}`);
    } else {
      // File exists — check if template has changed
      const srcContent = fs.readFileSync(src);
      const destContent = fs.readFileSync(dest);
      if (srcContent.equals(destContent)) {
        skipped.push(outPath);
      } else if (!noManaged && isManaged(outPath)) {
        // Managed file differs — auto-update to match package
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        updated.push(outPath);
        console.log(`  Updated ${outPath}`);
      } else {
        changed.push(outPath);
        console.log(`  Skipped ${outPath} (already exists)`);
      }
    }
  }

  // Create package.json if it doesn't exist
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    const dirName = path.basename(cwd);
    const { version } = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    const thepopebotDep = version.includes('-') ? version : '^1.0.0';
    const pkg = {
      name: dirName,
      private: true,
      scripts: {
        dev: 'next dev --turbopack',
        build: 'next build',
        start: 'next start',
        setup: 'thepopebot setup',
        'setup-telegram': 'thepopebot setup-telegram',
        'reset-auth': 'thepopebot reset-auth',
      },
      dependencies: {
        thepopebot: thepopebotDep,
        next: '^15.5.12',
        'next-auth': '5.0.0-beta.30',
        'next-themes': '^0.4.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        tailwindcss: '^4.0.0',
        '@tailwindcss/postcss': '^4.0.0',
      },
    };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('  Created package.json');
  } else {
    console.log('  Skipped package.json (already exists)');
  }

  // Create .gitkeep files for empty dirs
  const gitkeepDirs = ['cron', 'triggers', 'logs', 'tmp', 'data'];
  for (const dir of gitkeepDirs) {
    const gitkeep = path.join(cwd, dir, '.gitkeep');
    if (!fs.existsSync(gitkeep)) {
      fs.mkdirSync(path.join(cwd, dir), { recursive: true });
      fs.writeFileSync(gitkeep, '');
    }
  }

  // Create default skill activation symlinks.
  // On Windows (git core.symlinks=false) the template symlinks land as plain
  // text files whose content is the symlink target.  fs.existsSync() returns
  // true for those files, which previously caused the symlink creation to be
  // skipped silently — leaving the project without working symlinks and causing
  // the Docker agent to crash at runtime.  isTextFileSymlink() detects this
  // artifact and removes the text file so a real symlink can be created.
  const defaultSkills = ['browser-tools', 'llm-secrets', 'modify-self'];
  const activeDir = path.join(cwd, 'skills', 'active');
  fs.mkdirSync(activeDir, { recursive: true });
  for (const skill of defaultSkills) {
    const symlink = path.join(activeDir, skill);
    const target = `../${skill}`;
    if (isTextFileSymlink(symlink, target)) {
      fs.unlinkSync(symlink);
      console.log(`  Removed text-file artifact: skills/active/${skill}`);
    }
    if (!fs.existsSync(symlink)) {
      createDirLink(target, symlink);
      console.log(`  Created skills/active/${skill} → ${target}`);
    }
  }

  // Create .pi/skills → ../skills/active symlink
  const piSkillsLink = path.join(cwd, '.pi', 'skills');
  if (isTextFileSymlink(piSkillsLink, '../skills/active')) {
    fs.unlinkSync(piSkillsLink);
    console.log('  Removed text-file artifact: .pi/skills');
  }
  if (!fs.existsSync(piSkillsLink)) {
    fs.mkdirSync(path.dirname(piSkillsLink), { recursive: true });
    createDirLink('../skills/active', piSkillsLink);
    console.log('  Created .pi/skills → ../skills/active');
  }

  // Create .claude/skills → ../skills/active symlink
  const claudeSkillsLink = path.join(cwd, '.claude', 'skills');
  if (isTextFileSymlink(claudeSkillsLink, '../skills/active')) {
    fs.unlinkSync(claudeSkillsLink);
    console.log('  Removed text-file artifact: .claude/skills');
  }
  if (!fs.existsSync(claudeSkillsLink)) {
    fs.mkdirSync(path.dirname(claudeSkillsLink), { recursive: true });
    createDirLink('../skills/active', claudeSkillsLink);
    console.log('  Created .claude/skills → ../skills/active');
  }

  // Report updated managed files
  if (updated.length > 0) {
    console.log('\n  Updated managed files:');
    for (const file of updated) {
      console.log(`    ${file}`);
    }
  }

  // Report changed templates
  if (changed.length > 0) {
    console.log('\n  Updated templates available:');
    console.log('  These files differ from the current package templates.');
    console.log('  This may be from your edits, or from a thepopebot update.\n');
    for (const file of changed) {
      console.log(`    ${file}`);
    }
    console.log('\n  To view differences:  npx thepopebot diff <file>');
    console.log('  To reset to default:  npx thepopebot reset <file>');
  }

  // Run npm install
  console.log('\nInstalling dependencies...\n');
  execSync('npm install', { stdio: 'inherit', cwd });

  // Create or update .env with auto-generated infrastructure values
  const envPath = path.join(cwd, '.env');
  const { randomBytes } = await import('crypto');
  const thepopebotPkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  const version = thepopebotPkg.version;

  if (!fs.existsSync(envPath)) {
    // Seed .env for new projects
    const authSecret = randomBytes(32).toString('base64');
    const seedEnv = `# thepopebot Configuration
# Run "npm run setup" to complete configuration

AUTH_SECRET=${authSecret}
AUTH_TRUST_HOST=true
THEPOPEBOT_VERSION=${version}
`;
    fs.writeFileSync(envPath, seedEnv);
    console.log(`  Created .env (AUTH_SECRET, THEPOPEBOT_VERSION=${version})`);
  } else {
    // Update THEPOPEBOT_VERSION in existing .env
    try {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.match(/^THEPOPEBOT_VERSION=.*/m)) {
        envContent = envContent.replace(/^THEPOPEBOT_VERSION=.*/m, `THEPOPEBOT_VERSION=${version}`);
      } else {
        envContent = envContent.trimEnd() + `\nTHEPOPEBOT_VERSION=${version}\n`;
      }
      fs.writeFileSync(envPath, envContent);
      console.log(`  Updated THEPOPEBOT_VERSION to ${version}`);
    } catch {}
  }

  console.log('\nDone! Run: npm run setup\n');
}

/**
 * List all available template files, or restore a specific one.
 */
function reset(filePath) {
  const packageDir = path.join(__dirname, '..');
  const templatesDir = path.join(packageDir, 'templates');
  const cwd = process.cwd();

  if (!filePath) {
    console.log('\nAvailable template files:\n');
    const files = getTemplateFiles(templatesDir);
    for (const file of files) {
      console.log(`  ${destPath(file)}`);
    }
    console.log('\nUsage: thepopebot reset <file>');
    console.log('Example: thepopebot reset config/SOUL.md\n');
    return;
  }

  const tmplPath = templatePath(filePath, templatesDir);
  const src = path.join(templatesDir, tmplPath);
  const dest = path.join(cwd, filePath);

  if (!fs.existsSync(src)) {
    console.error(`\nTemplate not found: ${filePath}`);
    console.log('Run "thepopebot reset" to see available templates.\n');
    process.exit(1);
  }

  if (fs.statSync(src).isDirectory()) {
    console.log(`\nRestoring ${filePath}/...\n`);
    copyDirSyncForce(src, dest, tmplPath);
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`\nRestored ${filePath}\n`);
  }
}

/**
 * Show the diff between a user's file and the package template.
 */
function diff(filePath) {
  const packageDir = path.join(__dirname, '..');
  const templatesDir = path.join(packageDir, 'templates');
  const cwd = process.cwd();

  if (!filePath) {
    // Show all files that differ
    console.log('\nFiles that differ from package templates:\n');
    const files = getTemplateFiles(templatesDir);
    let anyDiff = false;
    for (const file of files) {
      const src = path.join(templatesDir, file);
      const outPath = destPath(file);
      const dest = path.join(cwd, outPath);
      if (fs.existsSync(dest)) {
        const srcContent = fs.readFileSync(src);
        const destContent = fs.readFileSync(dest);
        if (!srcContent.equals(destContent)) {
          console.log(`  ${outPath}`);
          anyDiff = true;
        }
      } else {
        console.log(`  ${outPath} (missing)`);
        anyDiff = true;
      }
    }
    if (!anyDiff) {
      console.log('  All files match package templates.');
    }
    console.log('\nUsage: thepopebot diff <file>');
    console.log('Example: thepopebot diff config/SOUL.md\n');
    return;
  }

  const tmplPath = templatePath(filePath, templatesDir);
  const src = path.join(templatesDir, tmplPath);
  const dest = path.join(cwd, filePath);

  if (!fs.existsSync(src)) {
    console.error(`\nTemplate not found: ${filePath}`);
    process.exit(1);
  }

  if (!fs.existsSync(dest)) {
    console.log(`\n${filePath} does not exist in your project.`);
    console.log(`Run "thepopebot reset ${filePath}" to create it.\n`);
    return;
  }

  try {
    // Use git diff for nice colored output, fall back to plain diff
    execSync(`git diff --no-index -- "${dest}" "${src}"`, { stdio: 'inherit' });
    console.log('\nFiles are identical.\n');
  } catch (e) {
    // git diff exits with 1 when files differ (output already printed)
    console.log(`\n  To reset: thepopebot reset ${filePath}\n`);
  }
}

function copyDirSyncForce(src, dest, templateRelBase = '') {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_FILENAMES.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const templateRel = templateRelBase
      ? path.join(templateRelBase, entry.name)
      : entry.name;
    const outName = path.basename(destPath(templateRel));
    const destFile = path.join(dest, outName);
    if (entry.isDirectory()) {
      copyDirSyncForce(srcPath, destFile, templateRel);
    } else {
      fs.copyFileSync(srcPath, destFile);
      console.log(`  Restored ${path.relative(process.cwd(), destFile)}`);
    }
  }
}

function setup() {
  const setupScript = path.join(__dirname, '..', 'setup', 'setup.mjs');
  try {
    execFileSync(process.execPath, [setupScript], { stdio: 'inherit', cwd: process.cwd() });
  } catch {
    process.exit(1);
  }
}

function setupTelegram() {
  const setupScript = path.join(__dirname, '..', 'setup', 'setup-telegram.mjs');
  try {
    execFileSync(process.execPath, [setupScript], { stdio: 'inherit', cwd: process.cwd() });
  } catch {
    process.exit(1);
  }
}

async function resetAuth() {
  const { randomBytes } = await import('crypto');
  const { updateEnvVariable } = await import(path.join(__dirname, '..', 'setup', 'lib', 'auth.mjs'));

  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('\n  No .env file found. Run "npm run setup" first.\n');
    process.exit(1);
  }

  const newSecret = randomBytes(32).toString('base64');
  updateEnvVariable('AUTH_SECRET', newSecret);
  console.log('\n  AUTH_SECRET regenerated.');
  console.log('  All existing sessions have been invalidated.');
  console.log('  Restart your server for the change to take effect.\n');
}

async function upgrade() {
  const cwd = process.cwd();
  const tag = parseUpgradeTarget(args[0]);
  const { confirm, isCancel } = await import('@clack/prompts');

  // --- Pre-flight: verify this is a thepopebot project ---
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('\n  Not a thepopebot project (no package.json found).\n');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.thepopebot) {
    console.error('\n  Not a thepopebot project (thepopebot not in dependencies).\n');
    process.exit(1);
  }

  // Get current installed version
  let currentVersion;
  try {
    const installedPkg = path.join(cwd, 'node_modules', 'thepopebot', 'package.json');
    currentVersion = JSON.parse(fs.readFileSync(installedPkg, 'utf8')).version;
  } catch {
    currentVersion = 'unknown';
  }

  // Resolve target version
  let targetVersion;
  try {
    targetVersion = execSync(`npm view thepopebot@${tag} version`, { encoding: 'utf8' }).trim();
  } catch {
    console.error(`\n  Could not resolve thepopebot@${tag}. Check the version/tag and try again.\n`);
    process.exit(1);
  }

  console.log(`\n  thepopebot ${currentVersion} → ${targetVersion}`);

  if (currentVersion === targetVersion) {
    console.log('  Already up to date. Nothing to do.\n');
    return;
  }

  // --- Save any local changes ---
  const status = execSync('git status --porcelain', { encoding: 'utf8', cwd }).trim();
  if (status) {
    console.log('\n  You have local changes. Saving them before upgrading...\n');
    try {
      execSync('git add -A && git commit -m "save local changes before thepopebot upgrade"', { stdio: 'inherit', cwd });
    } catch {
      console.error('\n  Could not save your local changes. Please try again.\n');
      return;
    }
  }

  // --- Pull remote changes ---
  console.log('\n  Syncing with remote...\n');
  try {
    execSync('git pull --rebase', { stdio: 'inherit', cwd });
  } catch {
    console.error('\n  Your local changes conflict with changes on GitHub.');
    console.error('  This means someone (or your bot) changed the same files you did.\n');
    console.error('  To fix this:');
    console.error('    1. Open the files listed above and look for <<<<<<< markers');
    console.error('    2. Edit each file to keep the version you want');
    console.error('    3. Run: git add -A && git rebase --continue');
    console.error('    4. Then run the upgrade again\n');
    return;
  }

  // --- Install ---
  console.log(`\n  Installing thepopebot@${targetVersion}...\n`);
  try {
    execSync(`npm install thepopebot@${targetVersion}`, { stdio: 'inherit', cwd });
  } catch {
    console.error('\n  Install failed. Check your internet connection and try again.\n');
    process.exit(1);
  }

  // --- Init (spawn new process to use the NEW version's templates) ---
  console.log('\n  Updating project files...\n');
  try {
    execSync('npx thepopebot init', { stdio: 'inherit', cwd });
  } catch {
    console.error('\n  Failed to update project files. Try running "npx thepopebot init" manually.\n');
    process.exit(1);
  }

  // --- Clear .next ---
  try {
    fs.rmSync(path.join(cwd, '.next'), { recursive: true, force: true });
  } catch {}

  // --- Build ---
  console.log('\n  Building...\n');
  try {
    execSync('npm run build', { stdio: 'inherit', cwd });
  } catch {
    console.error('\n  Build failed. The upgrade has been applied but the project does not build.');
    console.error('  Fix the build errors, then run:\n');
    console.error(`    npm run build`);
    console.error(`    git add -A && git commit -m "upgrade thepopebot to ${targetVersion}"`);
    console.error('    git push\n');
    process.exit(1);
  }

  // --- Commit upgrade ---
  const changes = execSync('git status --porcelain', { encoding: 'utf8', cwd }).trim();
  if (changes) {
    try {
      execSync('git add -A', { cwd });
      execSync(`git commit -m "upgrade thepopebot to ${targetVersion}"`, { stdio: 'inherit', cwd });
    } catch {
      console.error('\n  Failed to commit upgrade. Try running manually:');
      console.error(`    git add -A && git commit -m "upgrade thepopebot to ${targetVersion}"\n`);
      process.exit(1);
    }
  }

  // --- Push ---
  console.log('\n  Pushing to GitHub...\n');
  try {
    execSync('git push', { stdio: 'inherit', cwd });
  } catch {
    console.error('\n  Could not push to GitHub. Try running "git push" manually.\n');
    process.exit(1);
  }

  // --- Docker restart (only if compose file exists, docker available, and containers running) ---
  const composeFile = path.join(cwd, 'docker-compose.yml');
  if (fs.existsSync(composeFile)) {
    try {
      const running = execSync('docker compose ps --status running -q', { encoding: 'utf8', cwd }).trim();
      if (running) {
        console.log('  Restarting Docker containers...\n');
        execSync('docker compose down && docker compose up -d', { stdio: 'inherit', cwd });
      }
    } catch {
      // Docker not available or not running — skip
    }
  }

  // --- Summary ---
  console.log(`\n  Upgraded thepopebot ${currentVersion} → ${targetVersion}`);
  console.log('  Done!\n');
}

/**
 * Load GH_OWNER and GH_REPO from .env
 */
function loadRepoInfo() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('\n  No .env file found. Run "npm run setup" first.\n');
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
  }
  if (!env.GH_OWNER || !env.GH_REPO) {
    console.error('\n  GH_OWNER and GH_REPO not found in .env. Run "npm run setup" first.\n');
    process.exit(1);
  }
  return { owner: env.GH_OWNER, repo: env.GH_REPO };
}

/**
 * Read all data from a piped stdin stream.
 * Returns null if stdin is a TTY (interactive terminal).
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve(null);
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trimEnd() || null));
    process.stdin.on('error', reject);
  });
}

/**
 * Prompt for a secret value interactively if not provided as an argument.
 * Supports piped stdin (e.g. echo "val" | thepopebot set-var KEY).
 */
async function promptForValue(key) {
  const stdin = await readStdin();
  if (stdin) return stdin;

  if (!process.stdin.isTTY) {
    console.error(`\n  No value provided for ${key}. Pipe a value or pass it as an argument.\n`);
    process.exit(1);
  }

  const { password, isCancel } = await import('@clack/prompts');
  const value = await password({
    message: `Enter value for ${key}:`,
    validate: (input) => {
      if (!input) return 'Value is required';
    },
  });
  if (isCancel(value)) {
    console.log('\nCancelled.\n');
    process.exit(0);
  }
  return value;
}

async function setAgentSecret(key, value) {
  if (!key) {
    console.error('\n  Usage: thepopebot set-agent-secret <KEY> [VALUE]\n');
    console.error('  Example: thepopebot set-agent-secret ANTHROPIC_API_KEY\n');
    process.exit(1);
  }

  if (!value) value = await promptForValue(key);

  const { owner, repo } = loadRepoInfo();
  const prefixedName = `AGENT_${key}`;

  const { setSecret } = await import(path.join(__dirname, '..', 'setup', 'lib', 'github.mjs'));
  const { updateEnvVariable } = await import(path.join(__dirname, '..', 'setup', 'lib', 'auth.mjs'));

  const result = await setSecret(owner, repo, prefixedName, value);
  if (result.success) {
    console.log(`\n  Set GitHub secret: ${prefixedName}`);
    updateEnvVariable(key, value);
    console.log(`  Updated .env: ${key}`);
    console.log('');
  } else {
    console.error(`\n  Failed to set ${prefixedName}: ${result.error}\n`);
    process.exit(1);
  }
}

async function setAgentLlmSecret(key, value) {
  if (!key) {
    console.error('\n  Usage: thepopebot set-agent-llm-secret <KEY> [VALUE]\n');
    console.error('  Example: thepopebot set-agent-llm-secret BRAVE_API_KEY\n');
    process.exit(1);
  }

  if (!value) value = await promptForValue(key);

  const { owner, repo } = loadRepoInfo();
  const prefixedName = `AGENT_LLM_${key}`;

  const { setSecret } = await import(path.join(__dirname, '..', 'setup', 'lib', 'github.mjs'));

  const result = await setSecret(owner, repo, prefixedName, value);
  if (result.success) {
    console.log(`\n  Set GitHub secret: ${prefixedName}\n`);
  } else {
    console.error(`\n  Failed to set ${prefixedName}: ${result.error}\n`);
    process.exit(1);
  }
}

async function setVar(key, value) {
  if (!key) {
    console.error('\n  Usage: thepopebot set-var <KEY> [VALUE]\n');
    console.error('  Example: thepopebot set-var LLM_MODEL claude-sonnet-4-5-20250929\n');
    process.exit(1);
  }

  if (!value) value = await promptForValue(key);

  const { owner, repo } = loadRepoInfo();

  const { setVariable } = await import(path.join(__dirname, '..', 'setup', 'lib', 'github.mjs'));

  const result = await setVariable(owner, repo, key, value);
  if (result.success) {
    console.log(`\n  Set GitHub variable: ${key}\n`);
  } else {
    console.error(`\n  Failed to set ${key}: ${result.error}\n`);
    process.exit(1);
  }
}

switch (command) {
  case 'init':
    await init();
    break;
  case 'setup':
    setup();
    break;
  case 'setup-telegram':
    setupTelegram();
    break;
  case 'reset-auth':
    await resetAuth();
    break;
  case 'reset':
    reset(args[0]);
    break;
  case 'diff':
    diff(args[0]);
    break;
  case 'upgrade':
  case 'update':
    await upgrade();
    break;
  case 'set-agent-secret':
    await setAgentSecret(args[0], args[1]);
    break;
  case 'set-agent-llm-secret':
    await setAgentLlmSecret(args[0], args[1]);
    break;
  case 'set-var':
    await setVar(args[0], args[1]);
    break;
  default:
    printUsage();
    process.exit(command ? 1 : 0);
}
