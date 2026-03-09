import { describe, it, expect, afterEach } from 'vitest';
import { resolve, join, basename } from 'path';
import { createHash } from 'crypto';
import { getWorktreeBase } from '../src/config.js';

describe('getWorktreeBase', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns HERMES_WORKTREE_BASE when set (explicit override)', () => {
    process.env.HERMES_WORKTREE_BASE = '/custom/worktrees';
    process.env.HERMES_REPO_PATH = '/some/repo';
    expect(getWorktreeBase()).toBe('/custom/worktrees');
  });

  it('HERMES_WORKTREE_BASE takes priority over HERMES_REPO_PATH', () => {
    process.env.HERMES_WORKTREE_BASE = '/explicit/worktrees';
    process.env.HERMES_REPO_PATH = '/home/user/my-project';
    expect(getWorktreeBase()).toBe('/explicit/worktrees');
  });

  it('derives per-repo worktree base from HERMES_REPO_PATH', () => {
    delete process.env.HERMES_WORKTREE_BASE;
    process.env.HERMES_REPO_PATH = '/home/user/my-project';

    const result = getWorktreeBase();
    const resolved = resolve('/home/user/my-project');
    const expectedHash = createHash('sha256').update(resolved).digest('hex').slice(0, 12);
    const expectedName = basename(resolved);
    const expectedPath = join('/tmp/hermes-worktrees', `${expectedName}-${expectedHash}`);

    expect(result).toBe(expectedPath);
  });

  it('different repos produce different worktree bases', () => {
    delete process.env.HERMES_WORKTREE_BASE;

    process.env.HERMES_REPO_PATH = '/home/user/repo-alpha';
    const pathA = getWorktreeBase();

    process.env.HERMES_REPO_PATH = '/home/user/repo-beta';
    const pathB = getWorktreeBase();

    expect(pathA).not.toBe(pathB);
  });

  it('same repo always produces the same worktree base', () => {
    delete process.env.HERMES_WORKTREE_BASE;
    process.env.HERMES_REPO_PATH = '/home/user/stable-repo';

    const path1 = getWorktreeBase();
    const path2 = getWorktreeBase();

    expect(path1).toBe(path2);
  });

  it('falls back to flat /tmp/hermes-worktrees when no env vars set', () => {
    delete process.env.HERMES_WORKTREE_BASE;
    delete process.env.HERMES_REPO_PATH;

    expect(getWorktreeBase()).toBe('/tmp/hermes-worktrees');
  });

  it('sanitizes repo names with special characters', () => {
    delete process.env.HERMES_WORKTREE_BASE;
    process.env.HERMES_REPO_PATH = '/home/user/my project (v2)';

    const result = getWorktreeBase();
    // Should not contain spaces or parens
    expect(result).not.toMatch(/[\s()]/);
    // Should be under /tmp/hermes-worktrees/
    expect(result).toMatch(/^\/tmp\/hermes-worktrees\//);
  });

  it('truncates very long repo names', () => {
    delete process.env.HERMES_WORKTREE_BASE;
    const longName = 'a'.repeat(100);
    process.env.HERMES_REPO_PATH = `/home/user/${longName}`;

    const result = getWorktreeBase();
    const dirName = basename(result);
    // Name portion is capped at 30 chars + dash + 12 char hash = 43 max
    expect(dirName.length).toBeLessThanOrEqual(43);
  });
});
