import { describe, it, expect, afterEach } from 'vitest';
import { WorktreeManager } from '../src/worktree-manager.js';
import { config } from '../src/config.js';
import { existsSync, lstatSync, readlinkSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';

// These tests need a real git repo — skip if not available
const isGitRepo = (() => {
  try {
    execSync('git rev-parse --git-dir', { cwd: config.repoPath, stdio: 'pipe' });
    return true;
  } catch { return false; }
})();

// Symlink tests need node_modules in the main repo
const hasNodeModules = isGitRepo && existsSync(join(config.repoPath, 'node_modules'));

describe('WorktreeManager', () => {
  let manager: WorktreeManager;
  const createdIds: string[] = [];

  afterEach(() => {
    // Clean up any worktrees we created
    for (const id of createdIds) {
      try { manager?.remove(id, true); } catch {}
    }
    createdIds.length = 0;
  });

  it('creates a worktree with branch', { skip: !isGitRepo }, () => {
    manager = new WorktreeManager();
    const id = 'test-wt-' + Date.now();
    createdIds.push(id);
    const info = manager.create(id, 'Test worktree creation');
    expect(info.branch).toContain('issue/');
    expect(info.branch).toContain('test-worktree-creation');
    expect(info.path).toContain(id);
    expect(existsSync(info.path)).toBe(true);
  });

  it('worktree path exists on disk', { skip: !isGitRepo }, () => {
    manager = new WorktreeManager();
    const id = 'test-wt-path-' + Date.now();
    createdIds.push(id);
    const info = manager.create(id, 'Path test');
    expect(existsSync(info.path)).toBe(true);
    // Should contain repo files
    expect(existsSync(`${info.path}/package.json`)).toBe(true);
  });

  it('removes a worktree', { skip: !isGitRepo }, () => {
    manager = new WorktreeManager();
    const id = 'test-wt-rm-' + Date.now();
    const info = manager.create(id, 'Remove test');
    expect(existsSync(info.path)).toBe(true);
    manager.remove(id, true);
    // Directory should be gone
    expect(existsSync(info.path)).toBe(false);
    expect(manager.get(id)).toBeUndefined();
  });

  it('get returns worktree info', { skip: !isGitRepo }, () => {
    manager = new WorktreeManager();
    const id = 'test-wt-get-' + Date.now();
    createdIds.push(id);
    manager.create(id, 'Get test');
    const info = manager.get(id);
    expect(info).toBeDefined();
    expect(info!.issueId).toBe(id);
    expect(info!.branch).toBeTruthy();
    expect(info!.path).toBeTruthy();
  });

  it('creates worktree with node_modules symlink', { skip: !hasNodeModules }, () => {
    manager = new WorktreeManager();
    const id = 'test-wt-deps-' + Date.now();
    createdIds.push(id);
    const info = manager.create(id, 'Deps test');
    const nodeModulesPath = join(info.path, 'node_modules');
    const expectedTarget = resolve(join(config.repoPath, 'node_modules'));

    // node_modules should exist as a symlink pointing to the main repo
    expect(existsSync(nodeModulesPath)).toBe(true);
    const stat = lstatSync(nodeModulesPath);
    expect(stat.isSymbolicLink()).toBe(true);
    const target = readlinkSync(nodeModulesPath);
    expect(target).toBe(expectedTarget);
  });

  it('setupDeps is idempotent', { skip: !hasNodeModules }, () => {
    manager = new WorktreeManager();
    const id = 'test-wt-idempotent-' + Date.now();
    createdIds.push(id);
    const info = manager.create(id, 'Idempotent test');
    const nodeModulesPath = join(info.path, 'node_modules');
    const expectedTarget = resolve(join(config.repoPath, 'node_modules'));

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
