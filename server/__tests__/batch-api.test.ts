import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { TerminalManager } from '../src/terminal-manager.js';
import { WorktreeManager } from '../src/worktree-manager.js';
import { PRManager, type PullRequest } from '../src/pr-manager.js';
import { IssueManager, type Issue } from '../src/issue-manager.js';
import { createBatchApiRouter } from '../src/batch-api.js';

async function request(server: Server, method: string, path: string, body?: any) {
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

/** Insert a fake PR directly into PRManager's internal map for testing */
function insertTestPR(prManager: PRManager, overrides: Partial<PullRequest> = {}): PullRequest {
  const pr: PullRequest = {
    id: `pr-${Math.random().toString(36).slice(2, 8)}`,
    issueId: 'test-issue-1',
    title: 'Test PR',
    description: 'A test pull request',
    submitterNotes: '',
    sourceBranch: 'issue/test-branch',
    targetBranch: 'master',
    repoPath: '/tmp/test-repo',
    status: 'open',
    diff: 'diff --git a/file.ts b/file.ts\n+added line',
    changedFiles: ['file.ts'],
    verdict: 'pending',
    reviewerTerminalId: null,
    comments: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
  (prManager as any).prs.set(pr.id, pr);
  return pr;
}

/** Insert a fake issue directly into IssueManager's internal map for testing */
function insertTestIssue(issueManager: IssueManager, overrides: Partial<Issue> = {}): Issue {
  const issue: Issue = {
    id: `issue-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Issue',
    description: 'A test issue',
    status: 'todo',
    agent: 'hermes',
    command: '',
    terminalId: null,
    branch: null,
    parentId: null,
    progressMessage: null,
    progressPercent: null,
    progressUpdatedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
  (issueManager as any).issues.set(issue.id, issue);
  return issue;
}

describe('Batch API — GET /batch/status', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let issueManager: IssueManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);

    const app = express();
    app.use('/batch', createBatchApiRouter(prManager, issueManager, terminalManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    prManager.clearAllPendingTimers();
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns empty dashboard when no issues or PRs', async () => {
    const res = await request(server, 'GET', '/batch/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      done: 0,
      active: 0,
      inProgress: [],
      review: [],
      todo: [],
      approvedPrs: [],
      changesRequested: [],
      deadReviewers: [],
      terminalCount: 0,
    });
  });

  it('counts issues by status', async () => {
    insertTestIssue(issueManager, { status: 'done' });
    insertTestIssue(issueManager, { status: 'done' });
    insertTestIssue(issueManager, { status: 'in_progress', agent: 'hermes' });
    insertTestIssue(issueManager, { status: 'todo' });
    insertTestIssue(issueManager, { status: 'review' });

    const res = await request(server, 'GET', '/batch/status');
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(2);
    expect(res.body.active).toBe(1);
    expect(res.body.inProgress).toHaveLength(1);
    expect(res.body.review).toHaveLength(1);
    expect(res.body.todo).toHaveLength(1);
  });

  it('lists approved PRs that are not merged', async () => {
    insertTestPR(prManager, { id: 'pr-1', title: 'Approved PR', verdict: 'approved', status: 'approved' });
    insertTestPR(prManager, { id: 'pr-2', title: 'Merged PR', verdict: 'approved', status: 'merged' });

    const res = await request(server, 'GET', '/batch/status');
    expect(res.body.approvedPrs).toHaveLength(1);
    expect(res.body.approvedPrs[0].id).toBe('pr-1');
  });

  it('lists changes_requested PRs excluding merged and closed', async () => {
    insertTestPR(prManager, { id: 'pr-1', title: 'Rejected PR', verdict: 'changes_requested', status: 'changes_requested' });
    // These should be excluded from changesRequested
    insertTestPR(prManager, { id: 'pr-2', title: 'Merged but was rejected', verdict: 'changes_requested', status: 'merged' });
    insertTestPR(prManager, { id: 'pr-3', title: 'Closed but was rejected', verdict: 'changes_requested', status: 'closed' });

    const res = await request(server, 'GET', '/batch/status');
    expect(res.body.changesRequested).toHaveLength(1);
    expect(res.body.changesRequested[0].id).toBe('pr-1');
  });

  it('detects dead reviewers', async () => {
    // PR in reviewing status with null reviewerTerminalId = dead reviewer
    insertTestPR(prManager, {
      id: 'pr-dead',
      title: 'Dead Reviewer PR',
      status: 'reviewing',
      reviewerTerminalId: null,
    });

    // PR in reviewing status with a valid terminal = alive reviewer
    const term = terminalManager.create({ title: 'Reviewer' });
    insertTestPR(prManager, {
      id: 'pr-alive',
      title: 'Alive Reviewer PR',
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    const res = await request(server, 'GET', '/batch/status');
    expect(res.body.deadReviewers).toHaveLength(1);
    expect(res.body.deadReviewers[0].id).toBe('pr-dead');
  });

  it('detects dead reviewers with stale terminal IDs', async () => {
    // PR with a reviewerTerminalId that doesn't exist in the terminal manager
    insertTestPR(prManager, {
      id: 'pr-stale',
      title: 'Stale Terminal PR',
      status: 'reviewing',
      reviewerTerminalId: 'nonexistent-terminal-id',
    });

    const res = await request(server, 'GET', '/batch/status');
    expect(res.body.deadReviewers).toHaveLength(1);
    expect(res.body.deadReviewers[0].id).toBe('pr-stale');
  });

  it('returns terminal count', async () => {
    terminalManager.create({ title: 'Term 1' });
    terminalManager.create({ title: 'Term 2' });

    const res = await request(server, 'GET', '/batch/status');
    expect(res.body.terminalCount).toBe(2);
  });
});

describe('Batch API — POST /batch/restart-crashed', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let issueManager: IssueManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);

    const app = express();
    app.use('/batch', createBatchApiRouter(prManager, issueManager, terminalManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    prManager.clearAllPendingTimers();
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('restarts crashed issues (todo with non-null branch)', async () => {
    // Crashed agents: todo status with a branch (previously started)
    const issue1 = insertTestIssue(issueManager, { status: 'todo', title: 'Crashed 1', branch: 'issue/crashed-1' });
    const issue2 = insertTestIssue(issueManager, { status: 'todo', title: 'Crashed 2', branch: 'issue/crashed-2' });
    // This one shouldn't be affected — it's in_progress
    insertTestIssue(issueManager, { status: 'in_progress', title: 'Already running', branch: 'issue/running' });

    const res = await request(server, 'POST', '/batch/restart-crashed');
    expect(res.status).toBe(200);
    expect(res.body.restarted).toHaveLength(2);
    expect(res.body.restarted.map((r: any) => r.id).sort()).toEqual(
      [issue1.id, issue2.id].sort()
    );

    // Verify status changed
    expect(issueManager.get(issue1.id)!.status).toBe('in_progress');
    expect(issueManager.get(issue2.id)!.status).toBe('in_progress');
  });

  it('skips fresh todo issues that were never started (branch=null)', async () => {
    // Fresh todo issue — never started, no branch
    insertTestIssue(issueManager, { status: 'todo', title: 'Fresh todo', branch: null });
    // Crashed issue with a branch
    const crashed = insertTestIssue(issueManager, { status: 'todo', title: 'Crashed', branch: 'issue/crashed' });

    const res = await request(server, 'POST', '/batch/restart-crashed');
    expect(res.status).toBe(200);
    expect(res.body.restarted).toHaveLength(1);
    expect(res.body.restarted[0].id).toBe(crashed.id);
  });

  it('returns empty array when no crashed issues', async () => {
    insertTestIssue(issueManager, { status: 'in_progress', branch: 'issue/running' });
    insertTestIssue(issueManager, { status: 'done', branch: 'issue/done' });
    // Fresh todo (no branch) should not be restarted
    insertTestIssue(issueManager, { status: 'todo', branch: null });

    const res = await request(server, 'POST', '/batch/restart-crashed');
    expect(res.status).toBe(200);
    expect(res.body.restarted).toEqual([]);
  });

  it('includes errors array for issues that fail to restart', async () => {
    const issue = insertTestIssue(issueManager, { status: 'todo', title: 'Will fail', branch: 'issue/fail' });
    vi.spyOn(issueManager, 'changeStatus').mockImplementationOnce(() => {
      throw new Error('changeStatus failed');
    });

    const res = await request(server, 'POST', '/batch/restart-crashed');
    expect(res.status).toBe(200);
    expect(res.body.restarted).toEqual([]);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].id).toBe(issue.id);
    expect(res.body.errors[0].error).toBe('changeStatus failed');
  });
});

describe('Batch API — POST /batch/relaunch-reviewers', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let issueManager: IssueManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);

    const app = express();
    app.use('/batch', createBatchApiRouter(prManager, issueManager, terminalManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    prManager.clearAllPendingTimers();
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('relaunches reviews for PRs with dead reviewers', async () => {
    // Dead reviewer: reviewing status, null terminal
    const pr = insertTestPR(prManager, {
      id: 'pr-dead-1',
      title: 'Dead Reviewer',
      status: 'reviewing',
      reviewerTerminalId: null,
    });

    const res = await request(server, 'POST', '/batch/relaunch-reviewers');
    expect(res.status).toBe(200);
    expect(res.body.relaunched).toHaveLength(1);
    expect(res.body.relaunched[0].prId).toBe('pr-dead-1');

    // The PR should now have a live reviewer terminal
    const updated = prManager.get(pr.id);
    expect(updated!.reviewerTerminalId).not.toBeNull();
  });

  it('skips PRs with live reviewers', async () => {
    const term = terminalManager.create({ title: 'Active reviewer' });
    insertTestPR(prManager, {
      id: 'pr-alive-1',
      title: 'Alive Reviewer',
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    const res = await request(server, 'POST', '/batch/relaunch-reviewers');
    expect(res.status).toBe(200);
    expect(res.body.relaunched).toEqual([]);
  });

  it('skips PRs not in reviewing status', async () => {
    insertTestPR(prManager, {
      id: 'pr-approved-1',
      title: 'Approved',
      status: 'approved',
      reviewerTerminalId: null,
    });

    const res = await request(server, 'POST', '/batch/relaunch-reviewers');
    expect(res.status).toBe(200);
    expect(res.body.relaunched).toEqual([]);
  });

  it('returns empty array when no dead reviewers', async () => {
    const res = await request(server, 'POST', '/batch/relaunch-reviewers');
    expect(res.status).toBe(200);
    expect(res.body.relaunched).toEqual([]);
  });

  it('handles relaunchReview returning null without crashing', async () => {
    insertTestPR(prManager, {
      id: 'pr-vanish',
      title: 'Vanishing PR',
      status: 'reviewing',
      reviewerTerminalId: null,
    });

    // Simulate relaunchReview returning null (e.g., PR deleted between filter and relaunch)
    vi.spyOn(prManager, 'relaunchReview').mockReturnValueOnce(null as any);

    const res = await request(server, 'POST', '/batch/relaunch-reviewers');
    expect(res.status).toBe(200);
    // Should not appear in relaunched since relaunchReview returned null
    expect(res.body.relaunched).toEqual([]);
    expect(res.body.errors).toEqual([]);
  });

  it('captures errors when relaunchReview throws', async () => {
    insertTestPR(prManager, {
      id: 'pr-throw',
      title: 'Throws on relaunch',
      status: 'reviewing',
      reviewerTerminalId: null,
    });

    vi.spyOn(prManager, 'relaunchReview').mockImplementationOnce(() => {
      throw new Error('filesystem error');
    });

    const res = await request(server, 'POST', '/batch/relaunch-reviewers');
    expect(res.status).toBe(200);
    expect(res.body.relaunched).toEqual([]);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].prId).toBe('pr-throw');
    expect(res.body.errors[0].error).toBe('filesystem error');
  });
});

describe('Batch API — POST /batch/send-back-rejected', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let issueManager: IssueManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);

    const app = express();
    app.use('/batch', createBatchApiRouter(prManager, issueManager, terminalManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    prManager.clearAllPendingTimers();
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends back rejected PRs by moving linked issues to in_progress', async () => {
    const issue = insertTestIssue(issueManager, {
      id: 'issue-rejected',
      title: 'Rejected Issue',
      status: 'review',
    });
    insertTestPR(prManager, {
      id: 'pr-rejected-1',
      title: 'Rejected PR',
      issueId: issue.id,
      verdict: 'changes_requested',
      status: 'changes_requested',
    });

    const res = await request(server, 'POST', '/batch/send-back-rejected');
    expect(res.status).toBe(200);
    expect(res.body.sentBack).toHaveLength(1);
    expect(res.body.sentBack[0].issueId).toBe(issue.id);

    // Verify the issue moved to in_progress
    expect(issueManager.get(issue.id)!.status).toBe('in_progress');
  });

  it('resets PR to open/pending after sending back', async () => {
    const issue = insertTestIssue(issueManager, {
      id: 'issue-reset',
      title: 'Reset Issue',
      status: 'review',
    });
    const pr = insertTestPR(prManager, {
      id: 'pr-reset-1',
      title: 'Reset PR',
      issueId: issue.id,
      verdict: 'changes_requested',
      status: 'changes_requested',
    });

    await request(server, 'POST', '/batch/send-back-rejected');

    // PR should be reset to open/pending
    const updated = prManager.get(pr.id)!;
    expect(updated.status).toBe('open');
    expect(updated.verdict).toBe('pending');
  });

  it('skips issues not in review status', async () => {
    const issue = insertTestIssue(issueManager, {
      id: 'issue-already-ip',
      title: 'Already In Progress',
      status: 'in_progress',
    });
    insertTestPR(prManager, {
      id: 'pr-rejected-2',
      title: 'Rejected PR 2',
      issueId: issue.id,
      verdict: 'changes_requested',
    });

    const res = await request(server, 'POST', '/batch/send-back-rejected');
    expect(res.status).toBe(200);
    expect(res.body.sentBack).toEqual([]);
  });

  it('skips PRs without matching issues', async () => {
    insertTestPR(prManager, {
      id: 'pr-orphan',
      title: 'Orphan PR',
      issueId: 'nonexistent-issue',
      verdict: 'changes_requested',
    });

    const res = await request(server, 'POST', '/batch/send-back-rejected');
    expect(res.status).toBe(200);
    expect(res.body.sentBack).toEqual([]);
  });

  it('skips merged PRs even if verdict is changes_requested', async () => {
    const issue = insertTestIssue(issueManager, {
      id: 'issue-merged',
      title: 'Merged Issue',
      status: 'review',
    });
    insertTestPR(prManager, {
      id: 'pr-merged-rejected',
      title: 'Merged but was rejected',
      issueId: issue.id,
      verdict: 'changes_requested',
      status: 'merged',
    });

    const res = await request(server, 'POST', '/batch/send-back-rejected');
    expect(res.status).toBe(200);
    expect(res.body.sentBack).toEqual([]);
  });

  it('returns empty array when no rejected PRs', async () => {
    insertTestPR(prManager, {
      verdict: 'approved',
      status: 'approved',
    });

    const res = await request(server, 'POST', '/batch/send-back-rejected');
    expect(res.status).toBe(200);
    expect(res.body.sentBack).toEqual([]);
  });
});

describe('Batch API — POST /batch/merge-approved', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let issueManager: IssueManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);

    const app = express();
    app.use('/batch', createBatchApiRouter(prManager, issueManager, terminalManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    prManager.clearAllPendingTimers();
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns empty results when no approved PRs', async () => {
    insertTestPR(prManager, { verdict: 'pending', status: 'reviewing' });

    const res = await request(server, 'POST', '/batch/merge-approved');
    expect(res.status).toBe(200);
    expect(res.body.merged).toEqual([]);
    expect(res.body.conflicts).toEqual([]);
    expect(res.body.errors).toEqual([]);
  });

  it('skips already-merged PRs', async () => {
    insertTestPR(prManager, { verdict: 'approved', status: 'merged' });

    const res = await request(server, 'POST', '/batch/merge-approved');
    expect(res.status).toBe(200);
    expect(res.body.merged).toEqual([]);
  });

  it('reports errors for PRs that fail to merge (e.g. missing branch)', async () => {
    insertTestPR(prManager, {
      id: 'pr-no-branch',
      title: 'PR with missing branch',
      verdict: 'approved',
      status: 'approved',
      sourceBranch: 'nonexistent-branch-xyz',
      repoPath: '/tmp',
    });

    const res = await request(server, 'POST', '/batch/merge-approved');
    expect(res.status).toBe(200);
    // Should end up in errors (branch doesn't exist)
    const totalResults = res.body.merged.length + res.body.conflicts.length + res.body.errors.length;
    expect(totalResults).toBeGreaterThan(0);
  });

  it('does not crash if merge() throws an unexpected error', async () => {
    insertTestPR(prManager, {
      id: 'pr-throws',
      title: 'PR that throws',
      verdict: 'approved',
      status: 'approved',
    });

    vi.spyOn(prManager, 'merge').mockImplementationOnce(() => {
      throw new Error('unexpected git error');
    });

    const res = await request(server, 'POST', '/batch/merge-approved');
    expect(res.status).toBe(200);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].id).toBe('pr-throws');
    expect(res.body.errors[0].error).toBe('unexpected git error');
  });
});
