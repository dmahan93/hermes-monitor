import { existsSync } from 'fs';
import { resolve, basename, join } from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import type { MergeMode, ManagerTerminalAgent } from '@hermes-monitor/shared/types';

export type { MergeMode, ManagerTerminalAgent } from '@hermes-monitor/shared/types';

const MANAGER_TERMINAL_AGENTS = ['hermes', 'claude', 'codex', 'gemini'] as const;

function isManagerTerminalAgent(value: string | undefined): value is ManagerTerminalAgent {
  return !!value && MANAGER_TERMINAL_AGENTS.includes(value as ManagerTerminalAgent);
}

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
  mergeMode: MergeMode;
  managerTerminalAgent: ManagerTerminalAgent;
  audibleAlerts: boolean;
  serverPort: string;
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

/**
 * Derive a per-repo worktree base directory.
 *
 * In multi-repo hub mode, each repo instance gets its own subdirectory under
 * /tmp/hermes-worktrees/ to prevent worktree collisions between repos.
 * Format: /tmp/hermes-worktrees/<basename>-<hash>/
 *
 * The basename prefix makes `ls /tmp/hermes-worktrees/` human-readable.
 * The hash suffix ensures uniqueness even when multiple repos share a name.
 */
export function getWorktreeBase(): string {
  if (process.env.HERMES_WORKTREE_BASE) {
    return process.env.HERMES_WORKTREE_BASE;
  }

  const repoPath = process.env.HERMES_REPO_PATH;
  if (repoPath) {
    const resolved = resolve(repoPath);
    const hash = createHash('sha256').update(resolved).digest('hex').slice(0, 12);
    const name = basename(resolved).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 30);
    return join('/tmp/hermes-worktrees', `${name}-${hash}`);
  }

  return '/tmp/hermes-worktrees';
}

export const config: AppConfig = {
  repoPath: defaultRepo,
  worktreeBase: getWorktreeBase(),
  reviewBase: process.env.HERMES_REVIEW_BASE || '/tmp/hermes-reviews',
  screenshotBase: process.env.HERMES_SCREENSHOT_BASE || '/tmp/hermes-screenshots',
  diagnosticsBase: process.env.HERMES_DIAGNOSTICS_BASE || '/tmp/hermes-diagnostics',
  targetBranch: detectDefaultBranch(defaultRepo),
  requireScreenshotsForUiChanges: process.env.HERMES_REQUIRE_SCREENSHOTS !== 'false',
  githubEnabled: process.env.HERMES_GITHUB_ENABLED === 'true',
  githubRemote: process.env.HERMES_GITHUB_REMOTE || 'origin',
  mergeMode: (['local', 'github', 'both'].includes(process.env.HERMES_MERGE_MODE || '')
    ? process.env.HERMES_MERGE_MODE as MergeMode
    : 'local'),
  managerTerminalAgent: isManagerTerminalAgent(process.env.HERMES_MANAGER_TERMINAL_AGENT)
    ? process.env.HERMES_MANAGER_TERMINAL_AGENT
    : 'hermes',
  audibleAlerts: process.env.HERMES_AUDIBLE_ALERTS === 'true',
  serverPort: process.env.PORT || '4000',
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
  if (updates.githubRemote !== undefined) {
    const remote = updates.githubRemote.trim();
    // Validate: must be non-empty, alphanumeric with hyphens/underscores/dots, no whitespace or special chars.
    // This prevents confusing `git push "" branch` errors and rejects obviously invalid remote names.
    if (remote && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(remote)) {
      config.githubRemote = remote;
    }
    // Silently ignore invalid values — the config stays at its previous valid value.
  }
  if (updates.mergeMode !== undefined) {
    if (['local', 'github', 'both'].includes(updates.mergeMode)) {
      config.mergeMode = updates.mergeMode;
    }
  }
  if (updates.managerTerminalAgent !== undefined) {
    if (isManagerTerminalAgent(updates.managerTerminalAgent)) {
      config.managerTerminalAgent = updates.managerTerminalAgent;
    }
  }
  if (updates.audibleAlerts !== undefined) config.audibleAlerts = !!updates.audibleAlerts;
  if (updates.serverPort !== undefined) config.serverPort = updates.serverPort;
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
