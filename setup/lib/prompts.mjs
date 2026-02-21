import inquirer from 'inquirer';
import open from 'open';

/**
 * Mask a secret, showing only last 4 characters
 */
export function maskSecret(secret) {
  if (!secret || secret.length < 8) return '****';
  return '****' + secret.slice(-4);
}

/**
 * Prompt for GitHub PAT
 */
export async function promptForPAT() {
  const { pat } = await inquirer.prompt([
    {
      type: 'password',
      name: 'pat',
      message: 'Paste your GitHub Personal Access Token:',
      mask: '*',
      validate: (input) => {
        if (!input) return 'PAT is required';
        if (!input.startsWith('ghp_') && !input.startsWith('github_pat_')) {
          return 'Invalid PAT format. Should start with ghp_ or github_pat_';
        }
        return true;
      },
    },
  ]);
  return pat;
}

/**
 * Prompt for Anthropic API key
 */
export async function promptForAnthropicKey() {
  const { key } = await inquirer.prompt([
    {
      type: 'password',
      name: 'key',
      message: 'Enter your Anthropic API key:',
      mask: '*',
      validate: (input) => {
        if (!input) return 'Anthropic API key is required';
        if (!input.startsWith('sk-ant-')) {
          return 'Invalid format. Should start with sk-ant-';
        }
        return true;
      },
    },
  ]);
  return key;
}

/**
 * Prompt for optional OpenAI API key
 */
export async function promptForOpenAIKey() {
  const { addKey } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addKey',
      message: 'Add OpenAI API key? (optional)',
      default: false,
    },
  ]);

  if (!addKey) return null;

  const { openPage } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'openPage',
      message: 'Open OpenAI API key page in browser?',
      default: true,
    },
  ]);
  if (openPage) {
    await open('https://platform.openai.com/settings/organization/api-keys');
  }

  const { key } = await inquirer.prompt([
    {
      type: 'password',
      name: 'key',
      message: 'Enter your OpenAI API key:',
      mask: '*',
      validate: (input) => {
        if (!input) return 'Key is required if adding';
        if (!input.startsWith('sk-')) {
          return 'Invalid format. Should start with sk-';
        }
        return true;
      },
    },
  ]);
  return key;
}

/**
 * Prompt for optional Groq API key
 */
export async function promptForGroqKey() {
  const { addKey } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addKey',
      message: 'Add Groq API key? (optional)',
      default: false,
    },
  ]);

  if (!addKey) return null;

  const { key } = await inquirer.prompt([
    {
      type: 'password',
      name: 'key',
      message: 'Enter your Groq API key:',
      mask: '*',
      validate: (input) => {
        if (!input) return 'Key is required if adding';
        return true;
      },
    },
  ]);
  return key;
}

/**
 * Prompt for optional Brave Search API key
 */
export async function promptForBraveKey() {
  const { addKey } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addKey',
      message: 'Add Brave Search API key? (free tier, greatly improves agent)',
      default: true,
    },
  ]);

  if (!addKey) return null;

  console.log('\n  To get a free Brave Search API key:');
  console.log('  1. Go to https://api-dashboard.search.brave.com/app/keys');
  console.log('  2. Click "Get Started"');
  console.log('  3. Create an account (or sign in)');
  console.log('  4. Subscribe to the "Free" plan (2,000 queries/month)');
  console.log('  5. Copy your API key\n');

  const { openPage } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'openPage',
      message: 'Open Brave Search API page in browser?',
      default: true,
    },
  ]);
  if (openPage) {
    await open('https://api-dashboard.search.brave.com/app/keys');
  }

  const { key } = await inquirer.prompt([
    {
      type: 'password',
      name: 'key',
      message: 'Enter your Brave Search API key:',
      mask: '*',
      validate: (input) => {
        if (!input) return 'Key is required if adding';
        return true;
      },
    },
  ]);
  return key;
}

/**
 * Prompt for Telegram bot token
 */
export async function promptForTelegramToken() {
  const { addTelegram } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addTelegram',
      message: 'Set up Telegram bot?',
      default: true,
    },
  ]);

  if (!addTelegram) return null;

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: 'Enter your Telegram bot token from @BotFather:',
      mask: '*',
      validate: (input) => {
        if (!input) return 'Token is required';
        if (!/^\d+:[A-Za-z0-9_-]+$/.test(input)) {
          return 'Invalid format. Should be like 123456789:ABC-DEF...';
        }
        return true;
      },
    },
  ]);
  return token;
}

/**
 * Generate a Telegram webhook secret
 */
export async function generateTelegramWebhookSecret() {
  const { randomBytes } = await import('crypto');
  return randomBytes(32).toString('hex');
}

/**
 * Prompt for deployment method
 */
export async function promptForDeployMethod() {
  const { method } = await inquirer.prompt([
    {
      type: 'list',
      name: 'method',
      message: 'How would you like to deploy the event handler?',
      choices: [
        { name: 'Deploy to Vercel via CLI (recommended)', value: 'vercel' },
        { name: 'Open Vercel Deploy Button in browser', value: 'button' },
        { name: 'Skip - I\'ll deploy manually later', value: 'skip' },
      ],
    },
  ]);
  return method;
}

/**
 * Prompt for confirmation
 */
export async function confirm(message, defaultValue = true) {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: defaultValue,
    },
  ]);
  return confirmed;
}

/**
 * Prompt for text input
 */
export async function promptText(message, defaultValue = '') {
  const { value } = await inquirer.prompt([
    {
      type: 'input',
      name: 'value',
      message,
      default: defaultValue,
    },
  ]);
  return value;
}
/**
 * Prompt for LLM provider selection
 */
export async function promptForProvider() {
  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'Choose your LLM provider for the event handler:',
      choices: [
        {
          name: 'Claude (Anthropic) - Recommended',
          value: 'claude',
        },
        {
          name: 'GitHub Copilot',
          value: 'copilot',
        },
      ],
      default: 'claude',
    },
  ]);
  return provider;
}

/**
 * Prompt for GitHub Copilot API authentication
 */
export async function promptForGitHubCopilotKey() {
  const { useToken } = await inquirer.prompt([
    {
      type: 'list',
      name: 'useToken',
      message: 'Use GitHub token (already authenticated) or provide a Copilot-specific key?',
      choices: [
        {
          name: 'Use existing GitHub token from gh CLI',
          value: 'reuse',
        },
        {
          name: 'Provide a new Copilot API key',
          value: 'new',
        },
      ],
      default: 'reuse',
    },
  ]);

  if (useToken === 'reuse') {
    // Signal that we should use the GH_TOKEN
    return 'USE_GH_TOKEN';
  }

  const { key } = await inquirer.prompt([
    {
      type: 'password',
      name: 'key',
      message: 'Enter your GitHub Copilot API key:',
      mask: '*',
      validate: (input) => {
        if (!input) return 'API key is required';
        return true;
      },
    },
  ]);
  return key;
}