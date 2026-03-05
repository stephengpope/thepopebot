'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, parseRepo, getJqExpr } = require('../lib/args.js');

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs: basic command + subcommand', () => {
  const r = parseArgs(['pr', 'list']);
  assert.equal(r.command, 'pr');
  assert.equal(r.subcommand, 'list');
  assert.deepEqual(r.positional, []);
  assert.deepEqual(r.flags, {});
});

test('parseArgs: boolean flag', () => {
  const r = parseArgs(['pr', 'merge', '42', '--squash']);
  assert.equal(r.flags.squash, true);
  assert.deepEqual(r.positional, ['42']);
});

test('parseArgs: flag with value', () => {
  const r = parseArgs(['pr', 'view', '7', '--repo', 'owner/repo']);
  assert.equal(r.flags.repo, 'owner/repo');
  assert.deepEqual(r.positional, ['7']);
});

test('parseArgs: --json and --jq flags', () => {
  const r = parseArgs(['pr', 'list', '--json', 'number,title', '--jq', '.[] | .number']);
  assert.equal(r.flags.json, 'number,title');
  assert.equal(r.flags.jq, '.[] | .number');
});

test('parseArgs: short -q flag', () => {
  const r = parseArgs(['release', 'list', '-q', '.[0].tagName']);
  assert.equal(r.flags.q, '.[0].tagName');
});

test('parseArgs: api — endpoint goes to positional[0], not subcommand', () => {
  const r = parseArgs(['api', 'repos/owner/repo/pulls']);
  assert.equal(r.command, 'api');
  assert.equal(r.subcommand, null);
  assert.equal(r.positional[0], 'repos/owner/repo/pulls');
});

test('parseArgs: hyphenated flag', () => {
  const r = parseArgs(['pr', 'merge', '1', '--delete-branch']);
  assert.equal(r.flags['delete-branch'], true);
});

test('parseArgs: --with-token boolean', () => {
  const r = parseArgs(['auth', 'login', '--with-token']);
  assert.equal(r.flags['with-token'], true);
});

test('parseArgs: -- stops flag parsing', () => {
  const r = parseArgs(['pr', 'create', '--', '--title', 'literal']);
  assert.deepEqual(r.positional, ['--title', 'literal']);
});

test('parseArgs: multiple positionals after command+subcommand', () => {
  const r = parseArgs(['secret', 'set', 'MY_SECRET', '--repo', 'o/r']);
  assert.equal(r.subcommand, 'set');
  assert.deepEqual(r.positional, ['MY_SECRET']);
  assert.equal(r.flags.repo, 'o/r');
});

// ---------------------------------------------------------------------------
// parseRepo
// ---------------------------------------------------------------------------

test('parseRepo: owner/repo string', () => {
  assert.deepEqual(parseRepo('myorg/myrepo'), { owner: 'myorg', repo: 'myrepo' });
});

test('parseRepo: full https URL', () => {
  assert.deepEqual(
    parseRepo('https://gitea.example.com/myorg/myrepo'),
    { owner: 'myorg', repo: 'myrepo' },
  );
});

test('parseRepo: null input returns null', () => {
  assert.equal(parseRepo(null), null);
  assert.equal(parseRepo(undefined), null);
  assert.equal(parseRepo(''), null);
});

test('parseRepo: single segment returns null', () => {
  assert.equal(parseRepo('justrepo'), null);
});

// ---------------------------------------------------------------------------
// getJqExpr
// ---------------------------------------------------------------------------

test('getJqExpr: --jq flag', () => {
  assert.equal(getJqExpr({ jq: '.foo' }), '.foo');
});

test('getJqExpr: -q flag fallback', () => {
  assert.equal(getJqExpr({ q: '.bar' }), '.bar');
});

test('getJqExpr: --jq wins over -q', () => {
  assert.equal(getJqExpr({ jq: '.a', q: '.b' }), '.a');
});

test('getJqExpr: neither flag returns null', () => {
  assert.equal(getJqExpr({}), null);
});
