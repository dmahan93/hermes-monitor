'use strict';

const { execSync, exec } = require('child_process');
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('fs');
const { resolve, join } = require('path');
const os = require('os');

// Resolve hermes-monitor root directory (two levels up from bin/lib/)
const ROOT = resolve(__dirname, '..', '..');

const CACHE_DIR = join(os.homedir(), '.hermes-monitor');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Run a git command in the hermes-monitor repo and return trimmed stdout.
 * @param {string} cmd
 * @returns {string}
 */
function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/**
 * Get the current short commit hash.
 * @returns {string}
 */
function getCommitHash() {
  try {
    return git('rev-parse --short HEAD');
  } catch {
    return 'unknown';
  }
}

/**
 * Get the version string from package.json.
 * @returns {string}
 */
function getPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Detect the default remote branch name (master or main).
 * @returns {string}
 */
function getDefaultBranch() {
  try {
    // Try to detect from remote HEAD
    const ref = git('symbolic-ref refs/remotes/origin/HEAD');
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    // Fall back to checking if master or main exists
    try {
      git('rev-parse --verify origin/master');
      return 'master';
    } catch {
      try {
        git('rev-parse --verify origin/main');
        return 'main';
      } catch {
        return 'master'; // default fallback
      }
    }
  }
}

// ────────────────────────────────────────────────────────────
// Version command
// ────────────────────────────────────────────────────────────

/**
 * Display version information.
 * Shows package version, git commit, and available updates.
 */
function showVersion() {
  const version = getPackageVersion();
  const commit = getCommitHash();

  console.log(`hermes-monitor v${version} (${commit})`);

  // Check for updates (fetch from remote)
  try {
    const branch = getDefaultBranch();
    git('fetch --quiet');
    const count = git(`rev-list HEAD..origin/${branch} --count`);
    const behind = parseInt(count, 10);
    if (behind > 0) {
      console.log(`\n  ${behind} update${behind === 1 ? '' : 's'} available. Run: hermes-monitor update`);
    } else {
      console.log('\n  Up to date.');
    }
  } catch {
    // Offline or not a git repo — skip update check
    console.log('\n  Could not check for updates (offline or not a git repo).');
  }
}

// ────────────────────────────────────────────────────────────
// Update command
// ────────────────────────────────────────────────────────────

/**
 * Perform a full update: git pull, npm install, npm run build.
 * Reports what changed.
 */
function performUpdate() {
  const branch = getDefaultBranch();
  const oldHash = getCommitHash();

  console.log('Updating hermes-monitor...\n');

  // 1. git fetch + check if we're behind
  try {
    git('fetch --quiet');
  } catch (err) {
    console.error('Error: Failed to fetch from remote.');
    console.error(err.message);
    process.exit(1);
  }

  const countStr = git(`rev-list HEAD..origin/${branch} --count`);
  const commitCount = parseInt(countStr, 10);

  if (commitCount === 0) {
    console.log('Already up to date.');
    return;
  }

  // 2. git pull
  console.log(`  Pulling ${commitCount} commit${commitCount === 1 ? '' : 's'}...`);
  try {
    execSync(`git pull origin ${branch}`, { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error('\nError: git pull failed. You may have local changes.');
    console.error('Try: git stash && hermes-monitor update && git stash pop');
    process.exit(1);
  }

  // 3. npm install
  console.log('\n  Installing dependencies...');
  try {
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error('\nError: npm install failed.');
    process.exit(1);
  }

  // 4. npm run build (if build script exists)
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    if (pkg.scripts && pkg.scripts.build) {
      console.log('\n  Building...');
      execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
    }
  } catch {
    // Build failure is non-fatal for the update command
    console.warn('\n  Warning: build step failed (non-fatal).');
  }

  // 5. Report
  const newHash = getCommitHash();
  console.log(`\nUpdated from ${oldHash} to ${newHash} (${commitCount} commit${commitCount === 1 ? '' : 's'})`);

  // Clear the update check cache
  clearCache();
}

// ────────────────────────────────────────────────────────────
// Startup update check (non-blocking, cached)
// ────────────────────────────────────────────────────────────

/**
 * Read the cached update check result.
 * @returns {{ count: number, checkedAt: number } | null}
 */
function readCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (typeof data.count !== 'number' || typeof data.checkedAt !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Write update check result to cache.
 * @param {number} count
 */
function writeCache(count) {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify({ count, checkedAt: Date.now() }));
  } catch {
    // Cache write failure is non-fatal
  }
}

/**
 * Clear the update check cache.
 */
function clearCache() {
  try {
    if (existsSync(CACHE_FILE)) {
      writeFileSync(CACHE_FILE, JSON.stringify({ count: 0, checkedAt: Date.now() }));
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Check for updates in the background and print a notice if available.
 * Non-blocking — uses async exec so it doesn't delay startup.
 * Results are cached for 1 hour.
 */
function checkForUpdatesInBackground() {
  // Check cache first (synchronous, instant)
  const cached = readCache();
  if (cached && (Date.now() - cached.checkedAt) < CACHE_TTL_MS) {
    if (cached.count > 0) {
      printUpdateNotice(cached.count);
    }
    return;
  }

  // Do the check async — non-blocking exec
  const branch = getDefaultBranch();
  const child = exec(
    `git fetch --quiet && git rev-list HEAD..origin/${branch} --count`,
    { cwd: ROOT, timeout: 15000 },
    (err, stdout) => {
      if (err) return; // Silently fail — offline, not a git repo, etc.
      const count = parseInt(stdout.trim(), 10);
      if (isNaN(count)) return;

      writeCache(count);

      if (count > 0) {
        printUpdateNotice(count);
      }
    },
  );
  // Unref so it doesn't prevent the process from exiting
  if (child.unref) child.unref();
}

/**
 * Print a one-line update notice to stderr (so it doesn't interfere with stdout piping).
 * @param {number} count
 */
function printUpdateNotice(count) {
  console.log(`  update:  ${count} new commit${count === 1 ? '' : 's'} available. Run: hermes-monitor update`);
}

module.exports = {
  showVersion,
  performUpdate,
  checkForUpdatesInBackground,
  // Exported for testing
  getCommitHash,
  getPackageVersion,
  getDefaultBranch,
  readCache,
  writeCache,
  clearCache,
  ROOT,
  CACHE_FILE,
  CACHE_TTL_MS,
};
