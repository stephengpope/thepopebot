// Opt in with RUN_CLAUDE_SEARCH_SDK=1. This runs the installed Claude SDK and
// Claude process against a scripted model API, not model inference. Only the
// MCP destination is redirected to a local protocol fixture; production options
// are asserted before redirecting. No real model credentials are needed.
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { query as realQuery } from '@anthropic-ai/claude-agent-sdk';

test('Claude SDK discovers, calls and consumes the configured MCP web tools', {
  skip: process.env.RUN_CLAUDE_SEARCH_SDK !== '1', timeout: 120_000,
}, async () => {
  const originalCwd = process.cwd();
  const scratch = mkdtempSync(path.join(tmpdir(), 'thepopebot-sdk-'));
  const requests = [];
  const modelRequests = [];
  const optionsSeen = [];
  const runs = [];
  let scenario = 'normal';
  let savedMcp = false;
  const serve = async (handler) => {
    const server = http.createServer(async (req, res) => {
      try {
        let raw = '';
        for await (const part of req) raw += part;
        await handler(req, res, raw ? JSON.parse(raw) : {});
      } catch (error) { res.writeHead(500); res.end(String(error)); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${server.address().port}` };
  };
  const mcp = await serve((req, res, body) => {
    requests.push({ url: req.url, method: body.method, params: body.params, headers: req.headers });
    const reply = result => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result })); };
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    if (body.method === 'initialize') return reply({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'search-fixture', version: '1' } });
    if (body.method === 'tools/list') return reply({ tools: [
      { name: 'web_search', description: 'Search the web', inputSchema: { type: 'object', properties: { objective: { type: 'string' }, search_queries: { type: 'array', items: { type: 'string' } } }, required: ['objective', 'search_queries'] }, annotations: { readOnlyHint: true } },
      { name: 'web_fetch', description: 'Fetch a page', inputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' } } }, required: ['urls'] }, annotations: { readOnlyHint: true } },
    ] });
    if (body.method === 'tools/call') {
      if (scenario === 'timeout') return; // SDK MCP_TOOL_TIMEOUT owns the deadline.
      return reply({ content: [{ type: 'text', text: scenario === 'error'
        ? 'Search service unavailable'
        : `${body.params.name}: fixture evidence https://example.com/news` }], ...(scenario === 'error' ? { isError: true } : {}) });
    }
    res.writeHead(202); res.end();
  });
  const model = await serve((req, res, body) => {
    if (req.url.includes('count_tokens')) { res.end(JSON.stringify({ input_tokens: 1 })); return; }
    if (!req.url.includes('/messages')) { res.end('{}'); return; }
    modelRequests.push(body);
    const results = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === 'tool_result');
    const tools = body.tools || [];
    const next = results.length === 0 ? 'web_search' : results.length === 1 && scenario === 'normal' ? 'web_fetch' : null;
    const name = scenario === 'write' && results.length === 0
      ? tools.find(t => t.name === 'Write')?.name
      : next && tools.find(t => savedMcp ? t.name === `mcp__parallel-search__${next}` : t.name.endsWith(`__${next}`))?.name;
    const live = process.env.LIVE_PARALLEL_MCP === '1';
    const content = name ? { type: 'tool_use', id: `fixture_${results.length}`, name, input: name === 'Write'
      ? { file_path: path.join(scratch, 'repo', 'blocked-write.txt'), content: 'must not be written in plan mode' }
      : next === 'web_search'
      ? { objective: live ? 'Find official Node.js release documentation' : 'Find fixture news', search_queries: [live ? 'Node.js official release documentation' : 'fixture news source'] }
      : { urls: [live ? 'https://nodejs.org/en/about/previous-releases' : 'https://example.com/news'] } }
      : { type: 'text', text: results.length ? `Consumed source: ${JSON.stringify(results.at(-1).content)}` : 'No MCP search tools' };
    const message = { id: 'msg_fixture', type: 'message', role: 'assistant', model: body.model, content: [content], stop_reason: name ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) { res.end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    event('message_start', { message: { ...message, content: [], stop_reason: null } });
    event('content_block_start', { index: 0, content_block: name ? { ...content, input: {} } : { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: name ? { type: 'input_json_delta', partial_json: JSON.stringify(content.input) } : { type: 'text_delta', text: content.text } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 1 } });
    event('message_stop', {});
    res.end();
  });
  try {
    process.env.DATABASE_PATH = path.join(scratch, 'settings.sqlite');
    process.chdir(scratch);
    const { default: Database } = await import('better-sqlite3');
    const { drizzle } = await import('drizzle-orm/better-sqlite3');
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
    const sqlite = new Database(process.env.DATABASE_PATH);
    migrate(drizzle(sqlite), { migrationsFolder: path.join(originalCwd, 'drizzle') });
    sqlite.close();
    const { setConfigValue } = await import('../lib/db/config.js');
    mock.module('@anthropic-ai/claude-agent-sdk', { namedExports: {
      query: ({ prompt, options }) => {
        optionsSeen.push(options);
        const remote = options.mcpServers?.['thepopebot-parallel-search'];
        if (remote) {
          assert.equal(remote.url, 'https://search.parallel.ai/mcp');
          assert.equal(remote.headers.Authorization, undefined);
          assert.match(remote.headers['User-Agent'], /^thepopebot /);
        }
        if (savedMcp) {
          writeFileSync(path.join(options.env.HOME, '.claude.json'), JSON.stringify({ mcpServers: {
            'parallel-search': { type: 'http', url: `${mcp.url}/saved-search`, headers: { Authorization: 'Bearer existing-fixture' } },
          } }));
        }
        // Use an isolated HOME and credential whitelist, including for live MCP.
        const env = { PATH: process.env.PATH, HOME: options.env.HOME, USER_ID: options.env.USER_ID,
          ANTHROPIC_API_KEY: 'local-fixture-only', ANTHROPIC_BASE_URL: model.url,
          IS_SANDBOX: '1', ENABLE_TOOL_SEARCH: 'false', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DISABLE_TELEMETRY: '1', MCP_TOOL_TIMEOUT: process.env.LIVE_PARALLEL_MCP === '1' ? '60000' : '1000',
        };
        // Preserve network routing/trust, without inheriting provider credentials.
        for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NODE_EXTRA_CA_CERTS']) {
          if (process.env[key]) env[key] = process.env[key];
        }
        env.NO_PROXY = env.no_proxy = '127.0.0.1,localhost';
        return realQuery({ prompt, options: { ...options, env, maxTurns: 4,
          ...(remote && process.env.LIVE_PARALLEL_MCP !== '1' ? { mcpServers: { 'thepopebot-parallel-search': { ...remote, url: `${mcp.url}/mcp` } } } : {}),
        } });
      },
    } });
    const { getSdkAdapter } = await import('../lib/ai/sdk-adapters/index.js');
    const stream = getSdkAdapter('claude-code');
    const workspaceDir = path.join(scratch, 'repo');
    mkdirSync(workspaceDir);
    const run = async (provider, permissionMode = 'code') => {
      if (provider) setConfigValue('CODING_AGENT_CLAUDE_CODE_SEARCH', provider);
      const chunks = await Array.fromAsync(stream({ prompt: 'Find fixture news then read its source.', workspaceDir,
        workspaceId: crypto.randomUUID(), userId: 'fixture-user', chatMode: 'code', permissionMode }));
      runs.push({ provider: provider || 'default', permissionMode, scenario, chunks });
      return chunks;
    };
    const chunks = await run(null);
    assert.equal(optionsSeen[0].permissionMode, 'bypassPermissions');
    assert.ok(chunks.some(c => c.type === 'tool-result'), JSON.stringify(chunks));
    if (process.env.LIVE_PARALLEL_MCP === '1') {
      // Live tool errors/quotas are evidence, not a successful live search.
      console.log('LIVE_MCP_RESULTS', JSON.stringify(chunks.filter(c => c.type === 'tool-result')));
      return;
    }
    assert.ok(chunks.some(c => c.type === 'text' && c.text.includes('Consumed source:') && c.text.includes('https://example.com/news')));
    assert.deepEqual(requests.filter(r => r.method === 'tools/call').map(r => r.params.name), ['web_search', 'web_fetch']);
    for (const request of requests.filter(r => ['initialize', 'tools/list', 'tools/call'].includes(r.method))) {
      assert.match(request.headers['user-agent'], /^thepopebot /);
      assert.equal(request.headers.authorization, undefined);
    }
    assert.deepEqual(requests.find(r => r.params?.name === 'web_fetch').params.arguments.urls, ['https://example.com/news']);
    for (const provider of ['native', 'disabled']) {
      const start = requests.length;
      await run(provider);
      assert.equal(requests.length, start, `${provider} must not connect to Parallel`);
      const names = modelRequests.at(-1).tools.map(t => t.name);
      assert.equal(names.includes('WebSearch'), provider === 'native');
      assert.equal(names.includes('WebFetch'), provider === 'native');
    }
    scenario = 'error';
    const failed = await run('parallel');
    assert.ok(failed.some(c => c.type === 'tool-result' && c.result.includes('Search service unavailable')));
    assert.ok(failed.some(c => c.type === 'text' && c.text.includes('Search service unavailable')));
    scenario = 'timeout';
    const timedOut = await run('parallel');
    assert.ok(timedOut.some(c => c.type === 'tool-result' && /timed out|timeout/i.test(c.result)), JSON.stringify(timedOut));
    scenario = 'normal';
    const planned = await run('parallel', 'plan');
    assert.equal(optionsSeen.at(-1).permissionMode, 'plan');
    assert.deepEqual(optionsSeen.at(-1).allowedTools, ['mcp__thepopebot-parallel-search__web_search', 'mcp__thepopebot-parallel-search__web_fetch']);
    assert.equal(planned.filter(c => c.type === 'tool-result' && c.result.includes('fixture evidence')).length, 2);
    scenario = 'write';
    const writeDenied = await run('parallel', 'plan');
    assert.ok(writeDenied.some(c => c.type === 'tool-result' && /permission|plan mode/i.test(c.result)), JSON.stringify(writeDenied));
    assert.equal(existsSync(path.join(workspaceDir, 'blocked-write.txt')), false);
    scenario = 'normal';

    // The SDK also loads user MCP declarations from HOME even without
    // settingSources. A managed default must not replace their URL/credentials.
    savedMcp = true;
    for (const provider of ['parallel', 'native', 'disabled']) {
      const start = requests.length;
      const saved = await run(provider);
      const calls = requests.slice(start).filter(r => r.method === 'tools/call');
      assert.equal(saved.filter(c => c.type === 'tool-result' && c.toolName?.startsWith('mcp__parallel-search__') && c.result.includes('fixture evidence')).length, 2);
      assert.deepEqual(calls.map(r => r.params.name), ['web_search', 'web_fetch']);
      for (const call of calls) {
        assert.equal(call.url, '/saved-search');
        assert.equal(call.headers.authorization, 'Bearer existing-fixture');
      }
    }

    // Closing the consumer at a tool boundary must close the real SDK query.
    // Run last: a request dispatched before cancellation may still reach the
    // fixture, but must not be mistaken for a subsequent conversation's call.
    savedMcp = false;
    setConfigValue('CODING_AGENT_CLAUDE_CODE_SEARCH', 'parallel');
    const cancelled = stream({ prompt: 'Find news', workspaceDir, workspaceId: crypto.randomUUID(),
      userId: 'fixture-user', chatMode: 'code', permissionMode: 'code' });
    for await (const chunk of cancelled) {
      if (chunk.type === 'tool-call' && chunk.args?.objective) break;
    }
    assert.equal((await cancelled.next()).done, true);
  } finally {
    if (process.env.CLAUDE_SEARCH_EVIDENCE) {
      writeFileSync(process.env.CLAUDE_SEARCH_EVIDENCE, JSON.stringify({
        scriptedModel: true, liveMcp: process.env.LIVE_PARALLEL_MCP === '1',
        options: optionsSeen.map(({ mcpServers, disallowedTools, permissionMode }) => ({ mcpServers, disallowedTools, permissionMode })),
        requests, modelRequests, runs,
      }, null, 2));
    }
    model.server.closeAllConnections(); mcp.server.closeAllConnections();
    await Promise.all([new Promise(resolve => model.server.close(resolve)), new Promise(resolve => mcp.server.close(resolve))]);
    process.chdir(originalCwd);
    rmSync(scratch, { recursive: true, force: true });
  }
});
