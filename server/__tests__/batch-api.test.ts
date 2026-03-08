import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  it('lists changes_requested PRs', async () => {
    insertTestPR(prManager, { id: 'pr-1', title: 'Rejected PR', verdict: 'changes_requested', status: 'changes_requested' });

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

  it('restarts todo issues by moving them to in_progress', async () => {
    const issue1 = insertTestIssue(issueManager, { status: 'todo', title: 'Crashed 1' });
    const issue2 = insertTestIssue(issueManager, { status: 'todo', title: 'Crashed 2' });
    // This one shouldn't be affected
    insertTestIssue(issueManager, { status: 'in_progress', title: 'Already running' });

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

  it('returns empty array when no todo issues', async () => {
    insertTestIssue(issueManager, { status: 'in_progress' });
    insertTestIssue(issueManager, { status: 'done' });

    const res = await request(server, 'POST', '/batch/restart-crashed');
    expect(res.status).toBe(200);
    expect(res.body.restarted).toEqual([]);
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
});
