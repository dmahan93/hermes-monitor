import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);

// We test the updater module: pure functions use injectable paths,
// git-dependent helpers are tested against real temp repos.

describe('CLI updater', () => {
  // ── Module loading ──
  const {
    getPackageVersion,
    getCommitHash,
    getDefaultBranch,
    showVersion,
    performUpdate,
    checkForUpdatesInBackground,
    UpdateError,
    printUpdateNotice,
    checkBranchSafety,
    checkDirtyTree,
    acquireLock,
    releaseLock,
    readCache,
    writeCache,
    clearCache,
    shellescape,
    shellQuotePath,
    ROOT,
    CACHE_DIR,
    CACHE_FILE,
    LOCK_FILE,
    CACHE_TTL_MS,
  } = require('../../bin/lib/updater');

  // ── Helper: create a temp git repo ──

  function createTempGitRepo(): string {
    const dir = join(tmpdir(), `hermes-test-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "initial commit"', { cwd: dir, stdio: 'pipe' });
    return dir;
  }

  // ── getPackageVersion ──

  describe('getPackageVersion', () => {
    it('returns a semver-like version string', () => {
      const version = getPackageVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('matches the version in package.json', () => {
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
      expect(getPackageVersion()).toBe(pkg.version);
    });

    it('returns 0.0.0 for non-existent directory', () => {
      expect(getPackageVersion('/nonexistent/path')).toBe('0.0.0');
    });
  });

  // ── getCommitHash ──

  describe('getCommitHash', () => {
    it('returns a short hash string', () => {
      const hash = getCommitHash();
      // Git short hash is typically 7-12 chars of hex
      expect(hash).toMatch(/^[0-9a-f]{7,12}$/);
    });

    it('returns unknown for non-git directory', () => {
      const tmpDir = join(tmpdir(), `hermes-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      try {
        expect(getCommitHash(tmpDir)).toBe('unknown');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ── getDefaultBranch ──

  describe('getDefaultBranch', () => {
    it('returns a non-empty string', () => {
      const branch = getDefaultBranch();
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
    });

    it('returns a common branch name (master or main)', () => {
      const branch = getDefaultBranch();
      expect(['master', 'main']).toContain(branch);
    });

    it('returns master as fallback for repo without remote', () => {
      const dir = createTempGitRepo();
      try {
        const branch = getDefaultBranch(dir);
        expect(branch).toBe('master');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ── shellescape ──

  describe('shellescape', () => {
    it('passes through safe branch names', () => {
      expect(shellescape('master')).toBe('master');
      expect(shellescape('main')).toBe('main');
      expect(shellescape('feature/my-branch')).toBe('feature/my-branch');
    });

    it('strips unsafe characters', () => {
      // Strips semicolons, spaces, $, parens, backticks, etc.
      expect(shellescape('branch; rm -rf /')).toBe('branchrm-rf/');
      expect(shellescape('branch$(echo bad)')).toBe('branchechobad');
      expect(shellescape('branch`cmd`')).toBe('branchcmd');
    });

    it('handles empty string', () => {
      expect(shellescape('')).toBe('');
    });
  });

  // ── checkBranchSafety ──

  describe('checkBranchSafety', () => {
    let repoDir: string;

    beforeEach(() => {
      repoDir = createTempGitRepo();
    });

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true });
    });

    it('returns ok when on the expected branch', () => {
      // Default branch after git init is usually master or main
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
      const result = checkBranchSafety(currentBranch, repoDir);
      expect(result.ok).toBe(true);
      expect(result.currentBranch).toBe(currentBranch);
    });

    it('returns error when on a different branch', () => {
      execSync('git checkout -b feature-branch', { cwd: repoDir, stdio: 'pipe' });
      const result = checkBranchSafety('master', repoDir);
      expect(result.ok).toBe(false);
      expect(result.currentBranch).toBe('feature-branch');
      expect(result.error).toContain('not on the \'master\' branch');
      expect(result.error).toContain('feature-branch');
    });

    it('returns error for non-git directory', () => {
      const tmpDir = join(tmpdir(), `hermes-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      try {
        const result = checkBranchSafety('master', tmpDir);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('Could not determine');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ── checkDirtyTree ──

  describe('checkDirtyTree', () => {
    let repoDir: string;

    beforeEach(() => {
      repoDir = createTempGitRepo();
    });

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true });
    });

    it('returns ok for clean working tree', () => {
      const result = checkDirtyTree(repoDir);
      expect(result.ok).toBe(true);
    });

    it('returns error for dirty working tree', () => {
      writeFileSync(join(repoDir, 'dirty-file.txt'), 'uncommitted change');
      const result = checkDirtyTree(repoDir);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('uncommitted changes');
    });

    it('returns ok for non-git directory (fail-open)', () => {
      const tmpDir = join(tmpdir(), `hermes-test-${Date.now()}`);
      mkdirSync(tmpDir, { recursive: true });
      try {
        const result = checkDirtyTree(tmpDir);
        expect(result.ok).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ── Lock file ──

  describe('lock file', () => {
    let testCacheDir: string;
    let testLockFile: string;

    beforeEach(() => {
      testCacheDir = join(tmpdir(), `hermes-monitor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      testLockFile = join(testCacheDir, 'update.lock');
    });

    afterEach(() => {
      try {
        rmSync(testCacheDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('acquires lock when no lock exists', () => {
      const acquired = acquireLock({ dir: testCacheDir, file: testLockFile });
      expect(acquired).toBe(true);
      expect(existsSync(testLockFile)).toBe(true);
    });

    it('rejects when lock already exists', () => {
      acquireLock({ dir: testCacheDir, file: testLockFile });
      const second = acquireLock({ dir: testCacheDir, file: testLockFile });
      expect(second).toBe(false);
    });

    it('releases lock', () => {
      acquireLock({ dir: testCacheDir, file: testLockFile });
      releaseLock({ file: testLockFile });
      expect(existsSync(testLockFile)).toBe(false);
    });

    it('lock can be re-acquired after release', () => {
      acquireLock({ dir: testCacheDir, file: testLockFile });
      releaseLock({ file: testLockFile });
      const reacquired = acquireLock({ dir: testCacheDir, file: testLockFile });
      expect(reacquired).toBe(true);
    });

    it('release is a no-op when no lock exists', () => {
      // Should not throw
      releaseLock({ file: testLockFile });
    });
  });

  // ── Cache functions (using temp dir) ──

  describe('cache', () => {
    let testCacheDir: string;
    let testCacheFile: string;

    beforeEach(() => {
      testCacheDir = join(tmpdir(), `hermes-monitor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      testCacheFile = join(testCacheDir, 'update-check.json');
    });

    afterEach(() => {
      try {
        rmSync(testCacheDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('CACHE_TTL_MS is 1 hour', () => {
      expect(CACHE_TTL_MS).toBe(60 * 60 * 1000);
    });

    it('CACHE_FILE is under ~/.hermes-monitor/', () => {
      expect(CACHE_FILE).toContain('.hermes-monitor');
      expect(CACHE_FILE).toContain('update-check.json');
    });

    it('CACHE_DIR is under home directory', () => {
      expect(CACHE_DIR).toContain('.hermes-monitor');
    });

    it('writeCache creates the cache directory and file', () => {
      writeCache(5, { dir: testCacheDir, file: testCacheFile });
      expect(existsSync(testCacheFile)).toBe(true);
      const data = readCache({ file: testCacheFile });
      expect(data).not.toBeNull();
      expect(data!.count).toBe(5);
      expect(typeof data!.checkedAt).toBe('number');
      expect(Date.now() - data!.checkedAt).toBeLessThan(5000);
    });

    it('readCache returns null when cache file does not exist', () => {
      // testCacheFile hasn't been created — readCache should return null
      const data = readCache({ file: testCacheFile });
      expect(data).toBeNull();
    });

    it('readCache returns null for malformed JSON', () => {
      mkdirSync(testCacheDir, { recursive: true });
      writeFileSync(testCacheFile, 'not valid json');
      const data = readCache({ file: testCacheFile });
      expect(data).toBeNull();
    });

    it('readCache returns null when required fields are missing', () => {
      mkdirSync(testCacheDir, { recursive: true });
      writeFileSync(testCacheFile, JSON.stringify({ count: 5 })); // missing checkedAt
      const data = readCache({ file: testCacheFile });
      expect(data).toBeNull();
    });

    it('clearCache resets count to 0', () => {
      writeCache(10, { dir: testCacheDir, file: testCacheFile });
      clearCache({ file: testCacheFile });
      const data = readCache({ file: testCacheFile });
      expect(data).not.toBeNull();
      expect(data!.count).toBe(0);
    });

    it('clearCache is a no-op when file does not exist', () => {
      // Should not throw, should not create the file
      clearCache({ file: testCacheFile });
      expect(existsSync(testCacheFile)).toBe(false);
    });

    it('writeCache overwrites previous value', () => {
      writeCache(3, { dir: testCacheDir, file: testCacheFile });
      writeCache(7, { dir: testCacheDir, file: testCacheFile });
      const data = readCache({ file: testCacheFile });
      expect(data!.count).toBe(7);
    });

    it('writeCache stores a recent timestamp', () => {
      const before = Date.now();
      writeCache(1, { dir: testCacheDir, file: testCacheFile });
      const after = Date.now();
      const data = readCache({ file: testCacheFile });
      expect(data!.checkedAt).toBeGreaterThanOrEqual(before);
      expect(data!.checkedAt).toBeLessThanOrEqual(after);
    });
  });

  // ── showVersion (deterministic with injected cache) ──

  describe('showVersion', () => {
    let testCacheDir: string;
    let testCacheFile: string;

    beforeEach(() => {
      testCacheDir = join(tmpdir(), `hermes-monitor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      testCacheFile = join(testCacheDir, 'update-check.json');
    });

    afterEach(() => {
      try {
        rmSync(testCacheDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('prints version and commit hash to stdout', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        showVersion({ cacheFile: testCacheFile });
        expect(logSpy).toHaveBeenCalled();
        const firstCall = logSpy.mock.calls[0][0] as string;
        expect(firstCall).toMatch(/hermes-monitor v\d+\.\d+\.\d+ \([0-9a-f]+\)/);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('shows "Update status unknown" when no cache exists', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        showVersion({ cacheFile: testCacheFile });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
        expect(allOutput).toContain('Update status unknown');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('shows "Up to date" when cache has count=0', () => {
      writeCache(0, { dir: testCacheDir, file: testCacheFile });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        showVersion({ cacheFile: testCacheFile });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
        expect(allOutput).toContain('Up to date');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('shows commit count when cache has updates', () => {
      writeCache(7, { dir: testCacheDir, file: testCacheFile });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        showVersion({ cacheFile: testCacheFile });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
        expect(allOutput).toContain('7 new commits available');
        expect(allOutput).toContain('hermes-monitor update');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('shows "Update status unknown" when cache is expired', () => {
      // Write a cache entry with an old timestamp
      mkdirSync(testCacheDir, { recursive: true });
      const staleData = { count: 5, checkedAt: Date.now() - (2 * 60 * 60 * 1000) }; // 2 hours ago
      writeFileSync(testCacheFile, JSON.stringify(staleData));

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        showVersion({ cacheFile: testCacheFile });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
        expect(allOutput).toContain('Update status unknown');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('uses singular "commit" for 1 update', () => {
      writeCache(1, { dir: testCacheDir, file: testCacheFile });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        showVersion({ cacheFile: testCacheFile });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
        expect(allOutput).toContain('1 new commit available');
        expect(allOutput).not.toContain('1 new commits');
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  // ── checkForUpdatesInBackground (cached path) ──

  describe('checkForUpdatesInBackground', () => {
    let testCacheDir: string;
    let testCacheFile: string;

    beforeEach(() => {
      testCacheDir = join(tmpdir(), `hermes-monitor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      testCacheFile = join(testCacheDir, 'update-check.json');
    });

    afterEach(() => {
      try {
        rmSync(testCacheDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('prints notice to stderr when cache shows updates available', () => {
      writeCache(3, { dir: testCacheDir, file: testCacheFile });
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        checkForUpdatesInBackground({ cacheFile: testCacheFile });
        expect(stderrSpy).toHaveBeenCalled();
        const output = stderrSpy.mock.calls[0][0] as string;
        expect(output).toContain('3 new commits available');
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('does not print notice when cache shows 0 updates', () => {
      writeCache(0, { dir: testCacheDir, file: testCacheFile });
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        checkForUpdatesInBackground({ cacheFile: testCacheFile });
        expect(stderrSpy).not.toHaveBeenCalled();
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('does not print notice when no cache exists (triggers async check)', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        // No cache — will try async fetch, which we don't test here
        checkForUpdatesInBackground({ cacheFile: testCacheFile });
        // Should NOT have printed synchronously
        expect(stderrSpy).not.toHaveBeenCalled();
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });

  // ── printUpdateNotice ──

  describe('printUpdateNotice', () => {
    it('writes to stderr (not stdout)', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        printUpdateNotice(5);
        expect(stderrSpy).toHaveBeenCalled();
        // Verify console.log was NOT called (output goes to stderr)
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        stderrSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it('includes commit count and update command', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        printUpdateNotice(5);
        const output = (stderrSpy.mock.calls[0][0] as string);
        expect(output).toContain('5 new commits available');
        expect(output).toContain('hermes-monitor update');
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('uses singular form for 1 commit', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        printUpdateNotice(1);
        const output = (stderrSpy.mock.calls[0][0] as string);
        expect(output).toContain('1 new commit available');
        // Should NOT say "commits" (plural)
        expect(output).not.toContain('1 new commits');
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('uses plural form for multiple commits', () => {
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        printUpdateNotice(12);
        const output = (stderrSpy.mock.calls[0][0] as string);
        expect(output).toContain('12 new commits available');
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });

  // ── performUpdate (integration tests with temp git repos) ──
  //
  // These tests do NOT mock process.exit(). The performUpdate() function uses
  // process.exitCode (soft) and return/throw instead of process.exit() (hard).
  // This is critical: process.exit() skips finally blocks, so using it inside
  // _performUpdateInner would leak the lock file. By avoiding process.exit(),
  // the try/catch/finally in performUpdate() always releases the lock.

  describe('performUpdate', () => {
    let repoDir: string;
    let testLockDir: string;
    let testLockFile: string;
    let savedExitCode: string | number | undefined;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      repoDir = createTempGitRepo();
      testLockDir = join(tmpdir(), `hermes-monitor-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      testLockFile = join(testLockDir, 'update.lock');
      savedExitCode = process.exitCode;
      process.exitCode = undefined;
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      process.exitCode = savedExitCode;
      errorSpy.mockRestore();
      logSpy.mockRestore();
      try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(testLockDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('sets exitCode to 1 when not on the default branch', () => {
      execSync('git checkout -b feature-branch', { cwd: repoDir, stdio: 'pipe' });

      performUpdate({ root: repoDir, lockDir: testLockDir, lockFile: testLockFile });

      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allErrors).toContain('not on the');
      expect(allErrors).toContain('feature-branch');
    });

    it('sets exitCode to 1 when working tree is dirty', () => {
      writeFileSync(join(repoDir, 'dirty.txt'), 'uncommitted');

      performUpdate({ root: repoDir, lockDir: testLockDir, lockFile: testLockFile });

      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allErrors).toContain('uncommitted changes');
      expect(allErrors).toContain('git stash');
    });

    it('sets exitCode to 1 when lock is already held', () => {
      acquireLock({ dir: testLockDir, file: testLockFile });

      performUpdate({ root: repoDir, lockDir: testLockDir, lockFile: testLockFile });

      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allErrors).toContain('Another update is already in progress');
    });

    it('releases lock when inner update fails (UpdateError, no process.exit)', () => {
      // The repo has no remote, so _performUpdateInner throws UpdateError.
      // The try/catch/finally in performUpdate catches the error and releases
      // the lock — this works because we throw instead of calling process.exit().
      performUpdate({ root: repoDir, lockDir: testLockDir, lockFile: testLockFile });

      // Lock should be released (file should not exist)
      expect(existsSync(testLockFile)).toBe(false);
      expect(process.exitCode).toBe(1);
    });

    it('branch safety check runs before dirty tree check', () => {
      // Both conditions are true: wrong branch AND dirty tree
      execSync('git checkout -b feature-branch', { cwd: repoDir, stdio: 'pipe' });
      writeFileSync(join(repoDir, 'dirty.txt'), 'uncommitted');

      performUpdate({ root: repoDir, lockDir: testLockDir, lockFile: testLockFile });

      expect(process.exitCode).toBe(1);
      // Should fail on branch check first (not dirty tree)
      const allErrors = errorSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allErrors).toContain('not on the');
      expect(allErrors).not.toContain('uncommitted changes');
    });

    it('dirty tree check runs before lock acquisition', () => {
      // Dirty tree, but lock already held — should fail on dirty tree, not lock
      writeFileSync(join(repoDir, 'dirty.txt'), 'uncommitted');
      acquireLock({ dir: testLockDir, file: testLockFile });

      performUpdate({ root: repoDir, lockDir: testLockDir, lockFile: testLockFile });

      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allErrors).toContain('uncommitted changes');
      expect(allErrors).not.toContain('Another update');
    });

    it('proceeds past safety checks on clean default branch (fails at fetch with no remote)', () => {
      // Repo is clean, on default branch — should pass safety checks
      // then fail at git fetch or rev-list since there's no remote
      performUpdate({ root: repoDir, lockDir: testLockDir, lockFile: testLockFile });

      expect(process.exitCode).toBe(1);
      // Should have gotten past safety checks and reached the update step
      const allErrors = errorSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allErrors).toContain('Failed');
      expect(allErrors).not.toContain('not on the');
      expect(allErrors).not.toContain('uncommitted changes');
      expect(allErrors).not.toContain('Another update');
    });

    it('lock can be re-acquired after failed update (validates lock was fully released)', () => {
      // This is the critical regression test for the lock leak fix.
      // Previously, _performUpdateInner called process.exit() directly,
      // which skips finally blocks — the lock file would persist for up
      // to 10 minutes (stale lock timeout). Now it throws UpdateError,
      // which is caught by performUpdate's try/catch/finally.
      //
      // This test runs performUpdate WITHOUT mocking process.exit at all,
      // verifying the lock cleanup works as production code would run.
      performUpdate({ root: repoDir, lockDir: testLockDir, lockFile: testLockFile });

      // Lock file should not exist
      expect(existsSync(testLockFile)).toBe(false);

      // Verify we can re-acquire the lock (proves it was properly released,
      // not just that the file was deleted by some other mechanism)
      const reacquired = acquireLock({ dir: testLockDir, file: testLockFile });
      expect(reacquired).toBe(true);
      releaseLock({ file: testLockFile });
    });
  });

  // ── ROOT ──

  describe('ROOT', () => {
    it('points to a directory with package.json', () => {
      expect(existsSync(join(ROOT, 'package.json'))).toBe(true);
    });

    it('package.json has name hermes-monitor', () => {
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
      expect(pkg.name).toBe('hermes-monitor');
    });
  });
});
