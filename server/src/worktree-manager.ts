import { execFileSync } from 'child_process';
import { mkdirSync, existsSync, rmSync, symlinkSync, lstatSync, readdirSync, readlinkSync } from 'fs';
import { join, resolve } from 'path';
import { config } from './config.js';

export interface PruneResult {
  removedWorktrees: string[];
  prunedBranches: string[];
  /** Branches that have unmerged commits and were NOT deleted (safe failure mode) */
  skippedUnmergedBranches: string[];
}

export interface WorktreeInfo {
  branch: string;
  path: string;
  issueId: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  issues: string[];
  fixes: string[];
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
 * **Key methods:**
 * - `create(issueId, title)` — branch created, worktree checked out, deps symlinked.
 * - `remove(issueId)` — worktree pruned, branch optionally deleted.
 */
export class WorktreeManager {
  private worktrees = new Map<string, WorktreeInfo>();
  private healthChecks = new Map<string, HealthCheckResult>();

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
    this.healthChecks.delete(issueId);
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

  /**
   * Run a health check on a worktree, auto-fixing what's possible.
   *
   * Checks:
   * - Worktree directory exists
   * - Correct branch is checked out
   * - No merge conflicts (git merge state)
   * - node_modules symlink is valid
   *
   * Auto-fixes:
   * - Wrong branch → `git checkout <branch>`
   * - Merge conflicts → `git merge --abort`
   * - Missing/broken node_modules → re-symlink
   * - Unfixable state → remove and recreate worktree from scratch
   *
   * Results are stored and retrievable via `getHealthCheck(issueId)`.
   */
  healthCheck(issueId: string, repoPath?: string): HealthCheckResult {
    const repo = repoPath || config.repoPath;
    const info = this.worktrees.get(issueId);
    const result: HealthCheckResult = { healthy: true, issues: [], fixes: [] };

    if (!info) {
      result.healthy = false;
      result.issues.push('No worktree registered for this issue');
      this.healthChecks.set(issueId, result);
      return result;
    }

    // 1. Check worktree directory exists
    if (!existsSync(info.path)) {
      result.issues.push('Worktree directory does not exist');
      try {
        this.recreateWorktree(info, repo);
        result.fixes.push('Recreated worktree from scratch');
      } catch (err) {
        result.healthy = false;
        result.issues.push(`Failed to recreate worktree: ${err instanceof Error ? err.message : err}`);
      }
      this.healthChecks.set(issueId, result);
      return result;
    }

    // 2. Check correct branch is checked out
    try {
      const currentBranch = git(['branch', '--show-current'], info.path);
      if (currentBranch !== info.branch) {
        result.issues.push(`Wrong branch checked out: ${currentBranch} (expected ${info.branch})`);
        try {
          git(['checkout', info.branch], info.path);
          result.fixes.push(`Checked out correct branch: ${info.branch}`);
        } catch (err) {
          result.healthy = false;
          result.issues.push(`Failed to checkout branch: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch {
      result.issues.push('Could not determine current branch');
      result.healthy = false;
    }

    // 3. Check for merge conflicts (active merge state)
    try {
      const gitDir = git(['rev-parse', '--git-dir'], info.path);
      const mergeHeadExists = existsSync(join(gitDir, 'MERGE_HEAD'));
      if (mergeHeadExists) {
        result.issues.push('Merge conflicts detected');
        try {
          git(['merge', '--abort'], info.path);
          result.fixes.push('Aborted in-progress merge');
        } catch {
          // merge --abort failed — recreate from scratch
          result.issues.push('Failed to abort merge — recreating worktree');
          try {
            this.recreateWorktree(info, repo);
            result.fixes.push('Recreated worktree from scratch (merge was unfixable)');
          } catch (err) {
            result.healthy = false;
            result.issues.push(`Failed to recreate worktree: ${err instanceof Error ? err.message : err}`);
          }
          this.healthChecks.set(issueId, result);
          return result;
        }
      }
    } catch {
      // Can't determine git dir — not fatal, skip merge check
    }

    // 4. Check node_modules symlink
    const nodeModulesPath = join(info.path, 'node_modules');
    const sourceModules = join(repo, 'node_modules');
    let nodeModulesOk = false;

    if (existsSync(nodeModulesPath)) {
      try {
        const stat = lstatSync(nodeModulesPath);
        if (stat.isSymbolicLink()) {
          const target = readlinkSync(nodeModulesPath);
          const expectedTarget = resolve(sourceModules);
          nodeModulesOk = target === expectedTarget;
          if (!nodeModulesOk) {
            result.issues.push(`node_modules symlink points to wrong target: ${target}`);
          }
        } else {
          // Real directory — acceptable
          nodeModulesOk = true;
        }
      } catch {
        result.issues.push('Could not stat node_modules');
      }
    } else {
      // Check for broken symlink (lstat succeeds but target doesn't exist)
      try {
        const stat = lstatSync(nodeModulesPath);
        if (stat.isSymbolicLink()) {
          result.issues.push('node_modules is a broken symlink');
        }
      } catch {
        result.issues.push('node_modules missing');
      }
    }

    if (!nodeModulesOk) {
      try {
        // Remove broken/wrong symlink if present (guard with lstatSync to avoid wasteful ENOENT)
        try {
          lstatSync(nodeModulesPath);
          rmSync(nodeModulesPath);
        } catch {}
        this.setupDeps(info.path, repo);
        if (existsSync(nodeModulesPath)) {
          result.fixes.push('Re-symlinked node_modules');
        } else if (!existsSync(sourceModules)) {
          // Source doesn't exist — can't fix, but warn rather than fail
          result.issues.push('node_modules not available in main repo');
        } else {
          result.issues.push('Failed to setup node_modules despite source being available');
          result.healthy = false;
        }
      } catch (err) {
        result.issues.push(`Failed to re-symlink node_modules: ${err instanceof Error ? err.message : err}`);
        result.healthy = false;
      }
    }

    this.healthChecks.set(issueId, result);
    return result;
  }

  /** Get the last health check result for an issue */
  getHealthCheck(issueId: string): HealthCheckResult | undefined {
    return this.healthChecks.get(issueId);
  }

  /**
   * Remove and recreate a worktree from scratch.
   * Used when the worktree is in an unfixable state.
   */
  private recreateWorktree(info: WorktreeInfo, repo: string): void {
    // Remove existing worktree
    try {
      git(['worktree', 'remove', info.path, '--force'], repo);
    } catch {
      try {
        rmSync(info.path, { recursive: true, force: true });
        git(['worktree', 'prune'], repo);
      } catch (err) {
        console.error(`[health-check] Failed to clean up worktree at ${info.path}:`, err instanceof Error ? err.message : err);
      }
    }

    // Recreate worktree
    git(['worktree', 'add', info.path, info.branch], repo);

    // Re-setup deps
    this.setupDeps(info.path, repo);
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
   * Get the diff for specific files between the issue branch and target branch.
   * Useful for analyzing whether changes in specific files are visual or structural.
   */
  getDiffForFiles(issueId: string, files: string[]): string | undefined {
    const info = this.worktrees.get(issueId);
    if (!info || files.length === 0) return undefined;

    try {
      return git(['diff', `${config.targetBranch}...${info.branch}`, '--', ...files], config.repoPath);
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
   * Branch deletion uses safe mode only (`git branch -d`). Branches with
   * unmerged commits are preserved and reported in `skippedUnmergedBranches`
   * so operators can handle them manually. This prevents silent data loss
   * from automated runs (startup + 4-hour interval).
   *
   * @param activeIssueIds Set of issue IDs that are still active (not done/deleted)
   */
  pruneStaleWorktrees(activeIssueIds: Set<string>): PruneResult {
    const result: PruneResult = {
      removedWorktrees: [],
      prunedBranches: [],
      skippedUnmergedBranches: [],
    };

    // 1. Remove stale worktree directories
    if (existsSync(config.worktreeBase)) {
      let entries: string[];
      try {
        entries = readdirSync(config.worktreeBase);
      } catch (err) {
        console.warn(`[prune] Failed to read worktree base ${config.worktreeBase}:`, err);
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
        let removed = false;
        try {
          git(['worktree', 'remove', worktreePath, '--force'], config.repoPath);
          removed = true;
        } catch {
          try {
            rmSync(worktreePath, { recursive: true, force: true });
            removed = !existsSync(worktreePath);
          } catch (err) {
            console.warn(`[prune] Failed to remove worktree directory ${worktreePath}:`, err);
          }
        }

        if (removed) {
          this.worktrees.delete(entry);
          this.healthChecks.delete(entry);
          result.removedWorktrees.push(entry);
        }
      }
    }

    // 2. Prune git's internal worktree list (cleans up dangling entries)
    try {
      git(['worktree', 'prune'], config.repoPath);
    } catch (err) {
      console.warn('[prune] git worktree prune failed:', err);
    }

    // 3. Prune stale issue/* branches
    // Build a set of short IDs (first 8 chars) from active issues.
    // 8-char hex prefix matching (32 bits) has a birthday-paradox 50% collision
    // probability at ~77k issues. A collision only causes a stale branch to be
    // preserved (safe failure mode), so this is acceptable at typical scale.
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
    } catch (err) {
      console.warn('[prune] Failed to list issue branches:', err);
      branches = [];
    }

    for (const branch of branches) {
      // Extract the short ID from the branch name: issue/<shortId>-<slug>
      const match = branch.match(/^issue\/([a-f0-9]{8})-/);
      if (!match) {
        // Branch matches issue/* but doesn't follow the expected naming pattern.
        // This could be a manually-created branch or one with non-hex characters.
        // Skip it — it will never be auto-cleaned, which is the safe default.
        console.debug?.(`[prune] Skipping branch with unexpected pattern: ${branch}`);
        continue;
      }

      const shortId = match[1];
      if (activeShortIds.has(shortId)) continue;

      // No active issue matches this branch — use safe delete only.
      // If the branch has unmerged commits, -d will fail and we preserve it
      // rather than force-deleting and risking data loss.
      try {
        git(['branch', '-d', branch], config.repoPath);
        result.prunedBranches.push(branch);
      } catch {
        // Branch has unmerged commits — preserve it and report
        try {
          const sha = git(['rev-parse', '--short', branch], config.repoPath);
          console.warn(`[prune] Skipping unmerged branch: ${branch} (HEAD: ${sha}) — delete manually with: git branch -D ${branch}`);
          result.skippedUnmergedBranches.push(branch);
        } catch {
          // Can't even rev-parse — branch might be in a weird state, skip silently
          result.skippedUnmergedBranches.push(branch);
        }
      }
    }

    return result;
  }
}
