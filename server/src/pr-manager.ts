import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
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
      'Write your complete review to review.md in this directory.',
      'Start with a verdict line: VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED',
      'Then provide detailed feedback.',
    ].join('\n'));

    // Spawn reviewer — give it the repo, branch info, and let it git diff itself
    const reviewCommand = `hermes chat -q 'You are an adversarial code reviewer. You are reviewing branch ${pr.sourceBranch} against ${pr.targetBranch} in repo ${pr.repoPath}. Run git diff ${pr.targetBranch}...${pr.sourceBranch} in the repo to see the changes. Read ${reviewDir}/context.md for context. Write a thorough critical review to ${reviewDir}/review.md. Start with VERDICT: APPROVED or VERDICT: CHANGES_REQUESTED. Be rigorous.'`;

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

  merge(prId: string): PullRequest | null {
    const pr = this.prs.get(prId);
    if (!pr) return null;

    // Remove worktree FIRST — git won't merge a branch checked out in a worktree
    this.worktreeManager.remove(pr.issueId, false);

    // Merge using git directly
    try {
      execSync(
        `git merge ${pr.sourceBranch} --no-ff -m "Merge ${pr.sourceBranch}"`,
        { cwd: pr.repoPath, stdio: 'pipe' }
      );
    } catch (err: any) {
      console.error('Merge failed:', err.stderr?.toString() || err.message);
      return null;
    }

    pr.status = 'merged';
    pr.updatedAt = Date.now();

    // Clean up the branch
    try {
      execSync(`git branch -d ${pr.sourceBranch}`, { cwd: pr.repoPath, stdio: 'pipe' });
    } catch {}

    this.persist(pr);
    this.emit('pr:updated', pr);
    return pr;
  }

  get(id: string): PullRequest | undefined {
    return this.prs.get(id);
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
