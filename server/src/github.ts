/**
 * @module github
 * GitHub integration — push branches and manage GitHub PRs.
 *
 * All operations are best-effort: failures are logged but never block
 * the local hermes-monitor workflow. Uses `gh` CLI for PR operations
 * and `git push` for branch syncing.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from './config.js';

const execFileAsync = promisify(execFile);

export interface GitHubPushResult {
  success: boolean;
  error?: string;
}

export interface GitHubPRResult {
  success: boolean;
  prUrl?: string;
  error?: string;
}

/**
 * Check if the `gh` CLI is installed and authenticated.
 */
export async function isGhAvailable(repoPath: string): Promise<boolean> {
  try {
    await execFileAsync('gh', ['auth', 'status'], { cwd: repoPath, timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Push a branch to the configured GitHub remote.
 * Uses --force-with-lease for safety on rework pushes.
 */
export async function pushBranch(
  branchName: string,
  repoPath: string,
  remote?: string,
): Promise<GitHubPushResult> {
  const remoteName = remote || config.githubRemote;
  try {
    await execFileAsync(
      'git',
      ['push', remoteName, branchName, '--force-with-lease'],
      { cwd: repoPath, timeout: 60000 },
    );
    console.log(`[github] Pushed branch ${branchName} to ${remoteName}`);
    return { success: true };
  } catch (err: any) {
    const msg = err.stderr?.toString() || err.message || 'Unknown push error';
    console.error(`[github] Failed to push ${branchName} to ${remoteName}: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Push the target branch to the remote after a merge.
 */
export async function pushMerge(
  targetBranch: string,
  repoPath: string,
  remote?: string,
): Promise<GitHubPushResult> {
  const remoteName = remote || config.githubRemote;
  try {
    await execFileAsync(
      'git',
      ['push', remoteName, targetBranch],
      { cwd: repoPath, timeout: 60000 },
    );
    console.log(`[github] Pushed merge on ${targetBranch} to ${remoteName}`);
    return { success: true };
  } catch (err: any) {
    const msg = err.stderr?.toString() || err.message || 'Unknown push error';
    console.error(`[github] Failed to push ${targetBranch} to ${remoteName}: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Create a GitHub pull request using the `gh` CLI.
 * Returns the PR URL on success.
 */
export async function createGitHubPR(
  title: string,
  body: string,
  sourceBranch: string,
  targetBranch: string,
  repoPath: string,
): Promise<GitHubPRResult> {
  // First check if gh is available
  const ghAvailable = await isGhAvailable(repoPath);
  if (!ghAvailable) {
    const msg = 'gh CLI not available or not authenticated — skipping GitHub PR creation';
    console.warn(`[github] ${msg}`);
    return { success: false, error: msg };
  }

  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr', 'create',
        '--title', title,
        '--body', body,
        '--head', sourceBranch,
        '--base', targetBranch,
      ],
      { cwd: repoPath, timeout: 30000 },
    );
    const prUrl = stdout.trim();
    console.log(`[github] Created GitHub PR: ${prUrl}`);
    return { success: true, prUrl };
  } catch (err: any) {
    const stderr = err.stderr?.toString() || '';
    // gh returns "already exists" if a PR for this branch already exists
    if (stderr.includes('already exists')) {
      // Try to get the existing PR URL
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['pr', 'view', sourceBranch, '--json', 'url', '--jq', '.url'],
          { cwd: repoPath, timeout: 15000 },
        );
        const prUrl = stdout.trim();
        console.log(`[github] GitHub PR already exists: ${prUrl}`);
        return { success: true, prUrl };
      } catch {
        // Can't get URL, just report success since the PR exists
        return { success: false, error: 'PR already exists but could not retrieve URL' };
      }
    }
    const msg = stderr || err.message || 'Unknown gh error';
    console.error(`[github] Failed to create GitHub PR: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Close a GitHub PR by URL using the `gh` CLI.
 * Used when a local merge is performed and the GitHub PR should be closed.
 */
export async function closeGitHubPR(
  prUrl: string,
  repoPath: string,
  comment?: string,
): Promise<GitHubPRResult> {
  const ghAvailable = await isGhAvailable(repoPath);
  if (!ghAvailable) {
    return { success: false, error: 'gh CLI not available' };
  }

  try {
    // Add a comment explaining the merge was done locally
    if (comment) {
      await execFileAsync(
        'gh',
        ['pr', 'comment', prUrl, '--body', comment],
        { cwd: repoPath, timeout: 15000 },
      );
    }

    // Close the PR (not merge — the merge was done locally)
    await execFileAsync(
      'gh',
      ['pr', 'close', prUrl, '--comment', 'Merged locally via hermes-monitor.'],
      { cwd: repoPath, timeout: 15000 },
    );
    console.log(`[github] Closed GitHub PR: ${prUrl}`);
    return { success: true };
  } catch (err: any) {
    const msg = err.stderr?.toString() || err.message || 'Unknown error';
    console.error(`[github] Failed to close GitHub PR ${prUrl}: ${msg}`);
    return { success: false, error: msg };
  }
}

/**
 * Delete a remote branch after merge.
 */
export async function deleteRemoteBranch(
  branchName: string,
  repoPath: string,
  remote?: string,
): Promise<GitHubPushResult> {
  const remoteName = remote || config.githubRemote;
  try {
    await execFileAsync(
      'git',
      ['push', remoteName, '--delete', branchName],
      { cwd: repoPath, timeout: 30000 },
    );
    console.log(`[github] Deleted remote branch ${branchName} on ${remoteName}`);
    return { success: true };
  } catch (err: any) {
    const msg = err.stderr?.toString() || err.message || 'Unknown error';
    // Not an error if the branch doesn't exist on the remote
    if (msg.includes('remote ref does not exist')) {
      return { success: true };
    }
    console.error(`[github] Failed to delete remote branch ${branchName}: ${msg}`);
    return { success: false, error: msg };
  }
}
