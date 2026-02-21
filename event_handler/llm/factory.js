const path = require('path');
const { render_md } = require('../utils/render-md');

/**
 * LLM Provider Factory
 * Selects between Claude (Anthropic) and Copilot based on environment
 */

const PROVIDER_CLAUDE = 'claude';
const PROVIDER_COPILOT = 'copilot';

/**
 * Get the configured LLM provider
 * @returns {string} - Provider name ('claude' or 'copilot')
 */
function getProviderName() {
  return (process.env.EVENT_HANDLER_PROVIDER || PROVIDER_CLAUDE).toLowerCase();
}

/**
 * Validate that required API keys are set for the provider
 * @param {string} providerName - Provider name
 * @throws {Error} - If required API key is missing
 */
function validateProvider(providerName) {
  if (providerName === PROVIDER_COPILOT) {
    if (!process.env.GITHUB_COPILOT_API_KEY && !process.env.GITHUB_TOKEN) {
      throw new Error(
        'GitHub Copilot provider requires either GITHUB_COPILOT_API_KEY or GITHUB_TOKEN environment variable'
      );
    }
  } else if (providerName === PROVIDER_CLAUDE) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Claude provider requires ANTHROPIC_API_KEY environment variable');
    }
  } else {
    throw new Error(
      `Unknown LLM provider: ${providerName}. Supported: ${PROVIDER_CLAUDE}, ${PROVIDER_COPILOT}`
    );
  }
}

/**
 * Get the LLM provider implementation
 * @returns {Object} - Provider with { chat, getApiKey } methods
 */
function getProvider() {
  const providerName = getProviderName();

  validateProvider(providerName);

  if (providerName === PROVIDER_COPILOT) {
    return require('./copilot');
  }

  // Default to Claude
  return require('../claude');
}

/**
 * Chat interface - delegates to selected provider
 * @param {string} userMessage - User's message
 * @param {Array} history - Conversation history
 * @param {Array} toolDefinitions - Available tools
 * @param {Object} toolExecutors - Tool executor functions
 * @returns {Promise<{response: string, history: Array}>}
 */
async function chat(userMessage, history, toolDefinitions, toolExecutors) {
  const provider = getProvider();
  return provider.chat(userMessage, history, toolDefinitions, toolExecutors);
}

/**
 * Get API key for the provider (used by job summary and other features)
 * @returns {string} - API key
 */
function getApiKey() {
  const provider = getProvider();
  return provider.getApiKey();
}

module.exports = {
  chat,
  getApiKey,
  getProviderName,
  getProvider,
  PROVIDER_CLAUDE,
  PROVIDER_COPILOT,
};
