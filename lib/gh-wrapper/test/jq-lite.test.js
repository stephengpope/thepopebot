'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyJq, applyJqLines } = require('../lib/jq-lite.js');

// applyJq(expr, data):
//   - returns the value directly when there is exactly one result
//   - returns an array when there are multiple results (e.g. .[] iterator)
//   - returns null when there are no results

// ---------------------------------------------------------------------------
// Identity & field access
// ---------------------------------------------------------------------------

test('identity .', () => {
  assert.equal(applyJq('.', 42), 42);
  assert.deepEqual(applyJq('.', { a: 1 }), { a: 1 });
});

test('.field access', () => {
  assert.equal(applyJq('.name', { name: 'pope' }), 'pope');
});

test('.field.nested chained access', () => {
  assert.equal(applyJq('.a.b', { a: { b: 99 } }), 99);
});

test('.field returns null for missing key', () => {
  assert.equal(applyJq('.missing', { a: 1 }), null);
});

// ---------------------------------------------------------------------------
// Array indexing
// ---------------------------------------------------------------------------

test('.[0] first element', () => {
  assert.equal(applyJq('.[0]', [10, 20, 30]), 10);
});

test('.[-1] last element', () => {
  assert.equal(applyJq('.[-1]', [10, 20, 30]), 30);
});

// ---------------------------------------------------------------------------
// Array iterator (returns multiple values → array)
// ---------------------------------------------------------------------------

test('.[] on array returns all elements', () => {
  assert.deepEqual(applyJq('.[]', [1, 2, 3]), [1, 2, 3]);
});

test('.[] on object returns all values', () => {
  const results = applyJq('.[]', { a: 1, b: 2 });
  assert.deepEqual([...results].sort(), [1, 2]);
});

// ---------------------------------------------------------------------------
// Pipe
// ---------------------------------------------------------------------------

test('pipe: .[] | .field produces array of values', () => {
  assert.deepEqual(applyJq('.[] | .name', [{ name: 'a' }, { name: 'b' }]), ['a', 'b']);
});

// ---------------------------------------------------------------------------
// Alternative //
// ---------------------------------------------------------------------------

test('alternative: uses left when truthy', () => {
  assert.equal(applyJq('.x // "default"', { x: 'value' }), 'value');
});

test('alternative: falls back when null', () => {
  assert.equal(applyJq('.x // "default"', {}), 'default');
});

test('alternative: falls back when false', () => {
  assert.equal(applyJq('.x // "default"', { x: false }), 'default');
});

// ---------------------------------------------------------------------------
// Object construction
// ---------------------------------------------------------------------------

test('{key: expr} object construction', () => {
  assert.deepEqual(
    applyJq('{id: .number, name: .title}', { number: 7, title: 'Fix bug' }),
    { id: 7, name: 'Fix bug' },
  );
});

// ---------------------------------------------------------------------------
// Array collector
// ---------------------------------------------------------------------------

test('[expr] collects into array', () => {
  assert.deepEqual(
    applyJq('[.[] | .id]', [{ id: 1 }, { id: 2 }]),
    [1, 2],
  );
});

// ---------------------------------------------------------------------------
// select
// ---------------------------------------------------------------------------

// Note: jq-lite does not implement == comparison operators. select() works
// with truthy checks only (e.g. select(.field) passes when .field is truthy).
test('select: keeps items where field is truthy', () => {
  const results = applyJq(
    '.[] | select(.merged)',
    [{ merged: true, n: 1 }, { merged: false, n: 2 }, { merged: true, n: 3 }],
  );
  assert.deepEqual(results.map(r => r.n), [1, 3]);
});

// ---------------------------------------------------------------------------
// map
// ---------------------------------------------------------------------------

test('map(expr)', () => {
  assert.deepEqual(applyJq('map(.x)', [{ x: 1 }, { x: 2 }]), [1, 2]);
});

// ---------------------------------------------------------------------------
// length
// ---------------------------------------------------------------------------

test('length of array', () => {
  assert.equal(applyJq('length', [1, 2, 3]), 3);
});

test('length of string', () => {
  assert.equal(applyJq('length', 'hello'), 5);
});

test('length of object', () => {
  assert.equal(applyJq('length', { a: 1, b: 2 }), 2);
});

// ---------------------------------------------------------------------------
// keys / values
// ---------------------------------------------------------------------------

test('keys returns sorted key array', () => {
  assert.deepEqual(applyJq('keys', { b: 2, a: 1 }), ['a', 'b']);
});

test('values returns value array', () => {
  const vals = applyJq('values', { a: 1, b: 2 });
  assert.deepEqual([...vals].sort((a, b) => a - b), [1, 2]);
});

// ---------------------------------------------------------------------------
// sort / sort_by
// ---------------------------------------------------------------------------

test('sort array of primitives', () => {
  assert.deepEqual(applyJq('sort', [3, 1, 2]), [1, 2, 3]);
});

test('sort_by(.field)', () => {
  assert.deepEqual(
    applyJq('sort_by(.n)', [{ n: 3 }, { n: 1 }, { n: 2 }]),
    [{ n: 1 }, { n: 2 }, { n: 3 }],
  );
});

// ---------------------------------------------------------------------------
// to_entries / from_entries
// ---------------------------------------------------------------------------

// Note: jq-lite requires parens for these — use to_entries() / from_entries()
test('to_entries()', () => {
  assert.deepEqual(applyJq('to_entries()', { a: 1 }), [{ key: 'a', value: 1 }]);
});

test('from_entries()', () => {
  assert.deepEqual(applyJq('from_entries()', [{ key: 'a', value: 1 }]), { a: 1 });
});

// ---------------------------------------------------------------------------
// tojson / fromjson
// ---------------------------------------------------------------------------

test('tojson encodes to string', () => {
  assert.equal(applyJq('tojson', { a: 1 }), '{"a":1}');
});

// Note: jq-lite requires parens for fromjson — use fromjson()
test('fromjson() decodes string', () => {
  assert.deepEqual(applyJq('fromjson()', '{"a":1}'), { a: 1 });
});

// ---------------------------------------------------------------------------
// applyJqLines (raw string output)
// ---------------------------------------------------------------------------

test('applyJqLines: raw string output', () => {
  const lines = applyJqLines('.[] | .name', [{ name: 'foo' }, { name: 'bar' }], true);
  assert.deepEqual(lines, ['foo', 'bar']);
});

test('applyJqLines: non-string values are JSON-encoded in raw mode', () => {
  const lines = applyJqLines('.[]', [1, 2], true);
  assert.deepEqual(lines, ['1', '2']);
});

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

test('null literal', () => {
  assert.equal(applyJq('null', {}), null);
});

test('true / false literals', () => {
  assert.equal(applyJq('true', {}), true);
  assert.equal(applyJq('false', {}), false);
});

test('number literal', () => {
  assert.equal(applyJq('42', {}), 42);
});

test('string literal', () => {
  assert.equal(applyJq('"hello"', {}), 'hello');
});
