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
 * Falls back through: remote HEAD → origin/master → origin/main → 'master'.
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
 * Shows package version, git commit, and cached update status.
 * Does NOT hit the network — uses cached check result for speed.
 */
function showVersion() {
  const version = getPackageVersion();
  const commit = getCommitHash();

  console.log(`hermes-monitor v${version} (${commit})`);

  // Use cached update info (no network call — keeps `version` instant)
  const cached = readCache();
  if (cached && (Date.now() - cached.checkedAt) < CACHE_TTL_MS) {
    if (cached.count > 0) {
      console.log(`\n  ${cached.count} update${cached.count === 1 ? '' : 's'} available. Run: hermes-monitor update`);
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
 * Perform a full update: git pull, npm install, npm run build.
 * Reports what changed. Exits with non-zero code on build failure.
 *
 * Safety checks:
 * - Refuses to run if not on the default branch (master/main)
 * - Refuses to run if the working tree has uncommitted changes
 */
function performUpdate() {
  const branch = getDefaultBranch();

  // Safety: ensure we're on the default branch
  try {
    const currentBranch = git('rev-parse --abbrev-ref HEAD');
    if (currentBranch !== branch) {
      console.error(`Error: Cannot update — not on the '${branch}' branch (currently on '${currentBranch}').`);
      console.error(`Switch to ${branch} first: git checkout ${branch}`);
      process.exit(1);
    }
  } catch {
    console.error('Error: Could not determine current git branch.');
    process.exit(1);
  }

  // Safety: ensure working tree is clean
  try {
    const status = git('status --porcelain');
    if (status.length > 0) {
      console.error('Error: Working tree has uncommitted changes.');
      console.error('Stash or commit your changes first:');
      console.error('  git stash && hermes-monitor update && git stash pop');
      process.exit(1);
    }
  } catch {
    // If git status fails, proceed anyway
  }

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
    console.error('\nError: git pull failed.');
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
    console.error('\n  Error: Build step failed. The app may be in a broken state.');
    console.error(`  Try running manually: cd ${ROOT} && npm run build`);
    process.exitCode = 1;
  }

  // 5. Report
  const newHash = getCommitHash();
  console.log(`\nUpdated from ${oldHash} to ${newHash} (${commitCount} commit${commitCount === 1 ? '' : 's'})`);

  // Reset the update check cache
  clearCache();
}

// ────────────────────────────────────────────────────────────
// Startup update check (non-blocking, cached)
// ────────────────────────────────────────────────────────────

/**
 * Read the cached update check result.
 * @param {string} [cacheFile] - Override cache file path (for testing)
 * @returns {{ count: number, checkedAt: number } | null}
 */
function readCache(cacheFile = CACHE_FILE) {
  try {
    if (!existsSync(cacheFile)) return null;
    const data = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (typeof data.count !== 'number' || typeof data.checkedAt !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Write update check result to cache.
 * @param {number} count
 * @param {object} [opts] - Override cache paths (for testing)
 * @param {string} [opts.dir] - Cache directory
 * @param {string} [opts.file] - Cache file path
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
 * @param {string} [cacheFile] - Override cache file path (for testing)
 */
function clearCache(cacheFile = CACHE_FILE) {
  try {
    if (existsSync(cacheFile)) {
      writeFileSync(cacheFile, JSON.stringify({ count: 0, checkedAt: Date.now() }));
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
  // Exported for testing
  getCommitHash,
  getPackageVersion,
  getDefaultBranch,
  readCache,
  writeCache,
  clearCache,
  printUpdateNotice,
  ROOT,
  CACHE_DIR,
  CACHE_FILE,
  CACHE_TTL_MS,
};
