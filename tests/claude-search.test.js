import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, mock, test } from 'node:test';
import { claudeSearchOptions } from '../lib/ai/sdk-adapters/web-search.js';

test('Claude search choices retain native tools or disable both web tools', () => {
  assert.deepEqual(claudeSearchOptions('native'), {});
  assert.deepEqual(claudeSearchOptions('disabled'), { disallowedTools: ['WebSearch', 'WebFetch'] });
  assert.throws(() => claudeSearchOptions('invalid'), /Unsupported/);
  const options = claudeSearchOptions();
  assert.equal(options.mcpServers['thepopebot-parallel-search'].url, 'https://search.parallel.ai/mcp');
  assert.match(options.mcpServers['thepopebot-parallel-search'].headers['User-Agent'], /^thepopebot /);
  assert.deepEqual(options.allowedTools, ['mcp__thepopebot-parallel-search__web_search', 'mcp__thepopebot-parallel-search__web_fetch']);
});

// Exercise the maintained resolver and adapter against the real settings DB.
// Only the SDK boundary is scripted here; the opt-in SDK test uses the actual
// query implementation and Claude process as well (see claude-search-sdk.test.js).
const scratch = mkdtempSync(path.join(tmpdir(), 'thepopebot-search-'));
const originalCwd = process.cwd();
process.env.DATABASE_PATH = path.join(scratch, 'settings.sqlite');
process.chdir(scratch);
const { default: Database } = await import('better-sqlite3');
const { drizzle } = await import('drizzle-orm/better-sqlite3');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const sqlite = new Database(process.env.DATABASE_PATH);
migrate(drizzle(sqlite), { migrationsFolder: path.join(originalCwd, 'drizzle') });
sqlite.close();
const { setConfigValue, setConfigSecret } = await import('../lib/db/config.js');
const { getConfig } = await import('../lib/config.js');
let observed;
let closed;
mock.module('@anthropic-ai/claude-agent-sdk', { namedExports: {
  query: ({ options }) => {
    observed = options;
    closed = false;
    const events = (async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'search', name: 'mcp__thepopebot-parallel-search__web_search' }] } };
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'search', content: [{ type: 'text', text: 'Source: https://example.com/news' }] }] } };
    })();
    events.close = () => { closed = true; };
    return events;
  },
} });
const { getSdkAdapter } = await import('../lib/ai/sdk-adapters/index.js');
const stream = getSdkAdapter('claude-code');
after(() => { process.chdir(originalCwd); rmSync(scratch, { recursive: true, force: true }); });

test('normal adapter resolves fresh and saved settings without changing permissions or credentials', async () => {
  assert.equal(getConfig('CODING_AGENT_CLAUDE_CODE_SEARCH'), 'parallel');
  process.env.AUTH_SECRET = 'search-test-only-encryption-key';
  setConfigValue('CODING_AGENT_CLAUDE_CODE_AUTH', 'api-key');
  setConfigValue('CODING_AGENT_CLAUDE_CODE_MODEL', 'fixture-model');
  setConfigSecret('ANTHROPIC_API_KEY', 'fixture-provider-credential');
  mkdirSync(path.join(scratch, 'repo'), { recursive: true });
  const opts = { workspaceDir: path.join(scratch, 'repo'), workspaceId: 'fixture', userId: 'fixture-user', chatMode: 'code', prompt: 'Find news' };
  for (const [provider, mode] of [['parallel', 'plan'], ['native', 'code'], ['disabled', 'plan']]) {
    setConfigValue('CODING_AGENT_CLAUDE_CODE_SEARCH', provider);
    const chunks = await Array.fromAsync(stream({ ...opts, permissionMode: mode }));
    assert.equal(observed.permissionMode, mode === 'plan' ? 'plan' : 'bypassPermissions');
    assert.deepEqual(observed.allowedTools, provider === 'parallel' ? ['mcp__thepopebot-parallel-search__web_search', 'mcp__thepopebot-parallel-search__web_fetch'] : undefined);
    assert.equal(observed.env.USER_ID, opts.userId);
    assert.equal(observed.env.ANTHROPIC_API_KEY, 'fixture-provider-credential');
    assert.equal(observed.model, 'fixture-model');
    assert.equal(observed.mcpServers !== undefined, provider === 'parallel');
    assert.deepEqual(observed.disallowedTools, provider === 'native' ? undefined : ['WebSearch', 'WebFetch']);
    assert.equal(chunks[0].toolName, 'mcp__thepopebot-parallel-search__web_search');
    assert.equal(chunks[0].result, 'Source: https://example.com/news');
    assert.equal(closed, true);
  }
  setConfigValue('CODING_AGENT_CLAUDE_CODE_SEARCH', 'invalid');
  await assert.rejects(Array.fromAsync(stream(opts)), /Unsupported/);
});

test('admin search selection persists, validates input and requires admin rights', async () => {
  let admin = true;
  mock.module('../lib/auth/index.js', { namedExports: {
    auth: async () => ({ user: { id: 'fixture-user' } }),
    requireAuth: async () => ({ id: 'fixture-user' }),
    requireAdmin: async () => { if (!admin) throw new Error('Admin required'); },
  } });
  const { getCodingAgentSettings, updateCodingAgentConfig } = await import('../lib/chat/actions.js');
  assert.deepEqual(await updateCodingAgentConfig('claude-code', { search: 'native' }), { success: true });
  assert.equal((await getCodingAgentSettings()).claudeCode.search, 'native');
  assert.ok((await updateCodingAgentConfig('claude-code', { search: 'invalid', model: 'should-not-save' })).error);
  assert.equal(getConfig('CODING_AGENT_CLAUDE_CODE_SEARCH'), 'native');
  assert.equal(getConfig('CODING_AGENT_CLAUDE_CODE_MODEL'), 'fixture-model');
  admin = false;
  await assert.rejects(updateCodingAgentConfig('claude-code', { search: 'disabled' }), /Admin required/);
  assert.equal(getConfig('CODING_AGENT_CLAUDE_CODE_SEARCH'), 'native');
});
