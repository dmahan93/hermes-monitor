import { v4 as uuidv4 } from 'uuid';
import { execSync, execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { TerminalManager } from './terminal-manager.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { Store } from './store.js';
import { config } from './config.js';
import { buildScreenshotSection } from './screenshot-utils.js';
import { loadTemplate, renderTemplate } from './agents.js';
import { pushBranch, pushMerge, createGitHubPR, closeGitHubPR, deleteRemoteBranch } from './github.js';

// Auto-relaunch constants
const MAX_REVIEWER_RELAUNCH = 2;        // max retries before giving up
const REVIEWER_RELAUNCH_DELAY_MS = 5000; // wait 5s before relaunching

// Re-export shared types so existing server imports continue to work.
export type { PRStatus, Verdict, PRComment, Screenshot, PullRequest } from '@hermes-monitor/shared/types';
import type { PRStatus, Verdict, PRComment, Screenshot, PullRequest } from '@hermes-monitor/shared/types';

export type PREvent = 'pr:created' | 'pr:updated';

export interface CreatePROptions {
  issueId: string;
  title: string;
  description?: string;
  submitterNotes?: string;
  screenshotBypassReason?: string;
}

export type PREventCallback = (event: PREvent, pr: PullRequest) => void;

/**
 * Manages pull requests, adversarial code reviews, and merge operations.
 *
 * **Key responsibilities:**
 * - Creates pull requests from issue worktree branches, capturing diffs and
 *   changed file lists.
 * - Spawns reviewer agent terminals for adversarial code review and processes
 *   their verdicts (approve / request_changes / comment).
 * - Handles review relaunching — if a reviewer terminal exits unexpectedly,
 *   it can be re-spawned for another pass.
 * - Detects merge conflicts and spawns conflict-fixer agent terminals to
 *   resolve them automatically.
 * - Performs the actual git merge into the target branch when a PR is approved.
 * - Manages PR comments (review feedback, inline annotations).
 *
 * **Persistence:** PRs and comments are persisted to SQLite via {@link Store}.
 * The in-memory `Map<string, PullRequest>` is the authoritative runtime copy;
 * mutations are written through immediately. Reviewer and conflict-fixer
 * terminal IDs are ephemeral — they reference live {@link TerminalManager} sessions.
 *
 * **Key lifecycle events:**
 * - `pr:created` — new PR opened from an issue branch.
 * - `pr:updated` — status, verdict, diff, or comment changes.
 */
export class PRManager {
  private prs = new Map<string, PullRequest>();
  private terminalManager: TerminalManager;
  private worktreeManager: WorktreeManager;
  private store: Store | null = null;
  private eventCallbacks: PREventCallback[] = [];
  private conflictFixerTerminals = new Set<string>();
  private pendingRemovalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reviewerRelaunchAttempts = new Map<string, number>();
  private reviewerRelaunchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private relaunchDelayMs = REVIEWER_RELAUNCH_DELAY_MS;
  /** Terminal IDs being intentionally killed by internal methods (relaunchReview, fixConflicts).
   *  handleReviewerExit skips cleanup for these — the caller handles it. */
  private intentionallyKilledTerminals = new Set<string>();

  constructor(terminalManager: TerminalManager, worktreeManager: WorktreeManager) {
    this.terminalManager = terminalManager;
    this.worktreeManager = worktreeManager;

    // When a terminal exits, check if it's a conflict fixer or reviewer
    this.terminalManager.onExit((terminalId, _exitCode) => {
      if (this.conflictFixerTerminals.has(terminalId)) {
        this.handleConflictFixerExit(terminalId);
      } else {
        this.handleReviewerExit(terminalId);
      }
    });
  }

  setStore(store: Store): void {
    this.store = store;
  }

  loadFromStore(): void {
    if (!this.store) return;
    const prs = this.store.loadPRs();
    for (const pr of prs) {
      this.prs.set(pr.id, pr);
    }
  }

  private persist(pr: PullRequest): void {
    this.store?.savePR(pr);
  }

  onEvent(cb: PREventCallback): void {
    this.eventCallbacks.push(cb);
  }

  /**
   * Cancel a pending delayed removal for a terminal.
   * Called when a terminal is killed through another path (e.g., relaunchReview, fixConflicts)
   * to prevent the stale timer from firing on a destroyed object.
   */
  private cancelPendingRemoval(terminalId: string): void {
    const timer = this.pendingRemovalTimers.get(terminalId);
    if (timer) {
      clearTimeout(timer);
      this.pendingRemovalTimers.delete(terminalId);
    }
  }

  /**
   * Clear all pending removal and relaunch timers. Call during shutdown to
   * prevent callbacks firing on destroyed objects.
   */
  clearAllPendingTimers(): void {
    this.pendingRemovalTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.pendingRemovalTimers.clear();

    this.reviewerRelaunchTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.reviewerRelaunchTimers.clear();
  }

  /** Override relaunch delay (for testing) */
  setRelaunchDelay(ms: number): void {
    this.relaunchDelayMs = ms;
  }

  private emit(event: PREvent, pr: PullRequest): void {
    for (const cb of this.eventCallbacks) {
      cb(event, pr);
    }
  }

  /**
   * Create a PR from an issue's worktree branch.
   */
  create(options: CreatePROptions): PullRequest | null {
    const worktree = this.worktreeManager.get(options.issueId);
    if (!worktree) return null;

    const id = uuidv4();
    const diff = this.worktreeManager.getDiff(options.issueId) || '';
    const changedFiles = this.worktreeManager.getChangedFiles(options.issueId);

    const pr: PullRequest = {
      id,
      issueId: options.issueId,
      title: options.title,
      description: options.description || '',
      submitterNotes: options.submitterNotes || '',
      screenshotBypassReason: options.screenshotBypassReason,
      sourceBranch: worktree.branch,
      targetBranch: config.targetBranch,
      repoPath: config.repoPath,
      status: 'open',
      diff,
      changedFiles,
      verdict: 'pending',
      reviewerTerminalId: null,
      comments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.prs.set(id, pr);
    this.persist(pr);
    this.emit('pr:created', pr);
    return pr;
  }

  /**
   * Spawn an adversarial hermes reviewer for the PR.
   */
  spawnReviewer(prId: string): PullRequest | null {
    const pr = this.prs.get(prId);
    if (!pr) return null;

    // Write context for the reviewer
    const reviewDir = join(config.reviewBase, prId);
    mkdirSync(reviewDir, { recursive: true });

    // Build screenshot section for the review context
    const port = process.env.PORT || '4000';
    const screenshotSection = buildScreenshotSection(pr.issueId, pr.changedFiles, port, pr.screenshotBypassReason);

    const contextSections = [
      `# PR Review: ${pr.title}`,
      '',
      `**Description:** ${pr.description}`,
      `**Source Branch:** ${pr.sourceBranch}`,
      `**Target Branch:** ${pr.targetBranch}`,
      `**Repo:** ${pr.repoPath}`,
      `**Changed files:** ${pr.changedFiles.join(', ') || 'none detected'}`,
    ];

    if (pr.submitterNotes) {
      contextSections.push(
        '',
        '## Submitter Notes',
        pr.submitterNotes,
      );
    }

    contextSections.push(
      '',
      '## How to view the diff',
      `Run: git diff ${pr.targetBranch}...${pr.sourceBranch}`,
      `Or:  git log ${pr.targetBranch}..${pr.sourceBranch} --oneline`,
      '',
      '## Instructions',
      `Compare branch ${pr.sourceBranch} against ${pr.targetBranch} using git diff.`,
      'Be critical and thorough. Look for:',
      '- Bugs, edge cases, error handling gaps',
      '- Security issues',
      '- Performance problems',
      '- Code style and readability issues',
      '- Missing tests or documentation',
      '',
      ...screenshotSection,
      '',
      'Write your complete review to review.md in this directory.',
      'Start with a verdict line: VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED',
      'Then provide detailed feedback.',
    );

    writeFileSync(join(reviewDir, 'context.md'), contextSections.join('\n'));

    // Spawn reviewer — give it the repo, branch info, and let it git diff itself
    const reviewCommand = renderTemplate(loadTemplate('hermes-reviewer.txt'), {
      sourceBranch: pr.sourceBranch,
      targetBranch: pr.targetBranch,
      repoPath: pr.repoPath,
      reviewDir,
    });

    const terminal = this.terminalManager.create({
      title: `Review: ${pr.title}`,
      command: reviewCommand,
      cwd: pr.repoPath,
    });

    pr.reviewerTerminalId = terminal.id;
    pr.status = 'reviewing';
    pr.updatedAt = Date.now();

    this.persist(pr);
    this.emit('pr:updated', pr);
    return pr;
  }

  /**
   * Handle reviewer terminal exit — read review file and create comments.
   * If the reviewer died without producing a review and the PR is still in
   * 'reviewing' status, auto-relaunch up to MAX_REVIEWER_RELAUNCH times.
   */
  private handleReviewerExit(terminalId: string): void {
    // Check if this terminal was intentionally killed by an internal method
    // (relaunchReview, fixConflicts) that handles its own PR state cleanup.
    // External kills (user via UI, killAll) should still trigger cleanup here.
    if (this.intentionallyKilledTerminals.has(terminalId)) {
      this.intentionallyKilledTerminals.delete(terminalId);
      return;
    }

    // Find the PR this reviewer belongs to
    const pr = Array.from(this.prs.values()).find(
      (p) => p.reviewerTerminalId === terminalId
    );
    if (!pr) return;

    const reviewDir = join(config.reviewBase, pr.id);
    const reviewPath = join(reviewDir, 'review.md');

    if (existsSync(reviewPath)) {
      const review = readFileSync(reviewPath, 'utf-8');

      // Parse verdict
      const verdictMatch = review.match(/VERDICT:\s*(APPROVED|CHANGES_REQUESTED)/i);
      if (verdictMatch) {
        pr.verdict = verdictMatch[1].toLowerCase() as Verdict;
        pr.status = pr.verdict === 'approved' ? 'approved' : 'changes_requested';
      }

      // Add the review as a comment
      const comment: PRComment = {
        id: uuidv4(),
        prId: pr.id,
        author: 'hermes-reviewer',
        body: review,
        createdAt: Date.now(),
      };
      pr.comments.push(comment);

      // Reset relaunch attempts on successful review
      this.reviewerRelaunchAttempts.delete(pr.id);
    } else {
      // No review file — reviewer might have crashed/died
      // Try auto-relaunch if PR is still in reviewing status
      if (pr.status === 'reviewing') {
        const attempts = this.reviewerRelaunchAttempts.get(pr.id) || 0;
        if (attempts < MAX_REVIEWER_RELAUNCH) {
          this.reviewerRelaunchAttempts.set(pr.id, attempts + 1);

          // Log last few lines of terminal output for debugging
          const scrollback = this.terminalManager.getScrollback(terminalId);
          if (scrollback) {
            const lastLines = scrollback.split('\n').filter(Boolean).slice(-10).join('\n');
            if (lastLines) {
              console.log(`[auto-relaunch] Last output from reviewer for "${pr.title}":\n${lastLines}`);
            }
          }

          console.log(
            `[auto-relaunch] Reviewer died for PR "${pr.title}" — ` +
            `relaunching in ${this.relaunchDelayMs / 1000}s ` +
            `(attempt ${attempts + 1}/${MAX_REVIEWER_RELAUNCH})`
          );

          // Clean up the exited terminal from the manager
          this.terminalManager.kill(terminalId);

          // Clear stale terminal reference and persist intermediate state
          // so the frontend doesn't show a ghost terminal during the delay,
          // and a server crash during the window won't leave stale state.
          pr.reviewerTerminalId = null;
          pr.updatedAt = Date.now();
          this.persist(pr);
          this.emit('pr:updated', pr);

          // Schedule relaunch after delay
          const existingTimer = this.reviewerRelaunchTimers.get(pr.id);
          if (existingTimer) clearTimeout(existingTimer);

          const timer = setTimeout(() => {
            this.reviewerRelaunchTimers.delete(pr.id);
            this.performReviewerRelaunch(pr.id);
          }, this.relaunchDelayMs);
          this.reviewerRelaunchTimers.set(pr.id, timer);

          return; // Don't fall through — relaunch will handle cleanup
        }

        console.log(
          `[auto-relaunch] Max retries (${MAX_REVIEWER_RELAUNCH}) reached for PR "${pr.title}" — not relaunching`
        );
      }

      // No relaunch — add warning comment
      const comment: PRComment = {
        id: uuidv4(),
        prId: pr.id,
        author: 'hermes-reviewer',
        body: '⚠ Reviewer exited without producing a review file.',
        createdAt: Date.now(),
      };
      pr.comments.push(comment);
    }

    // Clean up the reviewer terminal — it has already exited, remove it from the manager
    if (pr.reviewerTerminalId) {
      this.terminalManager.kill(pr.reviewerTerminalId);
      pr.reviewerTerminalId = null;
    }

    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);
  }

  /**
   * Actually perform the reviewer relaunch after the delay.
   * Re-checks state in case things changed during the delay.
   */
  private performReviewerRelaunch(prId: string): void {
    const pr = this.prs.get(prId);
    if (!pr) return;

    // Re-check: status may have changed during the delay (e.g., user intervened)
    if (pr.status !== 'reviewing') return;

    // Re-check: if someone manually relaunched during the delay,
    // reviewerTerminalId will be non-null (pointing to the new terminal).
    // In that case, don't double-relaunch.
    if (pr.reviewerTerminalId !== null) return;

    console.log(`[auto-relaunch] Relaunching reviewer for PR "${pr.title}"`);
    // Use resetAttempts=false so auto-relaunch preserves the attempt counter
    this.relaunchReview(prId, undefined, undefined, { resetAttempts: false });
  }

  /**
   * Handle conflict fixer terminal exit — remove the terminal from the grid.
   * Gives 5 seconds for the user to see the final output, then auto-removes.
   */
  private handleConflictFixerExit(terminalId: string): void {
    this.conflictFixerTerminals.delete(terminalId);

    // Find the PR this conflict fixer belongs to
    const pr = Array.from(this.prs.values()).find(
      (p) => p.reviewerTerminalId === terminalId
    );

    if (!pr) {
      // No PR found — just remove the terminal after delay
      const timer = setTimeout(() => {
        this.pendingRemovalTimers.delete(terminalId);
        this.terminalManager.kill(terminalId);
      }, 5000);
      this.pendingRemovalTimers.set(terminalId, timer);
      return;
    }

    // Clear the terminal reference on the PR immediately
    pr.reviewerTerminalId = null;
    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);

    // Remove the terminal after a short delay so the user can see the final output,
    // then emit pr:updated again to trigger a terminal list refetch on the client
    const timer = setTimeout(() => {
      this.pendingRemovalTimers.delete(terminalId);
      this.terminalManager.kill(terminalId);
      this.emit('pr:updated', pr);
    }, 5000);
    this.pendingRemovalTimers.set(terminalId, timer);
  }

  /**
   * Relaunch a review — kill existing reviewer if any, re-spawn a new one.
   * Useful when the reviewer terminal crashed or the review was lost.
   */
  relaunchReview(
    prId: string,
    submitterNotes?: string,
    screenshotBypassReason?: string,
    options?: { resetAttempts?: boolean },
  ): PullRequest | null {
    const pr = this.prs.get(prId);
    if (!pr) return null;

    // Reset auto-relaunch attempts — a fresh (external) review gets fresh retries.
    // Internal auto-relaunches pass resetAttempts=false to preserve the counter.
    if (options?.resetAttempts !== false) {
      this.reviewerRelaunchAttempts.delete(prId);
    }

    // Cancel any pending auto-relaunch timer
    const pendingRelaunch = this.reviewerRelaunchTimers.get(prId);
    if (pendingRelaunch) {
      clearTimeout(pendingRelaunch);
      this.reviewerRelaunchTimers.delete(prId);
    }

    // Kill existing reviewer/fixer terminal if it's still around
    if (pr.reviewerTerminalId) {
      this.cancelPendingRemoval(pr.reviewerTerminalId);
      this.conflictFixerTerminals.delete(pr.reviewerTerminalId);
      // Mark as intentionally killed so handleReviewerExit skips cleanup
      this.intentionallyKilledTerminals.add(pr.reviewerTerminalId);
      this.terminalManager.kill(pr.reviewerTerminalId);
      pr.reviewerTerminalId = null;
    }

    // Delete stale review.md so a crashed re-reviewer doesn't pick up the old verdict
    const reviewPath = join(config.reviewBase, prId, 'review.md');
    try { unlinkSync(reviewPath); } catch {}

    // Update submitter notes and bypass reason if provided
    if (submitterNotes !== undefined) {
      pr.submitterNotes = submitterNotes;
    }
    if (screenshotBypassReason !== undefined) {
      pr.screenshotBypassReason = screenshotBypassReason;
    }

    // Reset status to open so spawnReviewer can set it to reviewing
    pr.status = 'open';
    pr.verdict = 'pending';
    pr.updatedAt = Date.now();

    // Re-generate the diff in case there were new changes
    const diff = this.worktreeManager.getDiff(pr.issueId);
    if (diff !== undefined) {
      pr.diff = diff;
      pr.changedFiles = this.worktreeManager.getChangedFiles(pr.issueId);
    }

    this.persist(pr);

    // Spawn a fresh reviewer
    return this.spawnReviewer(prId);
  }

  addComment(prId: string, author: string, body: string, file?: string, line?: number): PRComment | null {
    const pr = this.prs.get(prId);
    if (!pr) return null;

    const comment: PRComment = {
      id: uuidv4(),
      prId,
      author,
      body,
      file,
      line,
      createdAt: Date.now(),
    };

    pr.comments.push(comment);
    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);
    return comment;
  }

  setVerdict(prId: string, verdict: Verdict): PullRequest | null {
    const pr = this.prs.get(prId);
    if (!pr) return null;

    pr.verdict = verdict;
    pr.status = verdict === 'approved' ? 'approved' : 'changes_requested';
    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);
    return pr;
  }

  /**
   * Dry-run merge check — test if merge would succeed without actually doing it.
   */
  async checkMerge(prId: string): Promise<{ canMerge: boolean; hasConflicts: boolean; error?: string }> {
    const pr = this.prs.get(prId);
    if (!pr) return { canMerge: false, hasConflicts: false, error: 'PR not found' };

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const { mkdtempSync, rmSync } = await import('fs');
    const { join } = await import('path');
    const { tmpdir } = await import('os');
    const execAsync = promisify(exec);

    // Check branch exists
    try {
      await execAsync(`git rev-parse --verify ${pr.sourceBranch}`, { cwd: pr.repoPath });
    } catch {
      return { canMerge: false, hasConflicts: false, error: `Branch ${pr.sourceBranch} not found` };
    }

    // Create a temporary worktree to test the merge — never touch the main working tree
    const tmpDir = mkdtempSync(join(tmpdir(), 'hermes-merge-check-'));
    try {
      await execAsync(`git worktree add "${tmpDir}" ${pr.targetBranch} --detach`, { cwd: pr.repoPath });

      let canMerge = false;
      let hasConflicts = false;
      try {
        await execAsync(
          `git merge --no-commit --no-ff ${pr.sourceBranch}`,
          { cwd: tmpDir }
        );
        canMerge = true;
      } catch (err: any) {
        const msg = err.stderr?.toString() || err.stdout?.toString() || '';
        hasConflicts = msg.toLowerCase().includes('conflict') || msg.includes('CONFLICT');
      }

      return { canMerge, hasConflicts };
    } catch (err: any) {
      return { canMerge: false, hasConflicts: false, error: err.message };
    } finally {
      // Clean up temp worktree
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      try { await execAsync('git worktree prune', { cwd: pr.repoPath }); } catch {}
    }
  }

  /**
   * Spawn an agent to fix merge conflicts by merging target into the source branch.
   */
  fixConflicts(prId: string): { pr?: PullRequest; error?: string } {
    const pr = this.prs.get(prId);
    if (!pr) return { error: 'PR not found' };

    // Recreate worktree if needed
    let worktreePath = this.worktreeManager.get(pr.issueId)?.path;
    if (!worktreePath) {
      try {
        const wt = this.worktreeManager.create(pr.issueId, pr.title);
        worktreePath = wt.path;
      } catch (err: any) {
        // Worktree might already exist on disk but not in our map
        worktreePath = join(config.worktreeBase, pr.issueId);
        try {
          execFileSync('git', ['worktree', 'add', worktreePath, pr.sourceBranch], { cwd: pr.repoPath, stdio: 'pipe' });
        } catch {
          // Already exists, just use it
        }
      }
    }

    // Kill existing terminal before spawning a new one (avoids orphaned terminals)
    if (pr.reviewerTerminalId) {
      this.cancelPendingRemoval(pr.reviewerTerminalId);
      this.conflictFixerTerminals.delete(pr.reviewerTerminalId);
      // Mark as intentionally killed so handleReviewerExit skips cleanup
      this.intentionallyKilledTerminals.add(pr.reviewerTerminalId);
      this.terminalManager.kill(pr.reviewerTerminalId);
      pr.reviewerTerminalId = null;
    }

    // Spawn agent to merge target branch in and resolve conflicts
    const fixCommand = `hermes chat -q 'You are an autonomous conflict resolution agent. If a summarization step occurs, always continue working afterward — do not treat it as a stopping point. You are in a git worktree on branch ${pr.sourceBranch}. Run: git merge ${pr.targetBranch} — this will have conflicts. Resolve ALL conflicts by editing the files intelligently, keeping functionality from both sides. Then git add the resolved files and git commit. Do not stop until all conflicts are resolved and committed.'`;

    const terminal = this.terminalManager.create({
      title: `Fix conflicts: ${pr.title}`,
      command: fixCommand,
      cwd: worktreePath,
    });

    // Track this as a conflict fixer so we auto-remove on exit
    this.conflictFixerTerminals.add(terminal.id);

    pr.status = 'open';
    pr.reviewerTerminalId = terminal.id;
    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);
    return { pr };
  }

  merge(prId: string, options?: { skipGitHubClose?: boolean }): { pr?: PullRequest; error?: string } {
    const pr = this.prs.get(prId);
    if (!pr) return { error: 'PR not found' };

    // Remove worktree FIRST — git won't merge a branch checked out in a worktree
    this.worktreeManager.remove(pr.issueId, false);

    // Also force-remove the worktree dir if it still exists
    try {
      execSync(`git worktree prune`, { cwd: pr.repoPath, stdio: 'pipe' });
    } catch {}

    // Check the branch exists
    try {
      execSync(`git rev-parse --verify ${pr.sourceBranch}`, { cwd: pr.repoPath, stdio: 'pipe' });
    } catch {
      return { error: `Branch ${pr.sourceBranch} does not exist` };
    }

    // Stash any uncommitted changes in the main repo
    let stashed = false;
    try {
      const status = execSync('git status --porcelain', { cwd: pr.repoPath, stdio: 'pipe' }).toString().trim();
      if (status) {
        execSync('git stash', { cwd: pr.repoPath, stdio: 'pipe' });
        stashed = true;
      }
    } catch {}

    // Merge
    try {
      execSync(
        `git merge ${pr.sourceBranch} --no-ff -m "Merge ${pr.sourceBranch}"`,
        { cwd: pr.repoPath, stdio: 'pipe' }
      );
    } catch (err: any) {
      const gitError = err.stderr?.toString() || err.stdout?.toString() || err.message;
      console.error('Merge failed:', gitError);
      // Abort failed merge
      try { execSync('git merge --abort', { cwd: pr.repoPath, stdio: 'pipe' }); } catch {}
      // Restore stash
      if (stashed) {
        try { execSync('git stash pop', { cwd: pr.repoPath, stdio: 'pipe' }); } catch {}
      }
      const isConflict = gitError.toLowerCase().includes('conflict') || gitError.includes('CONFLICT');
      return {
        error: isConflict
          ? `Merge conflicts detected. Use "Fix Conflicts" to spawn an agent to resolve them.`
          : `Merge failed: ${gitError}`,
      };
    }

    // Restore stash after successful merge
    if (stashed) {
      try { execSync('git stash pop', { cwd: pr.repoPath, stdio: 'pipe' }); } catch {}
    }

    pr.status = 'merged';
    pr.updatedAt = Date.now();

    // Clean up the branch
    try {
      execSync(`git branch -d ${pr.sourceBranch}`, { cwd: pr.repoPath, stdio: 'pipe' });
    } catch {
      // Force delete if not fully merged (shouldn't happen after merge)
      try { execSync(`git branch -D ${pr.sourceBranch}`, { cwd: pr.repoPath, stdio: 'pipe' }); } catch {}
    }

    this.persist(pr);
    this.emit('pr:updated', pr);

    // GitHub integration: push merge, close GitHub PR, and clean up remote branch.
    // Operations are chained sequentially (fire-and-forget from caller's perspective)
    // because they have hard ordering dependencies:
    //   1. pushMerge must complete before closeGitHubPR (so merged state is visible on remote)
    //   2. deleteRemoteBranch must run after closeGitHubPR (PR still references the branch)
    //
    // When skipGitHubClose is true (used by 'both' mode), we still push the merge
    // to the remote, but skip closeGitHubPR and deleteRemoteBranch. In 'both' mode
    // a GH PR was just created — pushing the merge commit lets GitHub auto-detect
    // the merge and close the PR naturally. Explicitly closing it would race with
    // GitHub's detection and leave a confusing "Merged locally" comment.
    if (config.githubEnabled) {
      const sourceBranch = pr.sourceBranch;
      const githubPrUrl = pr.githubPrUrl;
      const repoPath = pr.repoPath;
      const skipClose = options?.skipGitHubClose ?? false;

      (async () => {
        try {
          const pushResult = await pushMerge(pr.targetBranch, repoPath);
          if (!pushResult.success) {
            console.warn(`[github] Push merge failed, skipping GitHub cleanup: ${pushResult.error}`);
            return;
          }
          if (!skipClose) {
            if (githubPrUrl) {
              await closeGitHubPR(githubPrUrl, repoPath);
              // Don't gate deleteRemoteBranch on close success —
              // branch should be cleaned up even if closing the PR fails
            }
            await deleteRemoteBranch(sourceBranch, repoPath);
          }
        } catch (err) {
          console.error('[github] Error during merge cleanup:', err);
        }
      })();
    }

    return { pr };
  }

  /**
   * Push branch and create a GitHub PR without merging locally.
   * Used when mergeMode is 'github' or 'both'.
   */
  async createGitHubPRForMerge(prId: string): Promise<{ pr?: PullRequest; prUrl?: string; error?: string }> {
    const pr = this.prs.get(prId);
    if (!pr) return { error: 'PR not found' };

    // Push the branch to the remote
    const pushResult = await pushBranch(pr.sourceBranch, pr.repoPath);
    if (!pushResult.success) {
      return { error: `Failed to push branch: ${pushResult.error}` };
    }

    // Create the GitHub PR
    const ghResult = await createGitHubPR(
      pr.title,
      pr.description || pr.submitterNotes || '',
      pr.sourceBranch,
      pr.targetBranch,
      pr.repoPath,
    );
    if (!ghResult.success || !ghResult.prUrl) {
      return { error: `Failed to create GitHub PR: ${ghResult.error}` };
    }

    // Store the GitHub PR URL — use setGithubPrUrl to enforce URL validation
    // (defense-in-depth: validates the URL starts with https://github.com/)
    const updated = this.setGithubPrUrl(prId, ghResult.prUrl);
    if (!updated) {
      return { error: `GitHub returned an invalid PR URL: ${ghResult.prUrl}` };
    }

    return { pr: updated, prUrl: ghResult.prUrl };
  }

  /**
   * Confirm that a PR was merged on GitHub — mark it as merged and move to done.
   * Used when mergeMode is 'github' and the user confirms the merge happened on GH.
   */
  confirmMerge(prId: string): { pr?: PullRequest; error?: string } {
    const pr = this.prs.get(prId);
    if (!pr) return { error: 'PR not found' };

    if (pr.status === 'merged') return { error: 'PR is already merged' };
    if (pr.status === 'closed') return { error: 'PR is closed' };

    // Remove worktree
    this.worktreeManager.remove(pr.issueId, false);
    try {
      execSync('git worktree prune', { cwd: pr.repoPath, stdio: 'pipe' });
    } catch {}

    pr.status = 'merged';
    pr.updatedAt = Date.now();

    // Clean up the local branch
    try {
      execSync(`git branch -d ${pr.sourceBranch}`, { cwd: pr.repoPath, stdio: 'pipe' });
    } catch {
      try { execSync(`git branch -D ${pr.sourceBranch}`, { cwd: pr.repoPath, stdio: 'pipe' }); } catch {}
    }

    this.persist(pr);
    this.emit('pr:updated', pr);

    // Clean up the remote branch (fire-and-forget).
    // GitHub's "auto-delete branch" setting may handle this, but if disabled,
    // stale remote branches accumulate. Safe to call even if already deleted.
    if (config.githubEnabled) {
      const sourceBranch = pr.sourceBranch;
      const repoPath = pr.repoPath;
      deleteRemoteBranch(sourceBranch, repoPath).catch((err) => {
        console.warn('[confirmMerge] Failed to delete remote branch:', err);
      });
    }

    return { pr };
  }

  /**
   * Set the GitHub PR URL on a pull request.
   * Called after successfully creating a GitHub PR.
   * Validates that the URL is a GitHub HTTPS URL to prevent XSS via href injection.
   */
  setGithubPrUrl(prId: string, url: string): PullRequest | null {
    const pr = this.prs.get(prId);
    if (!pr) return null;

    // Validate URL — must be a GitHub HTTPS URL (prevents javascript: or other scheme injection)
    if (!url.startsWith('https://github.com/')) {
      console.warn(`[github] Rejected non-GitHub URL for PR ${prId}: ${url}`);
      return null;
    }

    pr.githubPrUrl = url;
    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);
    return pr;
  }

  get(id: string): PullRequest | undefined {
    return this.prs.get(id);
  }

  /**
   * Close a PR — mark it as closed. Kills any active reviewer/fixer terminal.
   * Cannot close a PR that is already merged.
   */
  close(prId: string): PullRequest | null {
    const pr = this.prs.get(prId);
    if (!pr) return null;
    if (pr.status === 'merged') return null;

    // Kill active reviewer/fixer terminal if any
    if (pr.reviewerTerminalId) {
      this.cancelPendingRemoval(pr.reviewerTerminalId);
      this.conflictFixerTerminals.delete(pr.reviewerTerminalId);
      this.intentionallyKilledTerminals.add(pr.reviewerTerminalId);
      this.terminalManager.kill(pr.reviewerTerminalId);
      pr.reviewerTerminalId = null;
    }

    // Cancel any pending auto-relaunch
    const pendingRelaunch = this.reviewerRelaunchTimers.get(prId);
    if (pendingRelaunch) {
      clearTimeout(pendingRelaunch);
      this.reviewerRelaunchTimers.delete(prId);
    }
    this.reviewerRelaunchAttempts.delete(prId);

    pr.status = 'closed';
    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);
    return pr;
  }

  /**
   * Reset a PR back to open/pending state.
   * Returns the updated PR on success, or null if the PR doesn't exist
   * or is in a terminal state (merged/closed) and cannot be reset.
   */
  resetToOpen(prId: string): PullRequest | null {
    const pr = this.prs.get(prId);
    if (!pr) return null;
    if (pr.status === 'merged' || pr.status === 'closed') return null;

    pr.status = 'open';
    pr.verdict = 'pending';
    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);
    return pr;
  }

  getByIssueId(issueId: string): PullRequest | undefined {
    let found: PullRequest | undefined;
    this.prs.forEach((pr) => {
      if (pr.issueId === issueId) found = pr;
    });
    return found;
  }

  list(): PullRequest[] {
    return Array.from(this.prs.values());
  }

  get size(): number {
    return this.prs.size;
  }
}
