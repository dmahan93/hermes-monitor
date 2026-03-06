import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { TerminalManager } from './terminal-manager.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { Store } from './store.js';
import { config } from './config.js';

export type PRStatus = 'open' | 'reviewing' | 'approved' | 'changes_requested' | 'merged' | 'closed';
export type Verdict = 'pending' | 'approved' | 'changes_requested';

export interface PRComment {
  id: string;
  prId: string;
  author: string;
  body: string;
  file?: string;
  line?: number;
  createdAt: number;
}

export interface PullRequest {
  id: string;
  issueId: string;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  repoPath: string;
  status: PRStatus;
  diff: string;
  changedFiles: string[];
  verdict: Verdict;
  reviewerTerminalId: string | null;
  comments: PRComment[];
  createdAt: number;
  updatedAt: number;
}

export interface CreatePROptions {
  issueId: string;
  title: string;
  description?: string;
}

export type PREventCallback = (event: string, pr: PullRequest) => void;

export class PRManager {
  private prs = new Map<string, PullRequest>();
  private terminalManager: TerminalManager;
  private worktreeManager: WorktreeManager;
  private store: Store | null = null;
  private eventCallbacks: PREventCallback[] = [];

  constructor(terminalManager: TerminalManager, worktreeManager: WorktreeManager) {
    this.terminalManager = terminalManager;
    this.worktreeManager = worktreeManager;

    // When reviewer terminal exits, read the review file
    this.terminalManager.onExit((terminalId, _exitCode) => {
      this.handleReviewerExit(terminalId);
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

  private emit(event: string, pr: PullRequest): void {
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
    writeFileSync(join(reviewDir, 'context.md'), [
      `# PR Review: ${pr.title}`,
      '',
      `**Description:** ${pr.description}`,
      `**Source Branch:** ${pr.sourceBranch}`,
      `**Target Branch:** ${pr.targetBranch}`,
      `**Repo:** ${pr.repoPath}`,
      `**Changed files:** ${pr.changedFiles.join(', ') || 'none detected'}`,
      '',
      '## How to view the diff',
      `Run: git diff ${pr.targetBranch}...${pr.sourceBranch}`,
      `Or:  git log ${pr.targetBranch}..${pr.sourceBranch} --oneline`,
      '',
      '## How to view the diff',
      `Run: git diff ${pr.targetBranch}...${pr.sourceBranch}`,
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
      '## Screenshots for UI Changes',
      'If the PR modifies UI components (.tsx, .css, .html files), check that:',
      '- The PR description includes before/after screenshots showing the visual changes',
      '- Screenshots use markdown image syntax: ![description](url)',
      '- If screenshots are missing for UI changes, flag this in your review',
      '  and request them with VERDICT: CHANGES_REQUESTED',
      '',
      'Write your complete review to review.md in this directory.',
      'Start with a verdict line: VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED',
      'Then provide detailed feedback.',
    ].join('\n'));

    // Spawn reviewer — give it the repo, branch info, and let it git diff itself
    const reviewCommand = `hermes chat -q 'You are an adversarial code reviewer. If a summarization step occurs, always continue working afterward — do not treat it as a stopping point. You are reviewing branch ${pr.sourceBranch} against ${pr.targetBranch} in repo ${pr.repoPath}. Run git diff ${pr.targetBranch}...${pr.sourceBranch} in the repo to see the changes. Read ${reviewDir}/context.md for context. Write a thorough critical review to ${reviewDir}/review.md. Start with VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED. Be rigorous. Do not stop until the review file is written.'`;

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
   */
  private handleReviewerExit(terminalId: string): void {
    // Find the PR this reviewer belongs to
    let targetPr: PullRequest | null = null;
    this.prs.forEach((pr) => {
      if (pr.reviewerTerminalId === terminalId) {
        targetPr = pr;
      }
    });
    if (!targetPr) return;
    const pr = targetPr as PullRequest;

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
    } else {
      // No review file — reviewer might have failed
      const comment: PRComment = {
        id: uuidv4(),
        prId: pr.id,
        author: 'hermes-reviewer',
        body: '⚠ Reviewer exited without producing a review file.',
        createdAt: Date.now(),
      };
      pr.comments.push(comment);
    }

    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);
  }

  /**
   * Relaunch a review — kill existing reviewer if any, re-spawn a new one.
   * Useful when the reviewer terminal crashed or the review was lost.
   */
  relaunchReview(prId: string): PullRequest | null {
    const pr = this.prs.get(prId);
    if (!pr) return null;

    // Kill existing reviewer terminal if it's still around
    if (pr.reviewerTerminalId) {
      this.terminalManager.kill(pr.reviewerTerminalId);
      pr.reviewerTerminalId = null;
    }

    // Delete stale review.md so a crashed re-reviewer doesn't pick up the old verdict
    const reviewPath = join(config.reviewBase, prId, 'review.md');
    try { unlinkSync(reviewPath); } catch {}

    // Reset status to open so spawnReviewer can set it to reviewing
    pr.status = 'open';
    pr.verdict = 'pending';
    pr.updatedAt = Date.now();

    // Re-generate the diff in case there were new changes
    const diff = this.worktreeManager.getDiff(pr.issueId);
    if (diff !== null) {
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
  checkMerge(prId: string): { canMerge: boolean; hasConflicts: boolean; error?: string } {
    const pr = this.prs.get(prId);
    if (!pr) return { canMerge: false, hasConflicts: false, error: 'PR not found' };

    // Check branch exists
    try {
      execSync(`git rev-parse --verify ${pr.sourceBranch}`, { cwd: pr.repoPath, stdio: 'pipe' });
    } catch {
      return { canMerge: false, hasConflicts: false, error: `Branch ${pr.sourceBranch} not found` };
    }

    // Stash if dirty
    let stashed = false;
    try {
      const status = execSync('git status --porcelain', { cwd: pr.repoPath, stdio: 'pipe' }).toString().trim();
      if (status) {
        execSync('git stash', { cwd: pr.repoPath, stdio: 'pipe' });
        stashed = true;
      }
    } catch {}

    // Try dry-run merge
    let canMerge = false;
    let hasConflicts = false;
    try {
      execSync(
        `git merge --no-commit --no-ff ${pr.sourceBranch}`,
        { cwd: pr.repoPath, stdio: 'pipe' }
      );
      canMerge = true;
    } catch (err: any) {
      const msg = err.stderr?.toString() || err.stdout?.toString() || '';
      hasConflicts = msg.toLowerCase().includes('conflict') || msg.includes('CONFLICT');
    }

    // Always abort the test merge
    try { execSync('git merge --abort', { cwd: pr.repoPath, stdio: 'pipe' }); } catch {}

    // Restore stash
    if (stashed) {
      try { execSync('git stash pop', { cwd: pr.repoPath, stdio: 'pipe' }); } catch {}
    }

    return { canMerge, hasConflicts };
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
        worktreePath = `/tmp/hermes-worktrees/${pr.issueId}`;
        try {
          execSync(`git worktree add "${worktreePath}" ${pr.sourceBranch}`, { cwd: pr.repoPath, stdio: 'pipe' });
        } catch {
          // Already exists, just use it
        }
      }
    }

    // Spawn agent to merge target branch in and resolve conflicts
    const fixCommand = `hermes chat -q 'You are an autonomous conflict resolution agent. If a summarization step occurs, always continue working afterward — do not treat it as a stopping point. You are in a git worktree on branch ${pr.sourceBranch}. Run: git merge ${pr.targetBranch} — this will have conflicts. Resolve ALL conflicts by editing the files intelligently, keeping functionality from both sides. Then git add the resolved files and git commit. Do not stop until all conflicts are resolved and committed.'`;

    const terminal = this.terminalManager.create({
      title: `Fix conflicts: ${pr.title}`,
      command: fixCommand,
      cwd: worktreePath,
    });

    pr.status = 'open';
    pr.reviewerTerminalId = terminal.id;
    pr.updatedAt = Date.now();
    this.persist(pr);
    this.emit('pr:updated', pr);
    return { pr };
  }

  merge(prId: string): { pr?: PullRequest; error?: string } {
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
    return { pr };
  }

  get(id: string): PullRequest | undefined {
    return this.prs.get(id);
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
