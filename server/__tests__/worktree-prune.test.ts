import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { WorktreeManager, type PruneResult } from '../src/worktree-manager.js';
import { config, updateConfig } from '../src/config.js';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

// These tests need a real git repo — skip if not available.
// NOTE: Tests mutate global config via updateConfig(). This is safe because vitest
// runs test files in separate workers, but tests within this file must NOT run
// concurrently (no .concurrent) as they'd stomp on each other's config state.
const isGitRepo = (() => {
  try {
    execSync('git rev-parse --git-dir', { cwd: config.repoPath, stdio: 'pipe' });
    return true;
  } catch { return false; }
})();

describe('WorktreeManager.pruneStaleWorktrees', () => {
  let manager: WorktreeManager;
  const createdIds: string[] = [];
  const createdBranches: string[] = [];

  // Use an isolated temp directory for worktrees to avoid interfering
  // with real worktrees in the production worktreeBase
  let testWorktreeBase: string;
  let originalWorktreeBase: string;

  beforeEach(() => {
    manager = new WorktreeManager();
    testWorktreeBase = join(tmpdir(), `hermes-wt-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(testWorktreeBase, { recursive: true });
    originalWorktreeBase = config.worktreeBase;
    updateConfig({ worktreeBase: testWorktreeBase });
  });

  afterEach(() => {
    // Restore original worktree base
    updateConfig({ worktreeBase: originalWorktreeBase });

    // Clean up any worktrees we created
    for (const id of createdIds) {
      // Temporarily set worktreeBase to our test dir for cleanup
      updateConfig({ worktreeBase: testWorktreeBase });
      try { manager?.remove(id, true); } catch {}
      updateConfig({ worktreeBase: originalWorktreeBase });
    }
    createdIds.length = 0;

    // Clean up any manually created branches
    for (const branch of createdBranches) {
      try {
        execSync(`git branch -D ${branch}`, { cwd: config.repoPath, stdio: 'pipe' });
      } catch {}
    }
    createdBranches.length = 0;

    // Remove the test worktree base dir
    try {
      rmSync(testWorktreeBase, { recursive: true, force: true });
    } catch {}

    // Always prune git worktree state
    try {
      execSync('git worktree prune', { cwd: config.repoPath, stdio: 'pipe' });
    } catch {}
  });

  it('returns empty result when no stale worktrees exist', { skip: !isGitRepo }, () => {
    const result = manager.pruneStaleWorktrees(new Set());
    expect(result).toHaveProperty('removedWorktrees');
    expect(result).toHaveProperty('prunedBranches');
    expect(Array.isArray(result.removedWorktrees)).toBe(true);
    expect(Array.isArray(result.prunedBranches)).toBe(true);
  });

  it('removes a stale worktree directory', { skip: !isGitRepo }, () => {
    // Create a worktree, then prune it as if the issue no longer exists
    const id = 'test-prune-stale-' + Date.now();
    const info = manager.create(id, 'Stale worktree test');
    expect(existsSync(info.path)).toBe(true);
    expect(info.path).toContain(testWorktreeBase);

    // Prune with an empty active set — the worktree should be removed
    const result = manager.pruneStaleWorktrees(new Set());
    expect(result.removedWorktrees).toContain(id);
    expect(existsSync(info.path)).toBe(false);
    expect(manager.get(id)).toBeUndefined();

    // Clean up the branch
    createdBranches.push(info.branch);
  });

  it('preserves worktrees for active issues', { skip: !isGitRepo }, () => {
    const id = 'test-prune-active-' + Date.now();
    createdIds.push(id);
    const info = manager.create(id, 'Active worktree test');
    expect(existsSync(info.path)).toBe(true);

    // Prune with the issue in the active set — should NOT be removed
    const result = manager.pruneStaleWorktrees(new Set([id]));
    expect(result.removedWorktrees).not.toContain(id);
    expect(existsSync(info.path)).toBe(true);
    expect(manager.get(id)).toBeDefined();
  });

  it('removes only stale worktrees, keeps active ones', { skip: !isGitRepo }, () => {
    const activeId = 'test-prune-keep-' + Date.now();
    const staleId = 'test-prune-remove-' + Date.now();
    createdIds.push(activeId);

    const activeInfo = manager.create(activeId, 'Keep this');
    const staleInfo = manager.create(staleId, 'Remove this');
    expect(existsSync(activeInfo.path)).toBe(true);
    expect(existsSync(staleInfo.path)).toBe(true);

    const result = manager.pruneStaleWorktrees(new Set([activeId]));
    expect(result.removedWorktrees).toContain(staleId);
    expect(result.removedWorktrees).not.toContain(activeId);
    expect(existsSync(activeInfo.path)).toBe(true);
    expect(existsSync(staleInfo.path)).toBe(false);

    // Clean up stale branch
    createdBranches.push(staleInfo.branch);
  });

  it('prunes stale issue/* branches', { skip: !isGitRepo }, () => {
    // Create a branch that looks like an issue branch but has no active issue
    const fakeBranch = 'issue/deadbeef-stale-branch-test';
    try {
      execSync(`git branch ${fakeBranch} ${config.targetBranch}`, {
        cwd: config.repoPath,
        stdio: 'pipe',
      });
    } catch {
      // Branch may already exist
    }
    createdBranches.push(fakeBranch);

    // Prune with empty active set
    const result = manager.pruneStaleWorktrees(new Set());
    expect(result.prunedBranches).toContain(fakeBranch);

    // Verify branch is actually deleted
    let branchExists = true;
    try {
      execSync(`git rev-parse --verify ${fakeBranch}`, {
        cwd: config.repoPath,
        stdio: 'pipe',
      });
    } catch {
      branchExists = false;
    }
    expect(branchExists).toBe(false);

    // Remove from cleanup list since it's already been pruned
    createdBranches.pop();
  });

  it('preserves branches for active issues', { skip: !isGitRepo }, () => {
    const id = 'abcd1234-test-' + Date.now();
    createdIds.push(id);
    const info = manager.create(id, 'Active branch test');

    // The branch should match issue/abcd1234-...
    expect(info.branch).toMatch(/^issue\/abcd1234-/);

    // Prune with the issue active — branch should be preserved
    const result = manager.pruneStaleWorktrees(new Set([id]));
    expect(result.prunedBranches).not.toContain(info.branch);

    // Verify branch still exists
    let branchExists = false;
    try {
      execSync(`git rev-parse --verify ${info.branch}`, {
        cwd: config.repoPath,
        stdio: 'pipe',
      });
      branchExists = true;
    } catch {}
    expect(branchExists).toBe(true);
  });

  it('removes orphaned directory not known to git worktree', { skip: !isGitRepo }, () => {
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
    // Branch pruning may still return results depending on repo state
    expect(Array.isArray(result.prunedBranches)).toBe(true);
  });
});
