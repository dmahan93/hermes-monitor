'use strict';

const { execSync, exec } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, statSync } = require('fs');
const { resolve, join, dirname } = require('path');
const os = require('os');

// Resolve hermes-monitor root directory (two levels up from bin/lib/)
const ROOT = resolve(__dirname, '..', '..');

const CACHE_DIR = join(os.homedir(), '.hermes-monitor');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const LOCK_FILE = join(CACHE_DIR, 'update.lock');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Run a git command in the given directory and return trimmed stdout.
 * @param {string} cmd - git subcommand and args
 * @param {string} [cwd] - working directory (defaults to ROOT)
 * @returns {string}
 */
function git(cmd, cwd = ROOT) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/**
 * Get the current short commit hash.
 * @param {string} [cwd] - working directory
 * @returns {string}
 */
function getCommitHash(cwd = ROOT) {
  try {
    return git('rev-parse --short HEAD', cwd);
  } catch {
    return 'unknown';
  }
}

/**
 * Get the version string from package.json.
 * @param {string} [root] - root directory containing package.json
 * @returns {string}
 */
function getPackageVersion(root = ROOT) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Detect the default remote branch name (master or main).
 * Falls back through: remote HEAD → origin/master → origin/main → 'master'.
 * @param {string} [cwd] - working directory
 * @returns {string}
 */
function getDefaultBranch(cwd = ROOT) {
  try {
    // Try to detect from remote HEAD
    const ref = git('symbolic-ref refs/remotes/origin/HEAD', cwd);
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    // Fall back to checking if master or main exists
    try {
      git('rev-parse --verify origin/master', cwd);
      return 'master';
    } catch {
      try {
        git('rev-parse --verify origin/main', cwd);
        return 'main';
      } catch {
        return 'master'; // default fallback
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Safety checks (extracted for testability)
// ────────────────────────────────────────────────────────────

/**
 * Check if the current branch matches the expected branch.
 * @param {string} expectedBranch - the branch we expect (e.g., 'master')
 * @param {string} [cwd] - working directory
 * @returns {{ ok: boolean, currentBranch?: string, error?: string }}
 */
function checkBranchSafety(expectedBranch, cwd = ROOT) {
  try {
    const currentBranch = git('rev-parse --abbrev-ref HEAD', cwd);
    if (currentBranch !== expectedBranch) {
      return {
        ok: false,
        currentBranch,
        error: `Cannot update — not on the '${expectedBranch}' branch (currently on '${currentBranch}').`,
      };
    }
    return { ok: true, currentBranch };
  } catch {
    return { ok: false, error: 'Could not determine current git branch.' };
  }
}

/**
 * Check if the working tree has uncommitted changes.
 * @param {string} [cwd] - working directory
 * @returns {{ ok: boolean, error?: string }}
 */
function checkDirtyTree(cwd = ROOT) {
  try {
    const status = git('status --porcelain', cwd);
    if (status.length > 0) {
      return {
        ok: false,
        error: 'Working tree has uncommitted changes.',
      };
    }
    return { ok: true };
  } catch {
    // If git status fails, proceed anyway
    return { ok: true };
  }
}

// ────────────────────────────────────────────────────────────
// Lock file for concurrent update protection
// ────────────────────────────────────────────────────────────

/**
 * Acquire an update lock. Returns true if lock was acquired.
 * @param {{ dir?: string, file?: string }} [opts]
 * @returns {boolean}
 */
function acquireLock({ dir = CACHE_DIR, file = LOCK_FILE } = {}) {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (existsSync(file)) {
      // Check if lock is stale (older than 10 minutes)
      const stat = statSync(file);
      const age = Date.now() - stat.mtimeMs;
      if (age > 10 * 60 * 1000) {
        // Stale lock, remove it
        try { unlinkSync(file); } catch { /* ignore */ }
      } else {
        return false;
      }
    }
    writeFileSync(file, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Release the update lock.
 * @param {{ file?: string }} [opts]
 */
function releaseLock({ file = LOCK_FILE } = {}) {
  try {
    if (existsSync(file)) {
      unlinkSync(file);
    }
  } catch {
    // Non-fatal
  }
}

// ────────────────────────────────────────────────────────────
// Version command
// ────────────────────────────────────────────────────────────

/**
 * Display version information.
 * Shows package version, git commit, and cached update status.
 * Does NOT hit the network — uses cached check result for speed.
 * @param {{ cacheFile?: string }} [opts]
 */
function showVersion({ cacheFile } = {}) {
  const version = getPackageVersion();
  const commit = getCommitHash();

  console.log(`hermes-monitor v${version} (${commit})`);

  // Use cached update info (no network call — keeps `version` instant)
  const cached = readCache({ file: cacheFile });
  if (cached && (Date.now() - cached.checkedAt) < CACHE_TTL_MS) {
    if (cached.count > 0) {
      console.log(`\n  ${cached.count} new commit${cached.count === 1 ? '' : 's'} available. Run: hermes-monitor update`);
    } else {
      console.log('\n  Up to date.');
    }
  } else {
    console.log('\n  Update status unknown. Start hermes-monitor to check, or run: hermes-monitor update');
  }
}

// ────────────────────────────────────────────────────────────
// Update command
// ────────────────────────────────────────────────────────────

/**
 * Custom error for update failures inside _performUpdateInner.
 * Thrown instead of calling process.exit() so that the finally block
 * in performUpdate can release the lock file.
 */
class UpdateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UpdateError';
  }
}

/**
 * Perform a full update: git pull, npm install, npm run build.
 * Reports what changed. Sets process.exitCode on failure (does NOT call
 * process.exit() — the caller in hermes-monitor.js does that).
 *
 * Safety checks:
 * - Refuses to run if not on the default branch (master/main)
 * - Refuses to run if the working tree has uncommitted changes
 * - Acquires a lock file to prevent concurrent updates
 *
 * @param {{ root?: string, lockDir?: string, lockFile?: string }} [opts]
 *   Override paths for testing. Defaults to module-level ROOT / CACHE_DIR / LOCK_FILE.
 */
function performUpdate({ root = ROOT, lockDir, lockFile } = {}) {
  const effectiveLockDir = lockDir || CACHE_DIR;
  const effectiveLockFile = lockFile || LOCK_FILE;

  const branch = getDefaultBranch(root);

  // Safety: ensure we're on the default branch
  const branchCheck = checkBranchSafety(branch, root);
  if (!branchCheck.ok) {
    console.error(`Error: ${branchCheck.error}`);
    if (branchCheck.currentBranch) {
      console.error(`Switch to ${branch} first: git checkout ${branch}`);
    }
    process.exitCode = 1;
    return;
  }

  // Safety: ensure working tree is clean
  const dirtyCheck = checkDirtyTree(root);
  if (!dirtyCheck.ok) {
    console.error(`Error: ${dirtyCheck.error}`);
    console.error('Stash or commit your changes first:');
    console.error('  git stash && hermes-monitor update && git stash pop');
    process.exitCode = 1;
    return;
  }

  // Safety: prevent concurrent updates
  if (!acquireLock({ dir: effectiveLockDir, file: effectiveLockFile })) {
    console.error('Error: Another update is already in progress.');
    console.error('If this is stale, remove the lock file: rm ~/.hermes-monitor/update.lock');
    process.exitCode = 1;
    return;
  }

  try {
    _performUpdateInner(branch, root);
  } catch (err) {
    // Errors are already logged inside _performUpdateInner.
    // Just ensure exit code is non-zero.
    process.exitCode = 1;
  } finally {
    releaseLock({ file: effectiveLockFile });
  }
}

/**
 * Inner update logic (called after safety checks and lock acquisition).
 * Throws UpdateError on fatal failures instead of calling process.exit(),
 * so the caller's finally block can release the lock file.
 *
 * @param {string} branch - the default branch name
 * @param {string} [root] - repo root directory (defaults to ROOT)
 * @throws {UpdateError} on git or npm failures
 */
function _performUpdateInner(branch, root = ROOT) {
  const oldHash = getCommitHash(root);

  console.log('Updating hermes-monitor...\n');

  // 1. git fetch
  try {
    git('fetch --quiet', root);
  } catch (err) {
    console.error('Error: Failed to fetch from remote.');
    console.error(err.message);
    throw new UpdateError('Failed to fetch from remote');
  }

  // 2. Check how many commits behind
  let commitCount;
  try {
    const countStr = git(`rev-list HEAD..origin/${shellescape(branch)} --count`, root);
    commitCount = parseInt(countStr, 10);
  } catch (err) {
    console.error(`Error: Failed to check for updates on origin/${branch}.`);
    console.error(err.message);
    throw new UpdateError(`Failed to check for updates on origin/${branch}`);
  }

  if (isNaN(commitCount)) {
    console.error('Error: Could not determine number of new commits.');
    throw new UpdateError('Could not determine number of new commits');
  }

  if (commitCount === 0) {
    console.log('Already up to date.');
    return;
  }

  // 3. git pull
  console.log(`  Pulling ${commitCount} commit${commitCount === 1 ? '' : 's'}...`);
  try {
    execSync(`git pull origin ${shellescape(branch)}`, { cwd: root, stdio: 'inherit' });
  } catch {
    console.error('\nError: git pull failed.');
    console.error('Try: git stash && hermes-monitor update && git stash pop');
    throw new UpdateError('git pull failed');
  }

  // 4. npm install
  console.log('\n  Installing dependencies...');
  try {
    execSync('npm install', { cwd: root, stdio: 'inherit' });
  } catch {
    console.error('\nError: npm install failed.');
    throw new UpdateError('npm install failed');
  }

  // 5. npm run build (if build script exists)
  // Build failure is a "soft" error — the update itself succeeded (code pulled,
  // deps installed), so we set process.exitCode but don't throw. The caller
  // still reports the update and releases the lock.
  let hasBuildScript = false;
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    hasBuildScript = !!(pkg.scripts && pkg.scripts.build);
  } catch {
    // Can't read package.json — skip build step
  }

  if (hasBuildScript) {
    try {
      console.log('\n  Building...');
      execSync('npm run build', { cwd: root, stdio: 'inherit' });
    } catch {
      console.error('\n  Error: Build step failed. The app may be in a broken state.');
      console.error(`  Try running manually: cd ${root} && npm run build`);
      process.exitCode = 1;
    }
  }

  // 6. Report
  const newHash = getCommitHash(root);
  console.log(`\nUpdated from ${oldHash} to ${newHash} (${commitCount} commit${commitCount === 1 ? '' : 's'})`);
  console.log('Restart any running hermes-monitor instances to use the new version.');

  // Reset the update check cache
  clearCache();
}

/**
 * Escape a string for safe use in shell commands.
 * Only allows alphanumeric, dash, underscore, dot, and slash.
 * Best for git branch names; use shellQuotePath() for filesystem paths.
 * @param {string} str
 * @returns {string}
 */
function shellescape(str) {
  return str.replace(/[^a-zA-Z0-9._\-\/]/g, '');
}

/**
 * Shell-quote a filesystem path using single quotes.
 * Handles paths with spaces, parens, and other special characters.
 * @param {string} str
 * @returns {string}
 */
function shellQuotePath(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// ────────────────────────────────────────────────────────────
// Startup update check (cached, mostly non-blocking)
// ────────────────────────────────────────────────────────────

/**
 * Read the cached update check result.
 * @param {{ file?: string }} [opts] - Override cache file path (for testing)
 * @returns {{ count: number, checkedAt: number } | null}
 */
function readCache({ file = CACHE_FILE } = {}) {
  try {
    if (!existsSync(file)) return null;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof data.count !== 'number' || typeof data.checkedAt !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Write update check result to cache.
 * @param {number} count
 * @param {{ dir?: string, file?: string }} [opts] - Override cache paths (for testing)
 */
function writeCache(count, { dir = CACHE_DIR, file = CACHE_FILE } = {}) {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(file, JSON.stringify({ count, checkedAt: Date.now() }));
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Reset the update check cache (writes count=0, preserving the file).
 * @param {{ file?: string }} [opts] - Override cache file path (for testing)
 */
function clearCache({ file = CACHE_FILE } = {}) {
  try {
    if (existsSync(file)) {
      writeFileSync(file, JSON.stringify({ count: 0, checkedAt: Date.now() }));
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Check for updates in the background and print a notice if available.
 * Mostly non-blocking — cache check is sync, network fetch is async.
 * Results are cached for 1 hour.
 * @param {{ cacheFile?: string }} [opts]
 */
function checkForUpdatesInBackground({ cacheFile } = {}) {
  // Check cache first (synchronous, instant)
  const cached = readCache({ file: cacheFile });
  if (cached && (Date.now() - cached.checkedAt) < CACHE_TTL_MS) {
    if (cached.count > 0) {
      printUpdateNotice(cached.count);
    }
    return;
  }

  // Build the full command to run async — includes branch detection
  // so we don't block on synchronous getDefaultBranch() calls.
  // The shell command detects the default branch and counts commits in one shot.
  const script = [
    'cd ' + shellQuotePath(ROOT),
    // Detect default branch: try remote HEAD, then master, then main
    'branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed "s#refs/remotes/origin/##")',
    'if [ -z "$branch" ]; then',
    '  if git rev-parse --verify origin/master >/dev/null 2>&1; then branch=master;',
    '  elif git rev-parse --verify origin/main >/dev/null 2>&1; then branch=main;',
    '  else branch=master; fi',
    'fi',
    'git fetch --quiet 2>/dev/null',
    'git rev-list HEAD..origin/$branch --count 2>/dev/null',
  ].join(' && ');

  const child = exec(
    script,
    { cwd: ROOT, timeout: 15000 },
    (err, stdout) => {
      if (err) return; // Silently fail — offline, not a git repo, etc.
      const count = parseInt((stdout || '').trim(), 10);
      if (isNaN(count)) return;

      const effectiveCacheFile = cacheFile || CACHE_FILE;
      writeCache(count, { dir: dirname(effectiveCacheFile), file: effectiveCacheFile });

      if (count > 0) {
        printUpdateNotice(count);
      }
    },
  );
  // Unref child and stdio to prevent keeping the event loop alive
  if (child.stdout) child.stdout.unref();
  if (child.stderr) child.stderr.unref();
  child.unref();
}

/**
 * Print a one-line update notice to stderr (so it doesn't interfere with stdout piping).
 * @param {number} count
 */
function printUpdateNotice(count) {
  process.stderr.write(`  update:  ${count} new commit${count === 1 ? '' : 's'} available. Run: hermes-monitor update\n`);
}

module.exports = {
  showVersion,
  performUpdate,
  checkForUpdatesInBackground,
  UpdateError,
  // Exported for testing
  getCommitHash,
  getPackageVersion,
  getDefaultBranch,
  checkBranchSafety,
  checkDirtyTree,
  acquireLock,
  releaseLock,
  readCache,
  writeCache,
  clearCache,
  printUpdateNotice,
  shellescape,
  shellQuotePath,
  ROOT,
  CACHE_DIR,
  CACHE_FILE,
  LOCK_FILE,
  CACHE_TTL_MS,
};
