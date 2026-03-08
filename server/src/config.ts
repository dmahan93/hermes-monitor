import { existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

export interface AppConfig {
  repoPath: string;
  worktreeBase: string;
  reviewBase: string;
  screenshotBase: string;
  diagnosticsBase: string;
  targetBranch: string;
  requireScreenshotsForUiChanges: boolean;
  githubEnabled: boolean;
  githubRemote: string;
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

// Default to parent of server/ dir (project root), or HERMES_REPO_PATH env var
const defaultRepo = process.env.HERMES_REPO_PATH || resolve(process.cwd(), '..');

export const config: AppConfig = {
  repoPath: defaultRepo,
  worktreeBase: process.env.HERMES_WORKTREE_BASE || '/tmp/hermes-worktrees',
  reviewBase: process.env.HERMES_REVIEW_BASE || '/tmp/hermes-reviews',
  screenshotBase: process.env.HERMES_SCREENSHOT_BASE || '/tmp/hermes-screenshots',
  diagnosticsBase: process.env.HERMES_DIAGNOSTICS_BASE || '/tmp/hermes-diagnostics',
  targetBranch: detectDefaultBranch(defaultRepo),
  requireScreenshotsForUiChanges: process.env.HERMES_REQUIRE_SCREENSHOTS !== 'false',
  githubEnabled: process.env.HERMES_GITHUB_ENABLED === 'true',
  githubRemote: process.env.HERMES_GITHUB_REMOTE || 'origin',
};

export function updateConfig(updates: Partial<AppConfig>): void {
  if (updates.repoPath !== undefined) {
    config.repoPath = updates.repoPath;
    config.targetBranch = detectDefaultBranch(updates.repoPath);
  }
  if (updates.worktreeBase !== undefined) config.worktreeBase = updates.worktreeBase;
  if (updates.reviewBase !== undefined) config.reviewBase = updates.reviewBase;
  if (updates.screenshotBase !== undefined) config.screenshotBase = updates.screenshotBase;
  if (updates.diagnosticsBase !== undefined) config.diagnosticsBase = updates.diagnosticsBase;
  if (updates.targetBranch !== undefined) config.targetBranch = updates.targetBranch;
  if (updates.requireScreenshotsForUiChanges !== undefined) config.requireScreenshotsForUiChanges = updates.requireScreenshotsForUiChanges;
  if (updates.githubEnabled !== undefined) config.githubEnabled = updates.githubEnabled;
  if (updates.githubRemote !== undefined) config.githubRemote = updates.githubRemote;
}

// Cache isGitRepo result per path — the repo status doesn't change during
// a server session, so there's no need to spawn a blocking execSync on
// every API request.
const gitRepoCache = new Map<string, boolean>();

export function isGitRepo(path: string): boolean {
  const cached = gitRepoCache.get(path);
  if (cached !== undefined) return cached;

  let result: boolean;
  try {
    execSync('git rev-parse --git-dir', { cwd: path, stdio: 'pipe' });
    result = true;
  } catch {
    result = false;
  }
  gitRepoCache.set(path, result);
  return result;
}
