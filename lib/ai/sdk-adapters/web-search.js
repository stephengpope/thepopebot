// Search configuration for the in-process Claude SDK chat path. Docker agents
// keep their own tool configuration. The SDK owns the HTTP MCP transport.
export const CLAUDE_SEARCH_PROVIDERS = ['parallel', 'native', 'disabled'];

export function claudeSearchOptions(provider = 'parallel') {
  if (!CLAUDE_SEARCH_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported Claude chat search provider: ${provider}`);
  }
  if (provider === 'native') return {};

  // Prevent an implicit switch to Anthropic search if Parallel is unavailable.
  // Native WebSearch/WebFetch remain available through the explicit native choice.
  const options = { disallowedTools: ['WebSearch', 'WebFetch'] };
  if (provider === 'parallel') {
    // Keep the managed server distinct from user-configured Parallel servers,
    // whose custom URL, credentials and tool names must remain intact.
    options.mcpServers = {
      'thepopebot-parallel-search': {
        type: 'http',
        url: 'https://search.parallel.ai/mcp',
        headers: { 'User-Agent': 'thepopebot (https://github.com/stephengpope/thepopebot)' },
      },
    };
    // The chat UI cannot answer SDK permission prompts. Approve only these
    // read-only web tools so search also works in plan mode, like native search.
    options.allowedTools = ['mcp__thepopebot-parallel-search__web_search', 'mcp__thepopebot-parallel-search__web_fetch'];
  }
  // Other tools retain the SDK's permission checks. Optional MCP session_id is
  // left to the host, never shared globally.
  return options;
}
