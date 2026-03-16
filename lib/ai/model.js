import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { getConfig } from '../config.js';
import { BUILTIN_PROVIDERS, getProviderBaseUrl } from '../llm-providers.js';

// These models require thought_signature round-tripping which @langchain/google-genai doesn't support.
// Auto-replace with gemini-2.5-flash until we migrate to @langchain/google (see issue #201).
const GEMINI_UNSUPPORTED_MODELS = ['gemini-2.5-pro', 'gemini-3'];
const GEMINI_FALLBACK = 'gemini-2.5-flash';

/**
 * Create a LangChain chat model based on DB/env configuration.
 *
 * @param {object} [options] - Max tokens for the response
 * @returns {import('@langchain/core/language_models/chat_models').BaseChatModel}
 */
export async function createModel(options = {}) {
  const provider = getConfig('LLM_PROVIDER');
  const modelName = getConfig('LLM_MODEL');
  const maxTokens = options.maxTokens || Number(getConfig('LLM_MAX_TOKENS')) || 4096;

  // Custom provider (not in BUILTIN_PROVIDERS) → OpenAI-compatible
  if (!BUILTIN_PROVIDERS[provider]) {
    const { getCustomProvider } = await import('../db/config.js');
    const custom = getCustomProvider(provider);
    if (!custom) throw new Error(`Unknown LLM provider: ${provider}`);
    const config = { modelName: custom.model || modelName, maxTokens };
    config.apiKey = custom.apiKey || 'not-needed';
    if (custom.baseUrl) {
      config.configuration = { baseURL: custom.baseUrl };
    }
    return new ChatOpenAI(config);
  }

  switch (provider) {
    case 'anthropic': {
      const apiKey = getConfig('ANTHROPIC_API_KEY');
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required — set it on the Settings > Chat page');
      }
      return new ChatAnthropic({
        modelName,
        maxTokens,
        anthropicApiKey: apiKey,
      });
    }
    case 'openai': {
      const apiKey = getConfig('OPENAI_API_KEY');
      const baseURL = getConfig('OPENAI_BASE_URL');
      if (!apiKey && !baseURL) {
        throw new Error('OPENAI_API_KEY is required — set it on the Settings > Chat page');
      }
      const config = { modelName, maxTokens };
      config.apiKey = apiKey || 'not-needed';
      if (baseURL) {
        config.configuration = { baseURL };
      }
      return new ChatOpenAI(config);
    }
    case 'google': {
      const apiKey = getConfig('GOOGLE_API_KEY');
      if (!apiKey) {
        throw new Error('GOOGLE_API_KEY is required — set it on the Settings > Chat page');
      }
      let resolvedModel = modelName;
      const isUnsupported = GEMINI_UNSUPPORTED_MODELS.some(m => resolvedModel.startsWith(m));
      if (isUnsupported) {
        console.warn(
          `[model] ${resolvedModel} requires thought_signature support not yet available in @langchain/google-genai. ` +
          `Falling back to ${GEMINI_FALLBACK}. See https://github.com/stephengpope/thepopebot/issues/201.`
        );
        resolvedModel = GEMINI_FALLBACK;
      }
      return new ChatGoogleGenerativeAI({
        model: resolvedModel,
        maxOutputTokens: maxTokens,
        apiKey,
      });
    }
    case 'novita': {
      const apiKey = getConfig('NOVITA_API_KEY');
      if (!apiKey) {
        throw new Error('NOVITA_API_KEY is required — set it on the Settings > Chat page');
      }
      const config = { modelName, maxTokens };
      config.apiKey = apiKey;
      const baseUrl = getProviderBaseUrl('novita');
      if (baseUrl) {
        config.configuration = { baseURL: baseUrl };
      }
      return new ChatOpenAI(config);
    }
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
