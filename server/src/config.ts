import { existsSync } from 'fs';
import { execSync } from 'child_process';

export interface AppConfig {
  repoPath: string;
  worktreeBase: string;
  reviewBase: string;
  targetBranch: string;
}

// Detect the default branch name for a repo
function detectDefaultBranch(repoPath: string): string {
  try {
    const result = execSync(
      'git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD',
      { cwd: repoPath, stdio: 'pipe' }
    ).toString().trim();
    return result.replace('refs/remotes/origin/', '');
  } catch {
    return 'main';
  }
}

const defaultRepo = process.env.HERMES_REPO_PATH || process.cwd();

export const config: AppConfig = {
  repoPath: defaultRepo,
  worktreeBase: process.env.HERMES_WORKTREE_BASE || '/tmp/hermes-worktrees',
  reviewBase: process.env.HERMES_REVIEW_BASE || '/tmp/hermes-reviews',
  targetBranch: detectDefaultBranch(defaultRepo),
};

export function updateConfig(updates: Partial<AppConfig>): void {
  if (updates.repoPath !== undefined) {
    config.repoPath = updates.repoPath;
    config.targetBranch = detectDefaultBranch(updates.repoPath);
  }
  if (updates.worktreeBase !== undefined) config.worktreeBase = updates.worktreeBase;
  if (updates.reviewBase !== undefined) config.reviewBase = updates.reviewBase;
  if (updates.targetBranch !== undefined) config.targetBranch = updates.targetBranch;
}

export function isGitRepo(path: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: path, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
