import { execFileSync } from 'child_process';
import { mkdirSync, existsSync, rmSync, symlinkSync, lstatSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { config } from './config.js';

export interface PruneResult {
  removedWorktrees: string[];
  prunedBranches: string[];
}

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

export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();
  private isPruning = false;

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

  /**
   * Remove worktrees and branches that don't belong to any active issue.
   * Handles:
   * - Worktree dirs left behind after issues were deleted
   * - Worktrees from issues that were in_progress when the server restarted
   * - Branches from conflict-fixer agents with inconsistent naming
   * - Orphaned git worktree entries
   *
   * @param activeIssueIds Set of issue IDs that are still active (not done/deleted)
   */
  pruneStaleWorktrees(activeIssueIds: Set<string>): PruneResult {
    if (this.isPruning) {
      // Another prune is already running — skip to avoid concurrent git operations
      return { removedWorktrees: [], prunedBranches: [] };
    }
    this.isPruning = true;

    const result: PruneResult = {
      removedWorktrees: [],
      prunedBranches: [],
    };

    try {
      // 1. Remove stale worktree directories
      if (existsSync(config.worktreeBase)) {
        let entries: string[];
        try {
          entries = readdirSync(config.worktreeBase);
        } catch {
          entries = [];
        }

        for (const entry of entries) {
          const worktreePath = join(config.worktreeBase, entry);

          // Only prune directories — skip stray files (README, .gitkeep, etc.)
          try {
            if (!lstatSync(worktreePath).isDirectory()) continue;
          } catch {
            continue;
          }

          // Skip if this worktree belongs to an active issue
          if (activeIssueIds.has(entry)) continue;

          // Try git worktree remove first (cleanest), fall back to rm
          try {
            git(['worktree', 'remove', worktreePath, '--force'], config.repoPath);
          } catch {
            try {
              rmSync(worktreePath, { recursive: true, force: true });
            } catch {}
          }

          // Also remove from in-memory map if present
          this.worktrees.delete(entry);
          result.removedWorktrees.push(entry);
        }
      }

      // 2. Prune git's internal worktree list (cleans up dangling entries)
      try {
        git(['worktree', 'prune'], config.repoPath);
      } catch {}

      // 3. Prune stale issue/* branches
      // Build a set of short IDs (first 8 chars) from active issues
      const activeShortIds = new Set<string>();
      activeIssueIds.forEach((id) => {
        activeShortIds.add(id.slice(0, 8));
      });

      // List all local branches matching issue/*
      let branches: string[];
      try {
        const output = git(
          ['for-each-ref', '--format=%(refname:short)', 'refs/heads/issue/'],
          config.repoPath
        );
        branches = output ? output.split('\n').filter(Boolean) : [];
      } catch {
        branches = [];
      }

      for (const branch of branches) {
        // Extract the short ID from the branch name: issue/<shortId>-<slug>
        // NOTE: 8-char hex prefix matching (32 bits) has per-pair collision odds of
        // ~1 in 4 billion, but birthday paradox gives 50% collision at ~77k issues.
        // A collision only causes a stale branch to be preserved (safe failure mode),
        // so this is acceptable. The alternative (persisting full branch-to-issue
        // mappings) adds significant complexity for minimal practical benefit.
        const match = branch.match(/^issue\/([a-f0-9]{8})-/);
        if (!match) continue;

        const shortId = match[1];
        if (activeShortIds.has(shortId)) continue;

        // No active issue matches this branch — try safe delete first,
        // fall back to force delete with a warning and commit hash for recovery
        try {
          git(['branch', '-d', branch], config.repoPath);
          result.prunedBranches.push(branch);
        } catch {
          try {
            // Log the HEAD commit hash so work can be recovered via git reflog
            const sha = git(['rev-parse', branch], config.repoPath);
            console.warn(`[prune] Force-deleting unmerged branch: ${branch} (HEAD was ${sha})`);
            git(['branch', '-D', branch], config.repoPath);
            result.prunedBranches.push(branch);
          } catch {}
        }
      }
    } finally {
      this.isPruning = false;
    }

    return result;
  }
}
