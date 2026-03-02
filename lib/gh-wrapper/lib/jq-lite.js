'use strict';

/**
 * jq-lite: a minimal jq evaluator covering the subset used by thepopebot.
 *
 * Supported:
 *   .                        identity
 *   .field                   object field access
 *   .field.nested            chained field access
 *   .[n]  .[-1]              array index (negative ok)
 *   .[]                      array/object iterator
 *   a | b                    pipe
 *   a // b                   alternative (null/false fallback)
 *   {key: expr, ...}         object construction
 *   [expr]                   array collector
 *   "string with \(.expr)"   string interpolation
 *   select(cond)             filter
 *   test("regex")            regex test
 *   sort                     sort array of primitives
 *   sort_by(expr)            sort array by expression
 *   last  first              last/first element of array
 *   length                   length of array/string/object
 *   keys  values             object keys/values
 *   map(expr)                map over array
 *   to_entries from_entries  object ↔ [{key,value}] conversion
 *   tojson  fromjson         JSON encode/decode
 *   tostring  tonumber       type coercion
 *   not  empty               boolean/stream ops
 *   null  true  false        literals
 *   numbers, strings         literals
 */

// ---------------------------------------------------------------------------
// Helpers: find positions of top-level tokens (not inside brackets/strings)
// ---------------------------------------------------------------------------

function findTopLevel(src, char) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i <= src.length - char.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
    if (depth === 0 && src.slice(i, i + char.length) === char) return i;
  }
  return -1;
}

function findTopLevelChar(src, ch) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; continue; }
    if (depth === 0 && c === ch) return i;
  }
  return -1;
}

function splitTopLevel(src, sep) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let current = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (esc) { esc = false; current += ch; continue; }
    if (ch === '\\' && inStr) { esc = true; current += ch; continue; }
    if (ch === '"') { inStr = !inStr; current += ch; continue; }
    if (inStr) { current += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; current += ch; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; current += ch; continue; }
    if (depth === 0 && src.slice(i, i + sep.length) === sep) {
      parts.push(current);
      current = '';
      i += sep.length - 1;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

// ---------------------------------------------------------------------------
// Evaluator: evalExpr returns an array of output values (jq is a stream)
// ---------------------------------------------------------------------------

function evalExpr(expr, input) {
  expr = (expr || '').trim();
  if (expr === '' || expr === '.') return [input];

  // Pipe: split at lowest-precedence top-level |
  // Must skip // to avoid splitting 'a // b' at the wrong |
  const pipeIdx = findPipe(expr);
  if (pipeIdx >= 0) {
    const left = expr.slice(0, pipeIdx).trim();
    const right = expr.slice(pipeIdx + 1).trim();
    const leftVals = evalExpr(left, input);
    const out = [];
    for (const v of leftVals) out.push(...evalExpr(right, v));
    return out;
  }

  // Alternative: a // b
  const altIdx = findTopLevel(expr, '//');
  if (altIdx >= 0) {
    const left = expr.slice(0, altIdx).trim();
    const right = expr.slice(altIdx + 2).trim();
    let leftVals;
    try { leftVals = evalExpr(left, input); } catch { leftVals = []; }
    const truthy = leftVals.filter(v => v !== null && v !== false && v !== undefined);
    if (truthy.length > 0) return truthy;
    return evalExpr(right, input);
  }

  // Array constructor: [expr]
  if (expr.startsWith('[') && expr.endsWith(']')) {
    const inner = expr.slice(1, -1).trim();
    if (inner === '') return [[]];
    const vals = evalExpr(inner, input);
    return [vals];
  }

  // Object constructor: {key: expr, ...}
  if (expr.startsWith('{') && expr.endsWith('}')) {
    return [evalObject(expr.slice(1, -1), input)];
  }

  // String literal (may contain \(...) interpolation)
  if (expr.startsWith('"')) {
    const end = findMatchingQuote(expr, 0);
    const template = expr.slice(1, end);
    return [evalInterpolatedString(template, input)];
  }

  // Number literal
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(expr)) return [parseFloat(expr)];

  // Boolean / null
  if (expr === 'null') return [null];
  if (expr === 'true') return [true];
  if (expr === 'false') return [false];

  // Builtins with no args
  switch (expr) {
    case 'length':
      if (input === null) return [0];
      if (Array.isArray(input)) return [input.length];
      if (typeof input === 'string') return [input.length];
      if (typeof input === 'object') return [Object.keys(input).length];
      return [0];
    case 'keys':
      if (typeof input === 'object' && input !== null && !Array.isArray(input))
        return [Object.keys(input).sort()];
      if (Array.isArray(input)) return [input.map((_, i) => i)];
      return [[]];
    case 'values':
      if (typeof input === 'object' && input !== null && !Array.isArray(input))
        return [Object.values(input)];
      if (Array.isArray(input)) return [input];
      return [[]];
    case 'not': return [!input];
    case 'empty': return [];
    case 'sort':
      if (!Array.isArray(input)) return [input];
      return [[...input].sort((a, b) => {
        if (a === null) return -1;
        if (b === null) return 1;
        if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
        return a < b ? -1 : a > b ? 1 : 0;
      })];
    case 'reverse':
      if (!Array.isArray(input)) return [input];
      return [[...input].reverse()];
    case 'unique':
      if (!Array.isArray(input)) return [input];
      return [[...new Set(input)]];
    case 'add':
      if (!Array.isArray(input) || input.length === 0) return [null];
      return [input.reduce((a, b) => {
        if (typeof a === 'string') return a + String(b == null ? '' : b);
        if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
        return a + b;
      })];
    case 'flatten':
      if (!Array.isArray(input)) return [input];
      return [flattenDeep(input)];
    case 'first':
      if (!Array.isArray(input) || input.length === 0) return [null];
      return [input[0]];
    case 'last':
      if (!Array.isArray(input) || input.length === 0) return [null];
      return [input[input.length - 1]];
    case 'type':
      if (input === null) return ['null'];
      if (Array.isArray(input)) return ['array'];
      return [typeof input];
    case 'tojson': return [JSON.stringify(input)];
    case 'tostring':
      if (typeof input === 'string') return [input];
      return [JSON.stringify(input)];
    case 'tonumber': return [Number(input)];
    case 'ascii_downcase':
      return [typeof input === 'string' ? input.toLowerCase() : input];
    case 'ascii_upcase':
      return [typeof input === 'string' ? input.toUpperCase() : input];
    case 'ltrimstr': return [input]; // needs arg, handled below
    case 'rtrimstr': return [input];
    case 'indices': return [[]];
    case 'env': return [process.env];
    case '.[]':
      if (Array.isArray(input)) return input;
      if (typeof input === 'object' && input !== null) return Object.values(input);
      return [];
    default:
      break;
  }

  // Function calls: name(args)
  const fnMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\(.*\))$/s);
  if (fnMatch) {
    const name = fnMatch[1];
    const rawArgs = fnMatch[2].slice(1, -1); // strip outer ( )
    return evalBuiltin(name, rawArgs, input);
  }

  // Dot expressions
  if (expr.startsWith('.')) {
    return evalDot(expr, input);
  }

  // Fallback
  return [input];
}

function findPipe(expr) {
  // Find top-level | but not inside // (alternative)
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
    if (depth === 0 && ch === '|') return i;
  }
  return -1;
}

function findMatchingQuote(src, start) {
  let esc = false;
  for (let i = start + 1; i < src.length; i++) {
    if (esc) { esc = false; continue; }
    if (src[i] === '\\') { esc = true; continue; }
    if (src[i] === '"') return i;
  }
  return src.length;
}

function flattenDeep(arr) {
  const out = [];
  for (const v of arr) {
    if (Array.isArray(v)) out.push(...flattenDeep(v));
    else out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dot-path expressions
// ---------------------------------------------------------------------------

function evalDot(expr, input) {
  if (expr === '.' || expr === '') return [input];

  // .[] iterator
  if (expr === '.[]') {
    if (Array.isArray(input)) return input;
    if (typeof input === 'object' && input !== null) return Object.values(input);
    return [];
  }

  // .[n] or .[-n] — then optional tail
  const idxMatch = expr.match(/^\.\[(-?[0-9]+)\](.*)/s);
  if (idxMatch) {
    const idx = parseInt(idxMatch[1], 10);
    const tail = idxMatch[2];
    let val = null;
    if (Array.isArray(input)) {
      const i = idx < 0 ? input.length + idx : idx;
      val = i >= 0 && i < input.length ? input[i] : null;
    }
    if (val === null) return [null];
    return tail ? evalDot(tail, val) : [val];
  }

  // .[] iterator with tail
  const iterMatch = expr.match(/^\.\[\](.*)/s);
  if (iterMatch) {
    const tail = iterMatch[1];
    let items = [];
    if (Array.isArray(input)) items = input;
    else if (typeof input === 'object' && input !== null) items = Object.values(input);
    if (!tail) return items;
    const out = [];
    for (const item of items) out.push(...evalDot(tail, item));
    return out;
  }

  // .field? (optional)
  const optMatch = expr.match(/^\.([a-zA-Z_][a-zA-Z0-9_]*)\?(.*)/s);
  if (optMatch) {
    const field = optMatch[1];
    const tail = optMatch[2];
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return [null];
    const val = Object.prototype.hasOwnProperty.call(input, field) ? input[field] : null;
    if (val === null) return [null];
    return tail ? evalDot(tail, val) : [val];
  }

  // .field (then optional . or [ tail)
  const fieldMatch = expr.match(/^\.([a-zA-Z_][a-zA-Z0-9_]*)((?:\.|\[).*)?$/s);
  if (fieldMatch) {
    const field = fieldMatch[1];
    const rawTail = fieldMatch[2] || '';
    // Normalize: a tail like '[n]' needs a leading '.' to re-enter evalDot
    const tail = rawTail.startsWith('[') ? '.' + rawTail : rawTail;
    let val = null;
    if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
      val = Object.prototype.hasOwnProperty.call(input, field) ? input[field] : null;
    }
    if (val === null && tail) return [null];
    if (val === null) return [null];
    return tail ? evalDot(tail, val) : [val];
  }

  return [input];
}

// ---------------------------------------------------------------------------
// Object construction: {key: expr, k2: expr2}
// ---------------------------------------------------------------------------

function evalObject(inner, input) {
  const obj = {};
  const pairs = splitTopLevel(inner, ',');
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colonIdx = findTopLevelChar(trimmed, ':');
    if (colonIdx < 0) {
      // Shorthand: {foo} → {foo: .foo}
      const field = trimmed.replace(/^\./, '');
      const [v] = evalExpr(`.${field}`, input);
      obj[field] = v !== undefined ? v : null;
      continue;
    }
    let key = trimmed.slice(0, colonIdx).trim();
    const valExpr = trimmed.slice(colonIdx + 1).trim();
    // Computed key: (.expr)
    if (key.startsWith('(') && key.endsWith(')')) {
      const [k] = evalExpr(key.slice(1, -1), input);
      key = k !== null && k !== undefined ? String(k) : '';
    } else {
      key = key.replace(/^["']|["']$/g, '');
    }
    const [v] = evalExpr(valExpr, input);
    obj[key] = v !== undefined ? v : null;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// String interpolation: "text \(.expr) more"
// ---------------------------------------------------------------------------

function evalInterpolatedString(template, input) {
  let result = '';
  let i = 0;
  while (i < template.length) {
    if (template[i] === '\\') {
      const next = template[i + 1];
      if (next === '(') {
        // Find matching )
        let depth = 1;
        let j = i + 2;
        while (j < template.length && depth > 0) {
          if (template[j] === '(') depth++;
          else if (template[j] === ')') depth--;
          j++;
        }
        const subExpr = template.slice(i + 2, j - 1);
        const [val] = evalExpr(subExpr, input);
        result += val === null ? 'null' : String(val);
        i = j;
        continue;
      }
      switch (next) {
        case 'n': result += '\n'; break;
        case 't': result += '\t'; break;
        case 'r': result += '\r'; break;
        case '"': result += '"'; break;
        case '\\': result += '\\'; break;
        default: result += next || ''; break;
      }
      i += 2;
      continue;
    }
    result += template[i++];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Built-in functions with arguments
// ---------------------------------------------------------------------------

function evalBuiltin(name, rawArgs, input) {
  switch (name) {
    case 'select': {
      let passes;
      try { passes = evalExpr(rawArgs, input).some(v => v !== null && v !== false); }
      catch { passes = false; }
      return passes ? [input] : [];
    }
    case 'test': {
      const [pattern, flags] = parseStringArgs(rawArgs);
      try {
        const re = new RegExp(pattern, flags || '');
        return [re.test(typeof input === 'string' ? input : String(input))];
      } catch { return [false]; }
    }
    case 'match': {
      const [pattern, flags] = parseStringArgs(rawArgs);
      try {
        const re = new RegExp(pattern, flags || '');
        const m = re.exec(typeof input === 'string' ? input : String(input));
        if (!m) return [null];
        return [{ offset: m.index, length: m[0].length, string: m[0], captures: [] }];
      } catch { return [null]; }
    }
    case 'capture': {
      const [pattern, flags] = parseStringArgs(rawArgs);
      try {
        const re = new RegExp(pattern, flags || '');
        const m = re.exec(typeof input === 'string' ? input : String(input));
        if (!m || !m.groups) return [{}];
        return [m.groups];
      } catch { return [{}]; }
    }
    case 'map': {
      if (!Array.isArray(input)) return [[]];
      const out = [];
      for (const item of input) out.push(...evalExpr(rawArgs, item));
      return [out];
    }
    case 'map_values': {
      if (Array.isArray(input)) {
        return [input.map(item => { const [v] = evalExpr(rawArgs, item); return v; })];
      }
      if (typeof input === 'object' && input !== null) {
        const obj = {};
        for (const [k, v] of Object.entries(input)) {
          const [nv] = evalExpr(rawArgs, v);
          obj[k] = nv;
        }
        return [obj];
      }
      return [input];
    }
    case 'select': {
      let passes;
      try { passes = evalExpr(rawArgs, input).some(v => v !== null && v !== false); }
      catch { passes = false; }
      return passes ? [input] : [];
    }
    case 'sort_by': {
      if (!Array.isArray(input)) return [input];
      return [[...input].sort((a, b) => {
        const [av] = evalExpr(rawArgs, a);
        const [bv] = evalExpr(rawArgs, b);
        if (av === null && bv === null) return 0;
        if (av === null) return -1;
        if (bv === null) return 1;
        if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv);
        return av < bv ? -1 : av > bv ? 1 : 0;
      })];
    }
    case 'group_by': {
      if (!Array.isArray(input)) return [[]];
      const groups = {};
      for (const item of input) {
        const [k] = evalExpr(rawArgs, item);
        const key = JSON.stringify(k);
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      }
      return [Object.values(groups)];
    }
    case 'unique_by': {
      if (!Array.isArray(input)) return [input];
      const seen = new Set();
      const out = [];
      for (const item of input) {
        const [k] = evalExpr(rawArgs, item);
        const key = JSON.stringify(k);
        if (!seen.has(key)) { seen.add(key); out.push(item); }
      }
      return [out];
    }
    case 'min_by': {
      if (!Array.isArray(input) || input.length === 0) return [null];
      return [input.reduce((min, cur) => {
        const [mv] = evalExpr(rawArgs, min);
        const [cv] = evalExpr(rawArgs, cur);
        return cv < mv ? cur : min;
      })];
    }
    case 'max_by': {
      if (!Array.isArray(input) || input.length === 0) return [null];
      return [input.reduce((max, cur) => {
        const [mv] = evalExpr(rawArgs, max);
        const [cv] = evalExpr(rawArgs, cur);
        return cv > mv ? cur : max;
      })];
    }
    case 'first': {
      const [arr] = evalExpr(rawArgs, input);
      if (!Array.isArray(arr) || arr.length === 0) return [null];
      return [arr[0]];
    }
    case 'last': {
      const [arr] = evalExpr(rawArgs, input);
      if (!Array.isArray(arr) || arr.length === 0) return [null];
      return [arr[arr.length - 1]];
    }
    case 'nth': {
      const parts = splitTopLevel(rawArgs, ';');
      const n = parseInt(evalExpr(parts[0].trim(), input)[0], 10);
      const [arr] = parts[1] ? evalExpr(parts[1].trim(), input) : [input];
      if (!Array.isArray(arr)) return [null];
      return [arr[n] !== undefined ? arr[n] : null];
    }
    case 'range': {
      const parts = splitTopLevel(rawArgs, ';').map(p => Number(evalExpr(p.trim(), input)[0]));
      let [start, end, step] = parts.length === 1 ? [0, parts[0], 1] :
        parts.length === 2 ? [parts[0], parts[1], 1] : parts;
      const out = [];
      if (step > 0) for (let i = start; i < end; i += step) out.push(i);
      else if (step < 0) for (let i = start; i > end; i += step) out.push(i);
      return [out];
    }
    case 'limit': {
      const parts = splitTopLevel(rawArgs, ';');
      const n = Number(evalExpr(parts[0].trim(), input)[0]);
      const items = parts[1] ? evalExpr(parts[1].trim(), input) : [];
      return [items.slice(0, n)];
    }
    case 'has': {
      const key = rawArgs.replace(/^["']|["']$/g, '');
      if (typeof input === 'object' && input !== null) return [key in input];
      if (Array.isArray(input)) return [!isNaN(Number(key)) && Number(key) < input.length];
      return [false];
    }
    case 'in': {
      const [obj] = evalExpr(rawArgs, input);
      if (typeof obj === 'object' && obj !== null) return [String(input) in obj];
      return [false];
    }
    case 'contains': {
      const [val] = evalExpr(rawArgs, input);
      if (typeof input === 'string' && typeof val === 'string') return [input.includes(val)];
      if (Array.isArray(input) && Array.isArray(val)) return [val.every(v => input.includes(v))];
      return [false];
    }
    case 'inside': {
      const [container] = evalExpr(rawArgs, input);
      if (Array.isArray(container)) return [Array.isArray(input) && input.every(v => container.includes(v))];
      return [false];
    }
    case 'split': {
      const sep = rawArgs.replace(/^["']|["']$/g, '');
      return [typeof input === 'string' ? input.split(sep) : input];
    }
    case 'join': {
      const sep = rawArgs.replace(/^["']|["']$/g, '');
      return [Array.isArray(input) ? input.map(v => v === null ? '' : String(v)).join(sep) : input];
    }
    case 'ltrimstr': {
      const s = rawArgs.replace(/^["']|["']$/g, '');
      return [typeof input === 'string' && input.startsWith(s) ? input.slice(s.length) : input];
    }
    case 'rtrimstr': {
      const s = rawArgs.replace(/^["']|["']$/g, '');
      return [typeof input === 'string' && input.endsWith(s) ? input.slice(0, -s.length) : input];
    }
    case 'startswith': {
      const s = rawArgs.replace(/^["']|["']$/g, '');
      return [typeof input === 'string' ? input.startsWith(s) : false];
    }
    case 'endswith': {
      const s = rawArgs.replace(/^["']|["']$/g, '');
      return [typeof input === 'string' ? input.endsWith(s) : false];
    }
    case 'to_entries': {
      if (typeof input === 'object' && input !== null && !Array.isArray(input))
        return [Object.entries(input).map(([k, v]) => ({ key: k, value: v }))];
      if (Array.isArray(input))
        return [input.map((v, i) => ({ key: i, value: v }))];
      return [[]];
    }
    case 'from_entries': {
      if (!Array.isArray(input)) return [{}];
      const obj = {};
      for (const e of input) {
        const k = e.key !== undefined ? e.key : (e.name !== undefined ? e.name : e.Key);
        obj[String(k)] = e.value;
      }
      return [obj];
    }
    case 'with_entries': {
      const entries = evalBuiltin('to_entries', '', input)[0] || [];
      const mapped = [];
      for (const e of entries) mapped.push(...evalExpr(rawArgs, e));
      return [evalBuiltin('from_entries', '', mapped)[0]];
    }
    case 'indices':
    case 'index': {
      if (typeof input === 'string') {
        const needle = rawArgs.replace(/^["']|["']$/g, '');
        return [input.indexOf(needle)];
      }
      return [null];
    }
    case 'rindex': {
      if (typeof input === 'string') {
        const needle = rawArgs.replace(/^["']|["']$/g, '');
        return [input.lastIndexOf(needle)];
      }
      return [null];
    }
    case 'explode':
      return [typeof input === 'string' ? [...input].map(c => c.codePointAt(0)) : input];
    case 'implode':
      return [Array.isArray(input) ? String.fromCodePoint(...input) : input];
    case 'fromjson':
      try { return [JSON.parse(String(input))]; } catch { return [null]; }
    case 'tojson':
      return [JSON.stringify(input)];
    case 'ascii': return [typeof input === 'number' ? String.fromCharCode(input) : null];
    case 'floor': return [Math.floor(Number(input))];
    case 'ceil': return [Math.ceil(Number(input))];
    case 'round': return [Math.round(Number(input))];
    case 'fabs':
    case 'abs': return [Math.abs(Number(input))];
    case 'sqrt': return [Math.sqrt(Number(input))];
    case 'pow': {
      const [exp] = evalExpr(rawArgs, input);
      return [Math.pow(Number(input), Number(exp))];
    }
    case 'env': return [process.env[rawArgs.replace(/^["']|["']$/g, '')] || null];
    case 'error': throw new Error(rawArgs || 'error');
    case 'debug': return [input];
    case 'recurse': return [input];
    case 'recurse_down': return [input];
    case 'path': return [null];
    case 'paths': return [[]];
    case 'leaf_paths': return [[]];
    case 'getpath': return [null];
    case 'delpaths': return [input];
    case 'del': {
      // del(.field) — basic support
      if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
        const fieldMatch = rawArgs.trim().match(/^\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
        if (fieldMatch) {
          const obj = { ...input };
          delete obj[fieldMatch[1]];
          return [obj];
        }
      }
      return [input];
    }
    case 'not': {
      const [v] = evalExpr(rawArgs, input);
      return [!v];
    }
    case 'any': {
      if (!Array.isArray(input)) return [false];
      return [input.some(item => evalExpr(rawArgs, item).some(v => v !== null && v !== false))];
    }
    case 'all': {
      if (!Array.isArray(input)) return [true];
      return [input.every(item => evalExpr(rawArgs, item).some(v => v !== null && v !== false))];
    }
    case 'flatten': {
      const depth = rawArgs ? Number(rawArgs) : Infinity;
      function flatN(arr, d) {
        if (d === 0) return arr;
        const out = [];
        for (const v of arr) {
          if (Array.isArray(v)) out.push(...flatN(v, d - 1));
          else out.push(v);
        }
        return out;
      }
      return [Array.isArray(input) ? flatN(input, depth) : input];
    }
    case 'modulemeta':
    case 'builtins':
    case 'label':
    case 'break':
    case 'until':
    case 'while':
    case 'repeat':
    case 'input':
    case 'inputs':
      return [null];
    default:
      return [input];
  }
}

function parseStringArgs(rawArgs) {
  // Returns [string, optional_flags] from jq test("regex") or test("regex";"flags")
  const parts = splitTopLevel(rawArgs, ';');
  const str = parts[0].trim();
  const val = str.startsWith('"') ? str.slice(1, findMatchingQuote(str, 0)) : str;
  const flags = parts[1] ? parts[1].trim().replace(/^["']|["']$/g, '') : undefined;
  return [val, flags];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply a jq expression to data.
 * Returns the first output value, or null.
 */
function applyJq(expr, data) {
  if (!expr) return data;
  const results = evalExpr(expr, data);
  if (results.length === 0) return null;
  return results.length === 1 ? results[0] : results;
}

/**
 * Apply a jq expression and format for output.
 * raw=true: strings are output without JSON quoting (like jq -r).
 * Returns an array of output lines.
 */
function applyJqLines(expr, data, raw) {
  if (!expr) {
    return [raw && typeof data === 'string' ? data : JSON.stringify(data, null, 2)];
  }
  const results = evalExpr(expr, data);
  return results.map(v => {
    if (v === null) return 'null';
    if (raw && typeof v === 'string') return v;
    return JSON.stringify(v, null, 2);
  });
}

module.exports = { applyJq, applyJqLines, evalExpr };
