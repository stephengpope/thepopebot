'use strict';

/**
 * Parse gh-style CLI arguments.
 *
 * gh uses: gh <command> [subcommand] [positionals...] [flags...]
 *
 * Special cases:
 *   - 'api' has no subcommand — the API endpoint is the first positional
 *   - 'auth' subcommands include multi-word forms like 'setup-git'
 *
 * Returns:
 *   { command, subcommand, positional: [], flags: {} }
 *
 * flags examples:
 *   --repo owner/repo       → { repo: 'owner/repo' }
 *   --json headRefName      → { json: 'headRefName' }
 *   --jq '.field'           → { jq: '.field' }
 *   -q '.field'             → { q: '.field' }
 *   --squash                → { squash: true }
 *   --with-token            → { 'with-token': true }
 */
function parseArgs(argv) {
  const result = {
    command: null,
    subcommand: null,
    positional: [],
    flags: {},
  };

  let positionalCount = 0;
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--') {
      result.positional.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      // A value follows if next exists and doesn't look like a flag
      if (next !== undefined && !next.startsWith('-')) {
        result.flags[key] = next;
        i += 2;
      } else {
        result.flags[key] = true;
        i++;
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length >= 2 && !arg.startsWith('--')) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        result.flags[key] = next;
        i += 2;
      } else {
        result.flags[key] = true;
        i++;
      }
      continue;
    }

    // Positional argument
    if (positionalCount === 0) {
      result.command = arg;
    } else if (positionalCount === 1 && result.command !== 'api') {
      result.subcommand = arg;
    } else {
      result.positional.push(arg);
    }
    positionalCount++;
    i++;
  }

  return result;
}

/**
 * Parse --repo flag: 'owner/repo' → { owner, repo }
 * Handles both 'owner/repo' and full URLs gracefully.
 */
function parseRepo(repoFlag) {
  if (!repoFlag) return null;
  const parts = repoFlag.replace(/^https?:\/\/[^/]+\//, '').split('/');
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Get the jq expression from either --jq or -q flag.
 */
function getJqExpr(flags) {
  return flags.jq || flags.q || null;
}

module.exports = { parseArgs, parseRepo, getJqExpr };
