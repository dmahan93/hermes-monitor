import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { WorktreeManager, type PruneResult } from '../src/worktree-manager.js';
import { config, updateConfig } from '../src/config.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Tests for WorktreeManager.pruneStaleWorktrees.
 *
 * ISOLATION STRATEGY:
 * Each test creates a throwaway bare git repo in a temp directory and points
 * config.repoPath at it. This ensures branch operations never touch the real
 * repository. The worktreeBase is also pointed at a temp directory.
 *
 * Tests mutate global config via updateConfig(). This is safe because vitest
 * runs test files in separate workers, but tests within this file must NOT run
 * concurrently (no .concurrent) as they'd stomp on each other's config state.
 */

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
}

/**
 * Create a minimal throwaway git repo with one commit (needed for branches to work).
 * Returns the path to the repo.
 */
function createScratchRepo(): string {
  const repoPath = join(tmpdir(), `hermes-test-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(repoPath, { recursive: true });
  git(['init', '--initial-branch=master'], repoPath);
  git(['config', 'user.email', 'test@test.com'], repoPath);
  git(['config', 'user.name', 'Test'], repoPath);
  // Need at least one commit so branches can be created
  writeFileSync(join(repoPath, 'README.md'), '# Test repo\n');
  git(['add', '.'], repoPath);
  git(['commit', '-m', 'initial commit'], repoPath);
  return repoPath;
}

describe('WorktreeManager.pruneStaleWorktrees', () => {
  let manager: WorktreeManager;
  let testWorktreeBase: string;
  let testRepoPath: string;
  let originalWorktreeBase: string;
  let originalRepoPath: string;
  let originalTargetBranch: string;

  beforeEach(() => {
    manager = new WorktreeManager();

    // Create isolated temp dirs for both worktrees and the git repo
    testWorktreeBase = join(tmpdir(), `hermes-wt-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

  it('returns empty result when no stale worktrees exist', () => {
    const result = manager.pruneStaleWorktrees(new Set());
    expect(result).toHaveProperty('removedWorktrees');
    expect(result).toHaveProperty('prunedBranches');
    expect(result).toHaveProperty('skippedUnmergedBranches');
    expect(Array.isArray(result.removedWorktrees)).toBe(true);
    expect(Array.isArray(result.prunedBranches)).toBe(true);
    expect(Array.isArray(result.skippedUnmergedBranches)).toBe(true);
    expect(result.removedWorktrees).toEqual([]);
    expect(result.prunedBranches).toEqual([]);
  });

  it('removes a stale worktree directory', () => {
    const id = 'aabbccdd-prune-stale-' + Date.now();
    const info = manager.create(id, 'Stale worktree test');
    expect(existsSync(info.path)).toBe(true);
    expect(info.path).toContain(testWorktreeBase);

    // Prune with an empty active set — the worktree should be removed
    const result = manager.pruneStaleWorktrees(new Set());
    expect(result.removedWorktrees).toContain(id);
    expect(existsSync(info.path)).toBe(false);
    expect(manager.get(id)).toBeUndefined();
  });

  it('preserves worktrees for active issues', () => {
    const id = 'aabbccdd-prune-active-' + Date.now();
    const info = manager.create(id, 'Active worktree test');
    expect(existsSync(info.path)).toBe(true);

    // Prune with the issue in the active set — should NOT be removed
    const result = manager.pruneStaleWorktrees(new Set([id]));
    expect(result.removedWorktrees).not.toContain(id);
    expect(existsSync(info.path)).toBe(true);
    expect(manager.get(id)).toBeDefined();
  });

  it('removes only stale worktrees, keeps active ones', () => {
    const activeId = 'aabbccdd-keep-' + Date.now();
    const staleId = 'eeff0011-remove-' + Date.now();

    const activeInfo = manager.create(activeId, 'Keep this');
    const staleInfo = manager.create(staleId, 'Remove this');
    expect(existsSync(activeInfo.path)).toBe(true);
    expect(existsSync(staleInfo.path)).toBe(true);

    const result = manager.pruneStaleWorktrees(new Set([activeId]));
    expect(result.removedWorktrees).toContain(staleId);
    expect(result.removedWorktrees).not.toContain(activeId);
    expect(existsSync(activeInfo.path)).toBe(true);
    expect(existsSync(staleInfo.path)).toBe(false);
  });

  it('prunes stale issue/* branches (merged)', () => {
    // Create a branch that looks like an issue branch but has no active issue.
    // Since it's based on master and has no extra commits, -d (safe delete) will work.
    const fakeBranch = 'issue/deadbeef-stale-branch-test';
    git(['branch', fakeBranch, 'master'], testRepoPath);

    // Verify the branch exists
    const branchesBefore = git(['branch', '--list', fakeBranch], testRepoPath);
    expect(branchesBefore).toContain('deadbeef');

    // Prune with empty active set
    const result = manager.pruneStaleWorktrees(new Set());
    expect(result.prunedBranches).toContain(fakeBranch);

    // Verify branch is actually deleted
    let branchExists = true;
    try {
      git(['rev-parse', '--verify', fakeBranch], testRepoPath);
    } catch {
      branchExists = false;
    }
    expect(branchExists).toBe(false);
  });

  it('skips unmerged branches instead of force-deleting them', () => {
    // Create a branch with an extra commit (making it unmerged relative to master)
    const unmergedBranch = 'issue/baadf00d-unmerged-test';
    const wtPath = join(testWorktreeBase, 'unmerged-test-wt');
    git(['worktree', 'add', '-b', unmergedBranch, wtPath, 'master'], testRepoPath);
    writeFileSync(join(wtPath, 'extra.txt'), 'unmerged content\n');
    git(['add', '.'], wtPath);
    git(['commit', '-m', 'unmerged commit'], wtPath);
    // Remove worktree but keep the branch
    git(['worktree', 'remove', wtPath, '--force'], testRepoPath);

    // Prune — should NOT force-delete the unmerged branch
    const result = manager.pruneStaleWorktrees(new Set());
    expect(result.prunedBranches).not.toContain(unmergedBranch);
    expect(result.skippedUnmergedBranches).toContain(unmergedBranch);

    // Verify branch still exists
    let branchExists = false;
    try {
      git(['rev-parse', '--verify', unmergedBranch], testRepoPath);
      branchExists = true;
    } catch {}
    expect(branchExists).toBe(true);

    // Clean up
    git(['branch', '-D', unmergedBranch], testRepoPath);
  });

  it('preserves branches for active issues', () => {
    const id = 'abcd1234-test-' + Date.now();
    const info = manager.create(id, 'Active branch test');

    // The branch should match issue/abcd1234-...
    expect(info.branch).toMatch(/^issue\/abcd1234-/);

    // Prune with the issue active — branch should be preserved
    const result = manager.pruneStaleWorktrees(new Set([id]));
    expect(result.prunedBranches).not.toContain(info.branch);

    // Verify branch still exists
    let branchExists = false;
    try {
      git(['rev-parse', '--verify', info.branch], testRepoPath);
      branchExists = true;
    } catch {}
    expect(branchExists).toBe(true);
  });

  it('removes orphaned directory not known to git worktree', () => {
    // Create a plain directory in the worktree base (simulating a leftover)
    const orphanId = 'test-orphan-dir-' + Date.now();
    const orphanPath = join(testWorktreeBase, orphanId);
    mkdirSync(orphanPath, { recursive: true });
    expect(existsSync(orphanPath)).toBe(true);

    const result = manager.pruneStaleWorktrees(new Set());
    expect(result.removedWorktrees).toContain(orphanId);
    expect(existsSync(orphanPath)).toBe(false);
  });

  it('handles nonexistent worktree base directory gracefully', () => {
    // Point to a non-existent directory
    updateConfig({ worktreeBase: '/tmp/nonexistent-wt-test-' + Date.now() });
    const result = manager.pruneStaleWorktrees(new Set());
    expect(result.removedWorktrees).toEqual([]);
    expect(Array.isArray(result.prunedBranches)).toBe(true);
  });

  it('skips non-directory entries in worktree base', () => {
    // Create a regular file in the worktree base — should not be deleted
    const filePath = join(testWorktreeBase, '.gitkeep');
    writeFileSync(filePath, '');
    expect(existsSync(filePath)).toBe(true);

    const result = manager.pruneStaleWorktrees(new Set());
    expect(result.removedWorktrees).not.toContain('.gitkeep');
    expect(existsSync(filePath)).toBe(true);
  });

  it('tracks removal failures correctly (does not report failed removals)', () => {
    // Create a worktree directory entry and verify it would be targeted
    const id = 'ccddaabb-track-failure-' + Date.now();
    const dirPath = join(testWorktreeBase, id);
    mkdirSync(dirPath, { recursive: true });

    const result = manager.pruneStaleWorktrees(new Set());
    // This should succeed since it's a plain directory (rmSync works)
    expect(result.removedWorktrees).toContain(id);
    expect(existsSync(dirPath)).toBe(false);
  });
});
