import { execFileSync } from 'child_process';
import { mkdirSync, existsSync, rmSync, symlinkSync, lstatSync } from 'fs';
import { join, resolve } from 'path';
import { config } from './config.js';

export interface WorktreeInfo {
  branch: string;
  path: string;
  issueId: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, {
    cwd: cwd || config.repoPath,
    stdio: 'pipe',
  }).toString().trim();
}

/**
 * Manages git worktrees for per-issue branch isolation.
 *
 * **Key responsibilities:**
 * - Creates a dedicated branch + worktree when an issue moves to `in_progress`,
 *   using the naming convention `issue/<short-id>-<slugified-title>`.
 * - Removes worktrees (and optionally deletes branches) when issues reach `done`.
 * - Symlinks `node_modules` from the main repo into each worktree so that
 *   tests and tooling can run immediately without a separate install step.
 * - Provides lookup of worktree info (path, branch) by issue ID.
 *
 * **Persistence:** Worktree state is ephemeral (in-memory `Map`). The actual
 * git worktrees on disk are the source of truth and survive server restarts;
 * the map is only used for fast lookups during a session.
 *
 * **Key lifecycle events:**
 * - `create(issueId, title)` — branch created, worktree checked out, deps symlinked.
 * - `remove(issueId)` — worktree pruned, branch optionally deleted.
 */
export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();

  /**
   * Create a branch + worktree for an issue.
   * Branch: issue/<short-id>-<slugified-title>
   * Worktree: <worktreeBase>/<issue-id>/
   */
  create(issueId: string, title: string, repoPath?: string): WorktreeInfo {
    const repo = repoPath || config.repoPath;
    const slug = slugify(title);
    const shortId = issueId.slice(0, 8);
    const branch = `issue/${shortId}-${slug}`;
    const worktreePath = join(config.worktreeBase, issueId);

    // Ensure worktree base dir exists
    mkdirSync(config.worktreeBase, { recursive: true });

    // Create branch from target branch (main/master)
    try {
      git(['branch', branch, config.targetBranch], repo);
    } catch {
      // Branch might already exist — that's ok
    }

    // Create worktree
    try {
      git(['worktree', 'add', worktreePath, branch], repo);
    } catch (err: any) {
      // Worktree might already exist
      if (!existsSync(worktreePath)) {
        throw err;
      }
    }

    const info: WorktreeInfo = { branch, path: worktreePath, issueId };
    this.worktrees.set(issueId, info);

    // Auto-setup node_modules so tests can run immediately
    this.setupDeps(worktreePath, repo);

    return info;
  }

  /**
   * Remove worktree and optionally delete branch.
   */
  remove(issueId: string, deleteBranch = false): boolean {
    const info = this.worktrees.get(issueId);
    if (!info) return false;

    try {
      // Remove worktree
      git(['worktree', 'remove', info.path, '--force'], config.repoPath);
    } catch {
      // Force remove the directory if git worktree remove fails
      try {
        rmSync(info.path, { recursive: true, force: true });
        git(['worktree', 'prune'], config.repoPath);
      } catch {}
    }

    if (deleteBranch) {
      try {
        git(['branch', '-D', info.branch], config.repoPath);
      } catch {}
    }

    this.worktrees.delete(issueId);
    return true;
  }

  /**
   * Set up node_modules in a worktree by symlinking from the main repo.
   * This avoids needing `npm install` in every worktree — tests can run
   * immediately since npm-workspace dependencies are hoisted to root.
   *
   * Can also be called standalone on any worktree path.
   */
  setupDeps(worktreePath: string, repoPath?: string): void {
    const repo = repoPath || config.repoPath;
    const sourceModules = join(repo, 'node_modules');
    const targetModules = join(worktreePath, 'node_modules');

    // Nothing to link from if the main repo hasn't run npm install
    if (!existsSync(sourceModules)) {
      console.warn(
        `[worktree] node_modules not found in ${repo} — run 'npm install' there first`
      );
      return;
    }

    // Already set up — either a real dir or an existing symlink
    if (existsSync(targetModules)) {
      return;
    }

    // Clean up a broken symlink if one exists
    try {
      const stat = lstatSync(targetModules);
      if (stat.isSymbolicLink()) {
        rmSync(targetModules);
      }
    } catch {
      // lstat throws if path doesn't exist at all — that's fine
    }

    try {
      symlinkSync(resolve(sourceModules), targetModules, 'dir');
    } catch (err) {
      console.warn(
        `[worktree] Failed to symlink node_modules in ${worktreePath}: ${err instanceof Error ? err.message : err}`
      );
      console.warn(
        `[worktree] Run 'npm install' manually in the worktree to set up dependencies`
      );
    }
  }

  get(issueId: string): WorktreeInfo | undefined {
    return this.worktrees.get(issueId);
  }

  /**
   * Get the diff between the issue branch and the target branch.
   */
  getDiff(issueId: string): string | undefined {
    const info = this.worktrees.get(issueId);
    if (!info) return undefined;

    try {
      return git(['diff', `${config.targetBranch}...${info.branch}`], config.repoPath);
    } catch {
      return undefined;
    }
  }

  /**
   * Get list of changed files.
   */
  getChangedFiles(issueId: string): string[] {
    const info = this.worktrees.get(issueId);
    if (!info) return [];

    try {
      const output = git(['diff', '--name-only', `${config.targetBranch}...${info.branch}`], config.repoPath);
      return output ? output.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  /**
   * Merge the issue branch into the target branch.
   */
  merge(issueId: string): boolean {
    const info = this.worktrees.get(issueId);
    if (!info) return false;

    try {
      git(['merge', info.branch, '--no-ff', '-m', `Merge ${info.branch}`], config.repoPath);
      return true;
    } catch {
      return false;
    }
  }

  list(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }

  get size(): number {
    return this.worktrees.size;
  }
}
