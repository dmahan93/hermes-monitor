import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { WorktreeManager } from '../src/worktree-manager.js';
import type { HealthCheckResult } from '../src/worktree-manager.js';
import { config, updateConfig } from '../src/config.js';
import { existsSync, lstatSync, readlinkSync, mkdirSync, rmSync, writeFileSync, symlinkSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

/**
 * Tests for WorktreeManager core operations (create, remove, get, setupDeps).
 *
 * ISOLATION STRATEGY:
 * Each test creates a throwaway git repo in a temp directory and points
 * config.repoPath at it. This ensures branch/worktree operations never touch
 * the real repository. The worktreeBase is also pointed at a temp directory.
 * Everything is cleaned up in afterEach — no stale worktrees or branches
 * are left behind.
 *
 * Tests mutate global config via updateConfig(). This is safe because vitest
 * runs test files in separate workers, but tests within this file must NOT run
 * concurrently (no .concurrent) as they'd stomp on each other's config state.
 */

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
}

/**
 * Create a minimal throwaway git repo with one commit and a dummy node_modules
 * directory. The repo includes a package.json so worktree path assertions pass.
 */
function createScratchRepo(): string {
  const repoPath = join(
    tmpdir(),
    `hermes-wt-mgr-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(repoPath, { recursive: true });
  git(['init', '--initial-branch=master'], repoPath);
  git(['config', 'user.email', 'test@test.com'], repoPath);
  git(['config', 'user.name', 'Test'], repoPath);
  // Need at least one commit so branches can be created
  writeFileSync(join(repoPath, 'package.json'), '{"name":"test"}\n');
  writeFileSync(join(repoPath, 'README.md'), '# Test repo\n');
  git(['add', '.'], repoPath);
  git(['commit', '-m', 'initial commit'], repoPath);
  // Create a dummy node_modules so symlink tests work without the real repo
  mkdirSync(join(repoPath, 'node_modules'), { recursive: true });
  return repoPath;
}

describe('WorktreeManager', () => {
  let manager: WorktreeManager;
  let testWorktreeBase: string;
  let testRepoPath: string;
  let originalWorktreeBase: string;
  let originalRepoPath: string;
  let originalTargetBranch: string;

  beforeEach(() => {
    // Create isolated temp dirs for both worktrees and the git repo
    testWorktreeBase = join(
      tmpdir(),
      `hermes-wt-mgr-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    mkdirSync(testWorktreeBase, { recursive: true });
    testRepoPath = createScratchRepo();

    // Save originals and swap config to isolated paths
    originalWorktreeBase = config.worktreeBase;
    originalRepoPath = config.repoPath;
    originalTargetBranch = config.targetBranch;
    updateConfig({
      worktreeBase: testWorktreeBase,
      repoPath: testRepoPath,
      targetBranch: 'master',
    });

    manager = new WorktreeManager();
  });

  afterEach(() => {
    // Restore original config
    updateConfig({
      worktreeBase: originalWorktreeBase,
      repoPath: originalRepoPath,
      targetBranch: originalTargetBranch,
    });

    // Clean up worktrees before removing the repo (git complains otherwise)
    try {
      git(['worktree', 'prune'], testRepoPath);
    } catch {}

    // Remove temp directories
    try { rmSync(testWorktreeBase, { recursive: true, force: true }); } catch {}
    try { rmSync(testRepoPath, { recursive: true, force: true }); } catch {}
  });

  it('creates a worktree with branch', () => {
    const id = 'test-wt-' + Date.now();
    const info = manager.create(id, 'Test worktree creation');
    expect(info.branch).toContain('issue/');
    expect(info.branch).toContain('test-worktree-creation');
    expect(info.path).toContain(id);
    expect(existsSync(info.path)).toBe(true);
  });

  it('worktree path exists on disk', () => {
    const id = 'test-wt-path-' + Date.now();
    const info = manager.create(id, 'Path test');
    expect(existsSync(info.path)).toBe(true);
    // Should contain repo files
    expect(existsSync(`${info.path}/package.json`)).toBe(true);
  });

  it('removes a worktree', () => {
    const id = 'test-wt-rm-' + Date.now();
    const info = manager.create(id, 'Remove test');
    expect(existsSync(info.path)).toBe(true);
    manager.remove(id, true);
    // Directory should be gone
    expect(existsSync(info.path)).toBe(false);
    expect(manager.get(id)).toBeUndefined();
  });

  it('get returns worktree info', () => {
    const id = 'test-wt-get-' + Date.now();
    manager.create(id, 'Get test');
    const info = manager.get(id);
    expect(info).toBeDefined();
    expect(info!.issueId).toBe(id);
    expect(info!.branch).toBeTruthy();
    expect(info!.path).toBeTruthy();
  });

  it('creates worktree with node_modules symlink', () => {
    const id = 'test-wt-deps-' + Date.now();
    const info = manager.create(id, 'Deps test');
    const nodeModulesPath = join(info.path, 'node_modules');
    const expectedTarget = resolve(join(testRepoPath, 'node_modules'));

    // node_modules should exist as a symlink pointing to the scratch repo
    expect(existsSync(nodeModulesPath)).toBe(true);
    const stat = lstatSync(nodeModulesPath);
    expect(stat.isSymbolicLink()).toBe(true);
    const target = readlinkSync(nodeModulesPath);
    expect(target).toBe(expectedTarget);
  });

  it('setupDeps is idempotent', () => {
    const id = 'test-wt-idempotent-' + Date.now();
    const info = manager.create(id, 'Idempotent test');
    const nodeModulesPath = join(info.path, 'node_modules');
    const expectedTarget = resolve(join(testRepoPath, 'node_modules'));

    // Verify initial symlink
    expect(existsSync(nodeModulesPath)).toBe(true);
    const targetBefore = readlinkSync(nodeModulesPath);
    expect(targetBefore).toBe(expectedTarget);

    // Call setupDeps again — should not throw and symlink should be unchanged
    manager.setupDeps(info.path);

    expect(existsSync(nodeModulesPath)).toBe(true);
    const targetAfter = readlinkSync(nodeModulesPath);
    expect(targetAfter).toBe(expectedTarget);
  });
});

describe('WorktreeManager.healthCheck', () => {
  let manager: WorktreeManager;
  let testWorktreeBase: string;
  let testRepoPath: string;
  let originalWorktreeBase: string;
  let originalRepoPath: string;
  let originalTargetBranch: string;

  beforeEach(() => {
    testWorktreeBase = join(
      tmpdir(),
      `hermes-wt-hc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    mkdirSync(testWorktreeBase, { recursive: true });
    testRepoPath = createScratchRepo();

    originalWorktreeBase = config.worktreeBase;
    originalRepoPath = config.repoPath;
    originalTargetBranch = config.targetBranch;
    updateConfig({
      worktreeBase: testWorktreeBase,
      repoPath: testRepoPath,
      targetBranch: 'master',
    });

    manager = new WorktreeManager();
  });

  afterEach(() => {
    updateConfig({
      worktreeBase: originalWorktreeBase,
      repoPath: originalRepoPath,
      targetBranch: originalTargetBranch,
    });

    try { git(['worktree', 'prune'], testRepoPath); } catch {}
    try { rmSync(testWorktreeBase, { recursive: true, force: true }); } catch {}
    try { rmSync(testRepoPath, { recursive: true, force: true }); } catch {}
  });

  it('returns healthy for a clean worktree', () => {
    const id = 'hc-clean-' + Date.now();
    manager.create(id, 'Clean worktree');
    const result = manager.healthCheck(id);
    expect(result.healthy).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.fixes).toHaveLength(0);
  });

  it('returns unhealthy when no worktree is registered', () => {
    const result = manager.healthCheck('nonexistent');
    expect(result.healthy).toBe(false);
    expect(result.issues).toContain('No worktree registered for this issue');
  });

  it('stores and retrieves health check results', () => {
    const id = 'hc-store-' + Date.now();
    manager.create(id, 'Store test');
    const result = manager.healthCheck(id);

    const retrieved = manager.getHealthCheck(id);
    expect(retrieved).toBeDefined();
    expect(retrieved).toEqual(result);
  });

  it('getHealthCheck returns undefined when no check has been run', () => {
    expect(manager.getHealthCheck('never-checked')).toBeUndefined();
  });

  it('fixes wrong branch by checking out the correct one', () => {
    const id = 'hc-branch-' + Date.now();
    const info = manager.create(id, 'Branch test');

    // Create a throwaway branch and switch to it (can't checkout master — it's
    // already used by the main repo worktree)
    git(['checkout', '-b', 'wrong-branch'], info.path);

    const result = manager.healthCheck(id);
    expect(result.healthy).toBe(true);
    expect(result.issues.some((i) => i.includes('Wrong branch'))).toBe(true);
    expect(result.fixes.some((f) => f.includes('Checked out correct branch'))).toBe(true);

    // Verify the branch was actually switched back
    const currentBranch = git(['branch', '--show-current'], info.path);
    expect(currentBranch).toBe(info.branch);
  });

  it('fixes missing node_modules by re-symlinking', () => {
    const id = 'hc-nm-' + Date.now();
    const info = manager.create(id, 'Node modules test');
    const nodeModulesPath = join(info.path, 'node_modules');

    // Remove node_modules symlink
    rmSync(nodeModulesPath);
    expect(existsSync(nodeModulesPath)).toBe(false);

    const result = manager.healthCheck(id);
    expect(result.healthy).toBe(true);
    expect(result.issues.some((i) => i.includes('node_modules missing'))).toBe(true);
    expect(result.fixes.some((f) => f.includes('Re-symlinked node_modules'))).toBe(true);

    // Verify node_modules was re-created
    expect(existsSync(nodeModulesPath)).toBe(true);
    const stat = lstatSync(nodeModulesPath);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('fixes broken node_modules symlink', () => {
    const id = 'hc-broken-nm-' + Date.now();
    const info = manager.create(id, 'Broken symlink test');
    const nodeModulesPath = join(info.path, 'node_modules');

    // Replace symlink with one pointing to nonexistent path
    rmSync(nodeModulesPath);
    symlinkSync('/tmp/nonexistent-path-' + Date.now(), nodeModulesPath, 'dir');

    const result = manager.healthCheck(id);
    expect(result.healthy).toBe(true);
    expect(result.issues.some((i) => i.includes('node_modules'))).toBe(true);
    expect(result.fixes.some((f) => f.includes('Re-symlinked node_modules'))).toBe(true);

    // Verify it now points to the correct location
    expect(existsSync(nodeModulesPath)).toBe(true);
    const target = readlinkSync(nodeModulesPath);
    expect(target).toBe(resolve(join(testRepoPath, 'node_modules')));
  });

  it('recreates worktree when directory is missing', () => {
    const id = 'hc-missing-dir-' + Date.now();
    const info = manager.create(id, 'Missing dir test');

    // Remove the worktree directory manually
    git(['worktree', 'remove', info.path, '--force'], testRepoPath);

    const result = manager.healthCheck(id);
    expect(result.healthy).toBe(true);
    expect(result.issues.some((i) => i.includes('does not exist'))).toBe(true);
    expect(result.fixes.some((f) => f.includes('Recreated worktree'))).toBe(true);

    // Verify the directory was recreated
    expect(existsSync(info.path)).toBe(true);
  });

  it('detects and aborts in-progress merge', () => {
    const id = 'hc-merge-' + Date.now();
    const info = manager.create(id, 'Merge test');

    // Create a conflicting commit on the issue branch
    writeFileSync(join(info.path, 'conflict.txt'), 'branch content\n');
    git(['add', 'conflict.txt'], info.path);
    git(['commit', '-m', 'add conflict file on branch'], info.path);

    // Create a conflicting commit on master
    writeFileSync(join(testRepoPath, 'conflict.txt'), 'master content\n');
    git(['add', 'conflict.txt'], testRepoPath);
    git(['commit', '-m', 'add conflict file on master'], testRepoPath);

    // Start a merge that will conflict
    try {
      git(['merge', 'master'], info.path);
    } catch {
      // Merge conflict expected
    }

    const result = manager.healthCheck(id);
    expect(result.issues.some((i) => i.includes('Merge conflicts') || i.includes('merge'))).toBe(true);
    expect(result.fixes.some((f) => f.includes('Aborted') || f.includes('Recreated'))).toBe(true);
  });

  it('healthy worktree with real node_modules directory (not symlink)', () => {
    const id = 'hc-real-nm-' + Date.now();
    const info = manager.create(id, 'Real node modules');
    const nodeModulesPath = join(info.path, 'node_modules');

    // Replace symlink with a real directory
    rmSync(nodeModulesPath);
    mkdirSync(nodeModulesPath, { recursive: true });

    const result = manager.healthCheck(id);
    expect(result.healthy).toBe(true);
    // Real directory is acceptable — no issues
    expect(result.issues).toHaveLength(0);
  });
});
