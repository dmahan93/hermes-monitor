import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { WorktreeManager } from '../src/worktree-manager.js';
import { config, updateConfig } from '../src/config.js';
import { existsSync, lstatSync, readlinkSync, mkdirSync, rmSync, writeFileSync } from 'fs';
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
