'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run fn with specific env vars set, restoring originals afterwards. */
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Require gitea backend fresh (clears gh-wrapper module cache). */
function freshGitea() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('gh-wrapper')) delete require.cache[k];
  }
  return require('../lib/backends/gitea.js');
}

/**
 * Suppress stdout/stderr for a single synchronous-returning promise.
 * NOTE: only used between async yields — does NOT patch process.stdout.write
 * because node:test writes internal TAP messages there during async waits.
 * Instead we let gitea output go to the test runner; assertions use mock.captured.
 */
async function suppressOutput(fn) {
  // We deliberately don't patch process.stdout/stderr here.
  // Tests verify behavior via mock.captured, not console output.
  return fn();
}

/** Start a minimal HTTP mock server. Returns { port, captured, stop }. */
function startMock(handlers = []) {
  const captured = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw || null; }
      captured.push({ method: req.method, url: req.url, body });

      const h = handlers.find(h => h.method === req.method && req.url === h.path);
      if (h) {
        const status = h.status ?? (req.method === 'DELETE' ? 204 : 200);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(h.response !== undefined ? JSON.stringify(h.response) : '');
        return;
      }
      // Default: 204 + empty body for DELETE, 200 + {} for everything else
      res.writeHead(req.method === 'DELETE' ? 204 : 200, { 'Content-Type': 'application/json' });
      res.end(req.method === 'DELETE' ? '' : '{}');
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      // closeAllConnections() ensures HTTP/1.1 keep-alive sockets are closed
      // immediately so server.close() resolves without hanging.
      const stop = () => {
        server.closeAllConnections();
        return new Promise(r => server.close(r));
      };
      resolve({ port, captured, stop });
    });
  });
}

// ---------------------------------------------------------------------------
// Quirk detection via GITEA_QUIRKS env var
// ---------------------------------------------------------------------------

test('GITEA_QUIRKS=1.25 is detected as underscore quirk', async () => {
  // Verify by checking that the merge body omits delete_branch_after_merge
  const mock = await startMock([
    { method: 'POST', path: '/api/v1/repos/o/r/pulls/5/merge', response: null, status: 200 },
    { method: 'GET', path: '/api/v1/repos/o/r/pulls/5', response: { number: 5, head: { ref: 'my-branch' }, html_url: 'http://x' } },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.25' },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() => gitea.run(['pr', 'merge', '5', '--delete-branch', '--repo', 'o/r']));
        const mergeReq = mock.captured.find(r => r.method === 'POST' && r.url.includes('/merge'));
        assert.ok(mergeReq, 'merge request was made');
        assert.equal(mergeReq.body.delete_branch_after_merge, undefined,
          'delete_branch_after_merge must be absent when quirk is active');
      },
    );
  } finally {
    await mock.stop();
  }
});

test('GITEA_QUIRKS=underscore is detected as underscore quirk', async () => {
  const mock = await startMock([
    { method: 'POST', path: '/api/v1/repos/o/r/pulls/7/merge', response: null, status: 200 },
    { method: 'GET', path: '/api/v1/repos/o/r/pulls/7', response: { number: 7, head: { ref: 'feat' }, html_url: 'http://x' } },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: 'underscore' },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() => gitea.run(['pr', 'merge', '7', '--delete-branch', '--repo', 'o/r']));
        const mergeReq = mock.captured.find(r => r.method === 'POST' && r.url.includes('/merge'));
        assert.ok(mergeReq);
        assert.equal(mergeReq.body.delete_branch_after_merge, undefined,
          'delete_branch_after_merge must be absent when GITEA_QUIRKS=underscore');
      },
    );
  } finally {
    await mock.stop();
  }
});

test('auto-detect: version API is queried when GITEA_QUIRKS is unset', async () => {
  const mock = await startMock([
    { method: 'GET', path: '/api/v1/version', response: { version: '1.24.0' } },
    { method: 'POST', path: '/api/v1/repos/o/r/pulls/9/merge', response: null, status: 200 },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: undefined },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() => gitea.run(['pr', 'merge', '9', '--repo', 'o/r']));
        // Version endpoint must have been called
        const versionReq = mock.captured.find(r => r.method === 'GET' && r.url === '/api/v1/version');
        assert.ok(versionReq, 'GET /version was called for auto-detection');
        // Non-1.25 version: delete_branch_after_merge should be present
        const mergeReq = mock.captured.find(r => r.method === 'POST' && r.url.includes('/merge'));
        assert.ok(mergeReq, 'merge request was made');
        assert.equal(mergeReq.body.delete_branch_after_merge, false,
          'delete_branch_after_merge present when version is non-1.25');
      },
    );
  } finally {
    await mock.stop();
  }
});

// ---------------------------------------------------------------------------
// prMerge — without quirk (GITEA_QUIRKS=1.24 simulates a non-1.25 version)
// ---------------------------------------------------------------------------

test('prMerge without quirk: sends delete_branch_after_merge=true in merge body', async () => {
  const mock = await startMock([
    { method: 'POST', path: '/api/v1/repos/o/r/pulls/10/merge', response: null, status: 200 },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.24' },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() => gitea.run(['pr', 'merge', '10', '--delete-branch', '--repo', 'o/r']));
        const mergeReq = mock.captured.find(r => r.method === 'POST' && r.url.includes('/merge'));
        assert.ok(mergeReq, 'merge request was made');
        assert.equal(mergeReq.body.delete_branch_after_merge, true,
          'delete_branch_after_merge=true when quirk is inactive and --delete-branch set');
        // No separate branch DELETE call
        const delReq = mock.captured.find(r => r.method === 'DELETE' && r.url.includes('/branches/'));
        assert.equal(delReq, undefined, 'no separate branch DELETE when quirk is inactive');
      },
    );
  } finally {
    await mock.stop();
  }
});

test('prMerge without quirk: sends delete_branch_after_merge=false when flag absent', async () => {
  const mock = await startMock([
    { method: 'POST', path: '/api/v1/repos/o/r/pulls/11/merge', response: null, status: 200 },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.24' },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() => gitea.run(['pr', 'merge', '11', '--repo', 'o/r']));
        const mergeReq = mock.captured.find(r => r.method === 'POST' && r.url.includes('/merge'));
        assert.ok(mergeReq);
        assert.equal(mergeReq.body.delete_branch_after_merge, false);
      },
    );
  } finally {
    await mock.stop();
  }
});

// ---------------------------------------------------------------------------
// prMerge — with quirk
// ---------------------------------------------------------------------------

test('prMerge with quirk + --delete-branch: omits field and makes separate DELETE call', async () => {
  const mock = await startMock([
    { method: 'POST', path: '/api/v1/repos/o/r/pulls/20/merge', response: null, status: 200 },
    { method: 'GET', path: '/api/v1/repos/o/r/pulls/20', response: { number: 20, head: { ref: 'fix/my-bug' }, html_url: 'http://x' } },
    { method: 'DELETE', path: '/api/v1/repos/o/r/branches/fix%2Fmy-bug', response: null, status: 204 },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.25' },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() =>
          gitea.run(['pr', 'merge', '20', '--delete-branch', '--repo', 'o/r']),
        );
        // Merge body must not include delete_branch_after_merge
        const mergeReq = mock.captured.find(r => r.method === 'POST' && r.url.includes('/merge'));
        assert.ok(mergeReq, 'merge request was made');
        assert.equal(mergeReq.body.delete_branch_after_merge, undefined,
          'delete_branch_after_merge absent in merge body when quirk is active');

        // Separate GET to fetch head branch name
        const getReq = mock.captured.find(r => r.method === 'GET' && r.url === '/api/v1/repos/o/r/pulls/20');
        assert.ok(getReq, 'fetched PR to get head branch name');

        // Separate DELETE for the branch
        const delReq = mock.captured.find(r => r.method === 'DELETE');
        assert.ok(delReq, 'separate branch DELETE was made');
        assert.ok(delReq.url.includes('fix'), 'DELETE targets the head branch');
      },
    );
  } finally {
    await mock.stop();
  }
});

test('prMerge with quirk but without --delete-branch: no separate DELETE call', async () => {
  const mock = await startMock([
    { method: 'POST', path: '/api/v1/repos/o/r/pulls/21/merge', response: null, status: 200 },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.25' },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() => gitea.run(['pr', 'merge', '21', '--repo', 'o/r']));
        const delReq = mock.captured.find(r => r.method === 'DELETE');
        assert.equal(delReq, undefined, 'no DELETE call when --delete-branch not set');
        const getReq = mock.captured.find(r => r.method === 'GET' && r.url.includes('/pulls/21'));
        assert.equal(getReq, undefined, 'no extra GET of PR when --delete-branch not set');
      },
    );
  } finally {
    await mock.stop();
  }
});

test('prMerge with quirk: branch deletion failure is a warning, not a fatal error', async () => {
  const mock = await startMock([
    { method: 'POST', path: '/api/v1/repos/o/r/pulls/22/merge', response: null, status: 200 },
    { method: 'GET', path: '/api/v1/repos/o/r/pulls/22', response: { number: 22, head: { ref: 'feat' }, html_url: 'http://x' } },
    { method: 'DELETE', path: '/api/v1/repos/o/r/branches/feat', response: { message: 'branch not found' }, status: 404 },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.25' },
      async () => {
        const gitea = freshGitea();
        // Should resolve (not throw) even though branch deletion returns 404
        await assert.doesNotReject(
          suppressOutput(() => gitea.run(['pr', 'merge', '22', '--delete-branch', '--repo', 'o/r'])),
          'branch deletion failure must not propagate as a fatal error',
        );
        // Merge still happened
        const mergeReq = mock.captured.find(r => r.method === 'POST' && r.url.includes('/merge'));
        assert.ok(mergeReq, 'merge request was made despite branch deletion failure');
      },
    );
  } finally {
    await mock.stop();
  }
});

// ---------------------------------------------------------------------------
// releaseCreate — without quirk
// ---------------------------------------------------------------------------

test('releaseCreate without quirk: sends target_commitish in body', async () => {
  const mock = await startMock([
    {
      method: 'POST', path: '/api/v1/repos/o/r/releases',
      response: { html_url: 'http://gitea.example.com/o/r/releases/tag/v1.0' },
    },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.24' },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() =>
          gitea.run(['release', 'create', 'v1.0', '--target', 'abc123', '--repo', 'o/r']),
        );
        const relReq = mock.captured.find(r => r.method === 'POST' && r.url.includes('/releases'));
        assert.ok(relReq, 'release request was made');
        assert.equal(relReq.body.target_commitish, 'abc123',
          'target_commitish sent when quirk is inactive');
      },
    );
  } finally {
    await mock.stop();
  }
});

test('releaseCreate without quirk: defaults target_commitish to "main"', async () => {
  const mock = await startMock([
    {
      method: 'POST', path: '/api/v1/repos/o/r/releases',
      response: { html_url: 'http://gitea.example.com/o/r/releases/tag/v2.0' },
    },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.24' },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() => gitea.run(['release', 'create', 'v2.0', '--repo', 'o/r']));
        const relReq = mock.captured.find(r => r.method === 'POST');
        assert.ok(relReq);
        assert.equal(relReq.body.target_commitish, 'main');
      },
    );
  } finally {
    await mock.stop();
  }
});

// ---------------------------------------------------------------------------
// releaseCreate — with quirk
// ---------------------------------------------------------------------------

test('releaseCreate with quirk: omits target_commitish from body', async () => {
  const mock = await startMock([
    {
      method: 'POST', path: '/api/v1/repos/o/r/releases',
      response: { html_url: 'http://gitea.example.com/o/r/releases/tag/v3.0' },
    },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.25' },
      async () => {
        const gitea = freshGitea();
        await suppressOutput(() =>
          gitea.run(['release', 'create', 'v3.0', '--target', 'abc123', '--repo', 'o/r']),
        );
        const relReq = mock.captured.find(r => r.method === 'POST');
        assert.ok(relReq, 'release request was made');
        assert.equal(relReq.body.target_commitish, undefined,
          'target_commitish absent from body when quirk is active');
      },
    );
  } finally {
    await mock.stop();
  }
});

test('releaseCreate with quirk + --target: run succeeds and target_commitish is omitted', async () => {
  // We can't easily capture stderr in node:test without race conditions
  // (node:test writes internal TAP to stdout/stderr during async awaits).
  // Instead we verify the functional outcome: target_commitish is absent from
  // the release body when GITEA_QUIRKS is active, which is the condition that
  // triggers the warning.
  const mock = await startMock([
    {
      method: 'POST', path: '/api/v1/repos/o/r/releases',
      response: { html_url: 'http://gitea.example.com/o/r/releases/tag/v4.0' },
    },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.25' },
      async () => {
        const gitea = freshGitea();
        // Must resolve (not throw) even when target_commitish is requested on 1.25
        await assert.doesNotReject(
          suppressOutput(() =>
            gitea.run(['release', 'create', 'v4.0', '--target', 'deadbeef', '--repo', 'o/r']),
          ),
        );
        const relReq = mock.captured.find(r => r.method === 'POST');
        assert.ok(relReq, 'release request was made');
        assert.equal(relReq.body.target_commitish, undefined,
          'target_commitish absent from body (the warning condition)');
      },
    );
  } finally {
    await mock.stop();
  }
});

test('releaseCreate with quirk but no --target: no warning condition triggered', async () => {
  const mock = await startMock([
    {
      method: 'POST', path: '/api/v1/repos/o/r/releases',
      response: { html_url: 'http://gitea.example.com/o/r/releases/tag/v5.0' },
    },
  ]);
  try {
    await withEnv(
      { GITEA_URL: `http://127.0.0.1:${mock.port}`, GITEA_TOKEN: 'tok', GITEA_QUIRKS: '1.25' },
      async () => {
        const gitea = freshGitea();
        await assert.doesNotReject(
          suppressOutput(() => gitea.run(['release', 'create', 'v5.0', '--repo', 'o/r'])),
        );
        const relReq = mock.captured.find(r => r.method === 'POST');
        assert.ok(relReq, 'release request was made');
        // target_commitish absent (no --target flag), and no warning emitted
        assert.equal(relReq.body.target_commitish, undefined);
      },
    );
  } finally {
    await mock.stop();
  }
});
