const path = require('path');
const { render_md } = require('../utils/render-md');

const DEFAULT_MODEL = 'gpt-4-turbo';

/**
 * Get GitHub Copilot API credentials from environment
 * @returns {string} API key (GitHub token or Copilot API key)
 */
function getApiKey() {
  if (process.env.GITHUB_COPILOT_API_KEY) {
    return process.env.GITHUB_COPILOT_API_KEY;
  }
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  throw new Error(
    'GitHub Copilot requires either GITHUB_COPILOT_API_KEY or GITHUB_TOKEN environment variable'
  );
}

/**
 * Call GitHub Copilot Chat API
 * Maps tools to function_call format for Copilot compatibility
 * @param {Array} messages - Conversation messages
 * @param {Array} tools - Tool definitions (Anthropic format)
 * @returns {Promise<Object>} API response
 */
async function callCopilot(messages, tools) {
  const apiKey = getApiKey();
  const model = process.env.EVENT_HANDLER_MODEL || DEFAULT_MODEL;
  const systemPrompt = render_md(path.join(__dirname, '..', '..', 'operating_system', 'CHATBOT.md'));

  // Convert Anthropic tool format to OpenAI function_call format
  const functions = tools
    .filter((tool) => tool.name !== 'web_search') // Skip web_search for Copilot
    .map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || {
        type: 'object',
        properties: {},
      },
    }));

  const response = await fetch('https://api.github.com/copilot/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `token ${apiKey}`,
      'X-GitHub-Api-Version': '2024-06-13',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...messages,
      ],
      tools: functions.length > 0 ? functions : undefined,
      tool_choice: functions.length > 0 ? 'auto' : undefined,
      max_tokens: 4096,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Copilot API error: ${response.status} ${error}`);
  }

  const data = await response.json();

  // Convert OpenAI response format to Anthropic format for compatibility
  return convertOpenAIResponseToAnthropic(data);
}

/**
 * Convert OpenAI function_call response to Anthropic tool_use format
 * @param {Object} openaiResponse - Response from OpenAI-compatible API
 * @returns {Object} - Response in Anthropic format
 */
function convertOpenAIResponseToAnthropic(openaiResponse) {
  const choice = openaiResponse.choices?.[0];
  if (!choice) {
    throw new Error('No choice in Copilot response');
  }

  const content = [];
  let stopReason = 'end_turn';

  // Add text content if present
  if (choice.message?.content) {
    content.push({
      type: 'text',
      text: choice.message.content,
    });
  }

  // Convert tool calls to tool_use format
  if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
    stopReason = 'tool_use';

    for (const toolCall of choice.message.tool_calls) {
      if (toolCall.type === 'function') {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments || '{}'),
        });
      }
    }
  }

  return {
    content,
    stop_reason: stopReason,
  };
}

/**
 * Process a conversation turn with Copilot, handling tool calls
 * @param {string} userMessage - User's message
 * @param {Array} history - Conversation history
 * @param {Array} toolDefinitions - Available tools
 * @param {Object} toolExecutors - Tool executor functions
 * @returns {Promise<{response: string, history: Array}>}
 */
async function chat(userMessage, history, toolDefinitions, toolExecutors) {
  // Add user message to history
  const messages = [...history, { role: 'user', content: userMessage }];

  let response = await callCopilot(messages, toolDefinitions);
  let assistantContent = response.content;

  // Add assistant response to history
  messages.push({ role: 'assistant', content: assistantContent });

  // Handle tool use loop
  while (response.stop_reason === 'tool_use') {
    const toolResults = [];

    for (const block of assistantContent) {
      if (block.type === 'tool_use') {
        const executor = toolExecutors[block.name];
        let result;

        if (executor) {
          try {
            result = await executor(block.input);
          } catch (err) {
            result = { error: err.message };
          }
        } else {
          result = { error: `Unknown tool: ${block.name}` };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
    }

    // If no tools to execute, we're done
    if (toolResults.length === 0) {
      break;
    }

    // Add tool results to messages
    messages.push({ role: 'user', content: toolResults });

    // Get next response from Copilot
    response = await callCopilot(messages, toolDefinitions);
    assistantContent = response.content;

    // Add new assistant response to history
    messages.push({ role: 'assistant', content: assistantContent });
  }

  // Extract text response
  const textBlocks = assistantContent.filter((block) => block.type === 'text');
  const responseText = textBlocks.map((block) => block.text).join('\n');

  return {
    response: responseText,
    history: messages,
  };
}

module.exports = {
  chat,
  getApiKey,
};
