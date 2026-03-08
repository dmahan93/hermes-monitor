import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { join } from 'path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const require = createRequire(import.meta.url);

// We need to test the updater module, but it calls execSync/exec with git commands.
// We test pure functions (cache, version reading) with injectable paths,
// and verify git-dependent helpers against the real repo.

describe('CLI updater', () => {
  // ── Module loading ──
  const {
    getPackageVersion,
    getCommitHash,
    getDefaultBranch,
    showVersion,
    printUpdateNotice,
    readCache,
    writeCache,
    clearCache,
    ROOT,
    CACHE_DIR,
    CACHE_FILE,
    CACHE_TTL_MS,
  } = require('../../bin/lib/updater');

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
  });

  // ── getCommitHash ──

  describe('getCommitHash', () => {
    it('returns a short hash string', () => {
      const hash = getCommitHash();
      // Git short hash is typically 7-12 chars of hex
      expect(hash).toMatch(/^[0-9a-f]{7,12}$/);
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
  });

  // ── Cache functions (using temp dir to avoid polluting real ~/.hermes-monitor/) ──

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
      const data = readCache(testCacheFile);
      expect(data).not.toBeNull();
      expect(data!.count).toBe(5);
      expect(typeof data!.checkedAt).toBe('number');
      expect(Date.now() - data!.checkedAt).toBeLessThan(5000);
    });

    it('readCache returns null when cache file does not exist', () => {
      // testCacheFile hasn't been created — readCache should return null
      const data = readCache(testCacheFile);
      expect(data).toBeNull();
    });

    it('readCache returns null for malformed JSON', () => {
      mkdirSync(testCacheDir, { recursive: true });
      writeFileSync(testCacheFile, 'not valid json');
      const data = readCache(testCacheFile);
      expect(data).toBeNull();
    });

    it('readCache returns null when required fields are missing', () => {
      mkdirSync(testCacheDir, { recursive: true });
      writeFileSync(testCacheFile, JSON.stringify({ count: 5 })); // missing checkedAt
      const data = readCache(testCacheFile);
      expect(data).toBeNull();
    });

    it('clearCache resets count to 0', () => {
      writeCache(10, { dir: testCacheDir, file: testCacheFile });
      clearCache(testCacheFile);
      const data = readCache(testCacheFile);
      expect(data).not.toBeNull();
      expect(data!.count).toBe(0);
    });

    it('clearCache is a no-op when file does not exist', () => {
      // Should not throw, should not create the file
      clearCache(testCacheFile);
      expect(existsSync(testCacheFile)).toBe(false);
    });

    it('writeCache overwrites previous value', () => {
      writeCache(3, { dir: testCacheDir, file: testCacheFile });
      writeCache(7, { dir: testCacheDir, file: testCacheFile });
      const data = readCache(testCacheFile);
      expect(data!.count).toBe(7);
    });

    it('writeCache stores a recent timestamp', () => {
      const before = Date.now();
      writeCache(1, { dir: testCacheDir, file: testCacheFile });
      const after = Date.now();
      const data = readCache(testCacheFile);
      expect(data!.checkedAt).toBeGreaterThanOrEqual(before);
      expect(data!.checkedAt).toBeLessThanOrEqual(after);
    });
  });

  // ── showVersion ──

  describe('showVersion', () => {
    it('prints version and commit hash to stdout', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        showVersion();
        expect(logSpy).toHaveBeenCalled();
        const firstCall = logSpy.mock.calls[0][0] as string;
        expect(firstCall).toMatch(/hermes-monitor v\d+\.\d+\.\d+ \([0-9a-f]+\)/);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('shows update status without hitting the network', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        showVersion();
        // Should have printed at least 2 lines: version + status
        expect(logSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
        const allOutput = logSpy.mock.calls.map(c => c[0]).join('\n');
        // Should contain one of these status messages
        const hasStatus = allOutput.includes('Up to date') ||
                          allOutput.includes('available') ||
                          allOutput.includes('Update status unknown');
        expect(hasStatus).toBe(true);
      } finally {
        logSpy.mockRestore();
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
