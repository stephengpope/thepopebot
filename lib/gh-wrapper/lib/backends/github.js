'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

/**
 * Find the real gh binary by searching PATH, skipping the shim's own directory.
 * Honours GH_REAL_PATH env var as an override (useful for testing).
 */
function findRealGh() {
  if (process.env.GH_REAL_PATH) return process.env.GH_REAL_PATH;

  const shimDir = path.resolve(__dirname, '../../bin');
  const pathDirs = (process.env.PATH || '').split(path.delimiter);

  for (const dir of pathDirs) {
    if (!dir) continue;
    // Skip the directory that contains this shim
    if (path.resolve(dir) === shimDir) continue;
    const candidate = path.join(dir, 'gh');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* not found or not executable */ }
  }
  return null;
}

/**
 * Pass all arguments straight through to the real gh binary.
 * Exits with the same exit code as the real gh.
 */
function run(args) {
  const realGh = findRealGh();
  if (!realGh) {
    process.stderr.write('gh-wrapper: cannot find real gh binary in PATH\n');
    process.stderr.write('  Tip: set GH_REAL_PATH to the full path of the gh binary\n');
    process.exit(1);
  }

  const result = spawnSync(realGh, args, { stdio: 'inherit', env: process.env });
  process.exit(result.status !== null ? result.status : 1);
}

module.exports = { run, findRealGh };
