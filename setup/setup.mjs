#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import inquirer from 'inquirer';

import {
  checkPrerequisites,
  runGhAuth,
} from './lib/prerequisites.mjs';
import {
  promptForPAT,
  promptForAnthropicKey,
  promptForOpenAIKey,
  promptForGroqKey,
  promptForBraveKey,
  promptForTelegramToken,
  generateTelegramWebhookSecret,
  confirm,
  maskSecret,
} from './lib/prompts.mjs';
import {
  validatePAT,
  checkPATScopes,
  setSecrets,
  setVariables,
  generateWebhookSecret,
  getPATCreationURL,
} from './lib/github.mjs';
import {
  validateAnthropicKey,
  writeEnvFile,
  encodeSecretsBase64,
  encodeLlmSecretsBase64,
  updateEnvVariable,
} from './lib/auth.mjs';
import { setTelegramWebhook, validateBotToken, generateVerificationCode } from './lib/telegram.mjs';
import { runVerificationFlow, verifyRestart } from './lib/telegram-verify.mjs';

const logo = `
 _____ _          ____                  ____        _
|_   _| |__   ___|  _ \\ ___  _ __   ___| __ )  ___ | |_
  | | | '_ \\ / _ \\ |_) / _ \\| '_ \\ / _ \\  _ \\ / _ \\| __|
  | | | | | |  __/  __/ (_) | |_) |  __/ |_) | (_) | |_
  |_| |_| |_|\\___|_|   \\___/| .__/ \\___|____/ \\___/ \\__|
                            |_|
`;

function printHeader() {
  console.log(chalk.cyan(logo));
  console.log(chalk.bold('Interactive Setup Wizard\n'));
}

function printStep(step, total, title) {
  console.log(chalk.bold.blue(`\n[${step}/${total}] ${title}\n`));
}

function printSuccess(message) {
  console.log(chalk.green('  ✓ ') + message);
}

function printWarning(message) {
  console.log(chalk.yellow('  ⚠ ') + message);
}

function printError(message) {
  console.log(chalk.red('  ✗ ') + message);
}

function printInfo(message) {
  console.log(chalk.dim('  → ') + message);
}

async function main() {
  printHeader();

  const TOTAL_STEPS = 7;
  let currentStep = 0;

  // Collected values
  let pat = null;
  let anthropicKey = null;
  let openaiKey = null;
  let groqKey = null;
  let braveKey = null;
  let telegramToken = null;
  let telegramWebhookSecret = null;
  let webhookSecret = null;
  let owner = null;
  let repo = null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 1: Prerequisites Check
  // ─────────────────────────────────────────────────────────────────────────────
  printStep(++currentStep, TOTAL_STEPS, 'Checking prerequisites');

  const spinner = ora('Checking system requirements...').start();
  const prereqs = await checkPrerequisites();
  spinner.stop();

  // Node.js
  if (prereqs.node.ok) {
    printSuccess(`Node.js ${prereqs.node.version}`);
  } else if (prereqs.node.installed) {
    printError(`Node.js ${prereqs.node.version} (need >= 18)`);
    console.log(chalk.red('\n  Please upgrade Node.js to version 18 or higher.'));
    process.exit(1);
  } else {
    printError('Node.js not found');
    console.log(chalk.red('\n  Please install Node.js 18+: https://nodejs.org'));
    process.exit(1);
  }

  // Package manager
  if (prereqs.packageManager.installed) {
    printSuccess(`Package manager: ${prereqs.packageManager.name}`);
  } else {
    printError('No package manager found (need pnpm or npm)');
    process.exit(1);
  }

  // Git
  if (prereqs.git.installed) {
    printSuccess('Git installed');
    if (prereqs.git.remoteInfo) {
      owner = prereqs.git.remoteInfo.owner;
      repo = prereqs.git.remoteInfo.repo;
      printSuccess(`Repository: ${owner}/${repo}`);
    } else {
      printWarning('Could not detect GitHub repository from git remote');
    }
  } else {
    printError('Git not found');
    process.exit(1);
  }

  // gh CLI
  if (prereqs.gh.installed) {
    if (prereqs.gh.authenticated) {
      printSuccess('GitHub CLI authenticated');
    } else {
      printWarning('GitHub CLI installed but not authenticated');
      const shouldAuth = await confirm('Run gh auth login now?');
      if (shouldAuth) {
        try {
          runGhAuth();
          printSuccess('GitHub CLI authenticated');
        } catch {
          printError('Failed to authenticate gh CLI');
          process.exit(1);
        }
      } else {
        printError('GitHub CLI authentication required');
        process.exit(1);
      }
    }
  } else {
    printError('GitHub CLI (gh) not found');
    printInfo('Install with: brew install gh');
    const shouldInstall = await confirm('Try to install gh with homebrew?');
    if (shouldInstall) {
      const installSpinner = ora('Installing gh CLI...').start();
      try {
        const { execSync } = await import('child_process');
        execSync('brew install gh', { stdio: 'inherit' });
        installSpinner.succeed('gh CLI installed');
        runGhAuth();
      } catch {
        installSpinner.fail('Failed to install gh CLI');
        process.exit(1);
      }
    } else {
      process.exit(1);
    }
  }

  // ngrok check (informational only)
  if (prereqs.ngrok.installed) {
    printSuccess('ngrok installed');
  } else {
    printWarning('ngrok not installed (needed to expose local server)');
    printInfo('Install with: brew install ngrok/ngrok/ngrok');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 2: GitHub PAT
  // ─────────────────────────────────────────────────────────────────────────────
  printStep(++currentStep, TOTAL_STEPS, 'GitHub Personal Access Token');

  console.log(chalk.dim('  Create a fine-grained PAT with these repository permissions:\n'));
  console.log(chalk.dim('    • Actions: Read-only'));
  console.log(chalk.dim('    • Contents: Read and write'));
  console.log(chalk.dim('    • Metadata: Read-only (required, auto-selected)'));
  console.log(chalk.dim('    • Pull requests: Read and write\n'));

  const openPATPage = await confirm('Open GitHub PAT creation page in browser?');
  if (openPATPage) {
    await open(getPATCreationURL());
    printInfo('Opened in browser. Select the permissions listed above.');
  }

  let patValid = false;
  while (!patValid) {
    pat = await promptForPAT();

    const validateSpinner = ora('Validating PAT...').start();
    const validation = await validatePAT(pat);

    if (!validation.valid) {
      validateSpinner.fail(`Invalid PAT: ${validation.error}`);
      continue;
    }

    const scopes = await checkPATScopes(pat);
    if (!scopes.hasRepo || !scopes.hasWorkflow) {
      validateSpinner.fail('PAT missing required scopes');
      printInfo(`Found scopes: ${scopes.scopes.join(', ') || 'none'}`);
      continue;
    }

    if (scopes.isFineGrained) {
      validateSpinner.succeed(`Fine-grained PAT valid for user: ${validation.user}`);
    } else {
      validateSpinner.succeed(`PAT valid for user: ${validation.user}`);
    }
    patValid = true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 3: API Keys
  // ─────────────────────────────────────────────────────────────────────────────
  printStep(++currentStep, TOTAL_STEPS, 'API Keys');

  const llmProvider = (process.env.PROVIDER || process.env.LLM_PROVIDER || 'anthropic').toLowerCase();

  if (llmProvider === 'ollama') {
    console.log(chalk.dim('  Provider = ollama. Skipping Anthropic API key.\n'));
    anthropicKey = '';
  } else {
    console.log(chalk.dim('  Anthropic API key is required. Others are optional.\n'));

    // Anthropic (required)
    const openAnthropicPage = await confirm('Open Anthropic API key page in browser?');
    if (openAnthropicPage) {
      await open('https://platform.claude.com/settings/keys');
      printInfo('Opened in browser. Create an API key and copy it.');
    }

    let anthropicValid = false;
    while (!anthropicValid) {
      anthropicKey = await promptForAnthropicKey();

      const validateSpinner = ora('Validating Anthropic API key...').start();
      const validation = await validateAnthropicKey(anthropicKey);

      if (validation.valid) {
        validateSpinner.succeed('Anthropic API key valid');
        anthropicValid = true;
      } else {
        validateSpinner.fail(`Invalid key: ${validation.error}`);
      }
    }
  }

  // OpenAI (optional)
  openaiKey = await promptForOpenAIKey();
  if (openaiKey) {
    printSuccess(`OpenAI key added (${maskSecret(openaiKey)})`);
  }

  // Groq (optional)
  groqKey = await promptForGroqKey();
  if (groqKey) {
    printSuccess(`Groq key added (${maskSecret(groqKey)})`);
  }

  // Brave Search (optional, default: true since it's free)
  braveKey = await promptForBraveKey();
  if (braveKey) {
    printSuccess(`Brave Search key added (${maskSecret(braveKey)})`);
  }

  const keys = {
    anthropic: anthropicKey,
    openai: openaiKey,
    groq: groqKey,
    brave: braveKey,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 4: Set GitHub Secrets
  // ─────────────────────────────────────────────────────────────────────────────
  printStep(++currentStep, TOTAL_STEPS, 'Set GitHub Secrets');

  if (!owner || !repo) {
    printWarning('Could not detect repository. Please enter manually.');
    const answers = await inquirer.prompt([
      { type: 'input', name: 'owner', message: 'GitHub owner/org:' },
      { type: 'input', name: 'repo', message: 'Repository name:' },
    ]);
    owner = answers.owner;
    repo = answers.repo;
  }

  webhookSecret = generateWebhookSecret();
  const secretsBase64 = encodeSecretsBase64(pat, keys);
  const llmSecretsBase64 = encodeLlmSecretsBase64(keys);

  const secrets = {
    SECRETS: secretsBase64,
    GH_WEBHOOK_SECRET: webhookSecret,
  };

  if (llmSecretsBase64) {
    secrets.LLM_SECRETS = llmSecretsBase64;
  }

  const secretSpinner = ora('Setting GitHub secrets...').start();
  const secretResults = await setSecrets(owner, repo, secrets);

  secretSpinner.stop();
  let allSecretsSet = true;
  for (const [name, result] of Object.entries(secretResults)) {
    if (result.success) {
      printSuccess(`Set ${name}`);
    } else {
      printError(`Failed to set ${name}: ${result.error}`);
      allSecretsSet = false;
    }
  }

  if (!allSecretsSet) {
    printWarning('Some secrets failed - you may need to set them manually');
  }

  // Set default GitHub repository variables
  const varsSpinner = ora('Setting GitHub repository variables...').start();
  const defaultVars = {
    AUTO_MERGE: 'true',
    ALLOWED_PATHS: '/logs',
    MODEL: 'claude-sonnet-4-5-20250929',
  };
  const varResults = await setVariables(owner, repo, defaultVars);
  varsSpinner.stop();
  for (const [name, result] of Object.entries(varResults)) {
    if (result.success) {
      printSuccess(`Set ${name} = ${defaultVars[name]}`);
    } else {
      printError(`Failed to set ${name}: ${result.error}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 5: Telegram Setup
  // ─────────────────────────────────────────────────────────────────────────────
  printStep(++currentStep, TOTAL_STEPS, 'Telegram Setup');

  telegramToken = await promptForTelegramToken();

  if (telegramToken) {
    const validateSpinner = ora('Validating bot token...').start();
    const validation = await validateBotToken(telegramToken);

    if (!validation.valid) {
      validateSpinner.fail(`Invalid token: ${validation.error}`);
      telegramToken = null;
    } else {
      validateSpinner.succeed(`Bot: @${validation.botInfo.username}`);
      telegramWebhookSecret = await generateTelegramWebhookSecret();
    }
  } else {
    printInfo('Skipped Telegram setup');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Write .env file for event_handler
  // ─────────────────────────────────────────────────────────────────────────────
  const apiKey = generateWebhookSecret().slice(0, 32); // Random API key for webhook endpoint
  const telegramVerification = telegramToken ? generateVerificationCode() : null;
  const envPath = writeEnvFile({
    apiKey,
    githubToken: pat,
    githubOwner: owner,
    githubRepo: repo,
    telegramBotToken: telegramToken,
    telegramWebhookSecret,
    ghWebhookSecret: webhookSecret,
    anthropicApiKey: anthropicKey,
    openaiApiKey: openaiKey,
    telegramChatId: null,
    telegramVerification,
  });
  printSuccess(`Created ${envPath}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 6: Start Server & ngrok
  // ─────────────────────────────────────────────────────────────────────────────
  printStep(++currentStep, TOTAL_STEPS, 'Start Server & ngrok');

  console.log(chalk.bold('  Now we need to start the server and expose it via ngrok.\n'));
  console.log(chalk.yellow('  Open TWO new terminal windows and run:\n'));
  console.log(chalk.bold('  Terminal 1:'));
  console.log(chalk.cyan('     cd event_handler && npm install && npm run dev\n'));
  console.log(chalk.bold('  Terminal 2:'));
  console.log(chalk.cyan('     ngrok http 3000\n'));

  console.log(chalk.dim('  ngrok will show a "Forwarding" URL like: https://abc123.ngrok.io\n'));
  console.log(chalk.yellow('  Note: ') + chalk.dim('ngrok URLs change each time you restart it (unless you have a paid plan).'));
  console.log(chalk.dim('  When your URL changes, run: ') + chalk.cyan('npm run setup-telegram') + chalk.dim(' to reconfigure.\n'));

  let ngrokUrl = null;
  while (!ngrokUrl) {
    const { url } = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Paste your ngrok URL (https://...ngrok...):',
        validate: (input) => {
          if (!input) return 'URL is required';
          if (!input.startsWith('https://')) return 'URL must start with https://';
          if (!input.includes('ngrok')) return 'URL should be an ngrok URL';
          return true;
        },
      },
    ]);
    const testUrl = url.replace(/\/$/, '');

    // Verify the server is reachable through ngrok
    const healthSpinner = ora('Verifying server is reachable...').start();
    try {
      const response = await fetch(`${testUrl}/ping`, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(10000)
      });
      if (response.ok) {
        const data = await response.json();
        if (data.message === 'Pong!') {
          healthSpinner.succeed('Server is reachable and authenticated');
          ngrokUrl = testUrl;
        } else {
          healthSpinner.fail('Unexpected response from server');
          const retry = await confirm('Try again?');
          if (!retry) {
            ngrokUrl = testUrl;
          }
        }
      } else if (response.status === 401) {
        healthSpinner.fail('Server is running but returned 401 (unauthorized)');
        console.log('');
        printWarning('This means the server is using an old API key that doesn\'t match the one we just generated.');
        printInfo('The setup created a new .env file with a fresh API key, but your running server hasn\'t picked it up yet.');
        console.log('');
        console.log(chalk.bold('  To fix this, restart your server:\n'));
        console.log(chalk.cyan('    1. Go to Terminal 1 (where the server is running)'));
        console.log(chalk.cyan('    2. Press Ctrl+C to stop it'));
        console.log(chalk.cyan('    3. Run: npm start\n'));
        const retry = await confirm('Retry after restarting the server?');
        if (!retry) {
          ngrokUrl = testUrl;
        }
      } else {
        healthSpinner.fail(`Server returned status ${response.status}`);
        printWarning('Make sure the event handler server is running (cd event_handler && npm start)');
        const retry = await confirm('Try again?');
        if (!retry) {
          ngrokUrl = testUrl;
        }
      }
    } catch (error) {
      healthSpinner.fail(`Could not reach server: ${error.message}`);
      printWarning('Make sure both the server AND ngrok are running');
      printInfo('Terminal 1: cd event_handler && npm install && npm start');
      printInfo('Terminal 2: ngrok http 3000');
      const retry = await confirm('Try again?');
      if (!retry) {
        ngrokUrl = testUrl; // Continue anyway
      }
    }
  }

  // Set GH_WEBHOOK_URL variable
  const urlSpinner = ora('Setting GH_WEBHOOK_URL variable...').start();
  const urlResult = await setVariables(owner, repo, { GH_WEBHOOK_URL: ngrokUrl });
  if (urlResult.GH_WEBHOOK_URL.success) {
    urlSpinner.succeed('GH_WEBHOOK_URL variable set');
  } else {
    urlSpinner.fail(`Failed: ${urlResult.GH_WEBHOOK_URL.error}`);
  }

  // Register Telegram webhook if configured
  if (telegramToken) {
    const webhookUrl = `${ngrokUrl}/telegram/webhook`;
    const tgSpinner = ora('Registering Telegram webhook...').start();
    const tgResult = await setTelegramWebhook(telegramToken, webhookUrl, telegramWebhookSecret);
    if (tgResult.ok) {
      tgSpinner.succeed(`Telegram webhook registered: ${webhookUrl}`);
    } else {
      tgSpinner.fail(`Failed: ${tgResult.description}`);
    }

    // Chat ID verification
    const chatId = await runVerificationFlow(telegramVerification);

    if (chatId) {
      updateEnvVariable('TELEGRAM_CHAT_ID', chatId);
      printSuccess(`Chat ID saved: ${chatId}`);

      const verified = await verifyRestart(ngrokUrl, apiKey);
      if (verified) {
        printSuccess('Telegram bot is configured and working!');
      } else {
        printWarning('Could not verify bot. Check your configuration.');
      }
    } else {
      printWarning('Chat ID is required — the bot will not respond without it.');
      printInfo('Run npm run setup-telegram to complete setup.');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Step 7: Summary
  // ─────────────────────────────────────────────────────────────────────────────
  printStep(++currentStep, TOTAL_STEPS, 'Setup Complete!');

  console.log(chalk.bold.green('\n  Configuration Summary:\n'));

  console.log(`  ${chalk.dim('Repository:')}      ${owner}/${repo}`);
  console.log(`  ${chalk.dim('Webhook URL:')}     ${ngrokUrl}`);
  console.log(`  ${chalk.dim('GitHub PAT:')}      ${maskSecret(pat)}`);
  console.log(`  ${chalk.dim('Anthropic Key:')}   ${maskSecret(anthropicKey)}`);
  if (openaiKey) console.log(`  ${chalk.dim('OpenAI Key:')}      ${maskSecret(openaiKey)}`);
  if (groqKey) console.log(`  ${chalk.dim('Groq Key:')}        ${maskSecret(groqKey)}`);
  if (braveKey) console.log(`  ${chalk.dim('Brave Search:')}    ${maskSecret(braveKey)}`);
  if (telegramToken) console.log(`  ${chalk.dim('Telegram Bot:')}    Webhook registered`);

  console.log(chalk.bold('\n  GitHub Secrets Set:\n'));
  console.log('  • SECRETS');
  if (llmSecretsBase64) console.log('  • LLM_SECRETS');
  console.log('  • GH_WEBHOOK_SECRET');

  console.log(chalk.bold('\n  GitHub Variables Set:\n'));
  console.log('  • GH_WEBHOOK_URL');
  console.log('  • AUTO_MERGE = true');
  console.log('  • ALLOWED_PATHS = /logs');
  console.log('  • MODEL = claude-sonnet-4-5-20250929');

  console.log(chalk.bold.green('\n  You\'re all set!\n'));

  if (telegramToken) {
    console.log(chalk.cyan('  Message your Telegram bot to create your first job!'));
  } else {
    console.log(chalk.dim('  Use the /webhook endpoint to create jobs.'));
  }

  console.log('\n');
}

main().catch((error) => {
  console.error(chalk.red('\nSetup failed:'), error.message);
  process.exit(1);
});
