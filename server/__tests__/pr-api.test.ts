import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { TerminalManager } from '../src/terminal-manager.js';
import { WorktreeManager } from '../src/worktree-manager.js';
import { PRManager, type PullRequest } from '../src/pr-manager.js';
import { IssueManager } from '../src/issue-manager.js';
import { createPRApiRouter } from '../src/pr-api.js';
import { config } from '../src/config.js';

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
    id: 'test-pr-1',
    issueId: 'test-issue-1',
    title: 'Test PR',
    description: 'A test pull request',
    sourceBranch: 'issue/test-branch',
    targetBranch: 'master',
    repoPath: '/tmp/test-repo',
    status: 'reviewing',
    diff: 'diff --git a/file.ts b/file.ts\n+added line',
    changedFiles: ['file.ts'],
    verdict: 'pending',
    reviewerTerminalId: null,
    comments: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
  // Access private map to insert test fixture
  (prManager as any).prs.set(pr.id, pr);
  return pr;
}

describe('PRManager.resetToOpen', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;

  beforeEach(() => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
  });

  afterEach(() => {
    terminalManager.killAll();
  });

  it('resets an open PR back to open/pending (no-op for already open)', () => {
    const pr = insertTestPR(prManager, { status: 'open', verdict: 'pending' });
    const result = prManager.resetToOpen(pr.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('open');
    expect(result!.verdict).toBe('pending');
  });

  it('resets a reviewing PR to open/pending', () => {
    const pr = insertTestPR(prManager, { status: 'reviewing', verdict: 'pending' });
    const result = prManager.resetToOpen(pr.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('open');
    expect(result!.verdict).toBe('pending');
  });

  it('resets an approved PR to open/pending', () => {
    const pr = insertTestPR(prManager, { status: 'approved', verdict: 'approved' });
    const result = prManager.resetToOpen(pr.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('open');
    expect(result!.verdict).toBe('pending');
  });

  it('resets a changes_requested PR to open/pending', () => {
    const pr = insertTestPR(prManager, { status: 'changes_requested', verdict: 'changes_requested' });
    const result = prManager.resetToOpen(pr.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('open');
    expect(result!.verdict).toBe('pending');
  });

  it('returns null for a merged PR (cannot reset)', () => {
    insertTestPR(prManager, { status: 'merged', verdict: 'approved' });
    const result = prManager.resetToOpen('test-pr-1');
    expect(result).toBeNull();
  });

  it('returns null for a closed PR (cannot reset)', () => {
    insertTestPR(prManager, { status: 'closed', verdict: 'pending' });
    const result = prManager.resetToOpen('test-pr-1');
    expect(result).toBeNull();
  });

  it('returns null for a nonexistent PR', () => {
    const result = prManager.resetToOpen('nonexistent');
    expect(result).toBeNull();
  });

  it('emits pr:updated event on successful reset', () => {
    const pr = insertTestPR(prManager, { status: 'approved', verdict: 'approved' });
    const events: string[] = [];
    prManager.onEvent((event) => events.push(event));

    prManager.resetToOpen(pr.id);
    expect(events).toContain('pr:updated');
  });

  it('does not emit event for merged/closed PRs', () => {
    insertTestPR(prManager, { status: 'merged', verdict: 'approved' });
    const events: string[] = [];
    prManager.onEvent((event) => events.push(event));

    prManager.resetToOpen('test-pr-1');
    expect(events).toHaveLength(0);
  });
});

describe('PR API — Relaunch Review', () => {
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
    app.use('/api', createPRApiRouter(prManager, issueManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /api/prs/:id/relaunch-review relaunches review for an existing PR', async () => {
    const pr = insertTestPR(prManager, { status: 'reviewing', verdict: 'pending' });

    const res = await request(server, 'POST', `/api/prs/${pr.id}/relaunch-review`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(pr.id);
    expect(res.body.status).toBe('reviewing');
    expect(res.body.reviewerTerminalId).toBeTruthy();
  });

  it('POST /api/prs/:id/relaunch-review resets verdict to pending', async () => {
    const pr = insertTestPR(prManager, {
      status: 'changes_requested',
      verdict: 'changes_requested',
    });

    const res = await request(server, 'POST', `/api/prs/${pr.id}/relaunch-review`);
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('pending');
    expect(res.body.status).toBe('reviewing');
  });

  it('POST /api/prs/:id/relaunch-review kills old reviewer terminal', async () => {
    // Create a terminal to act as the "old" reviewer
    const oldTerminal = terminalManager.create({ title: 'Old reviewer' });
    const pr = insertTestPR(prManager, {
      status: 'reviewing',
      reviewerTerminalId: oldTerminal.id,
    });

    const res = await request(server, 'POST', `/api/prs/${pr.id}/relaunch-review`);
    expect(res.status).toBe(200);
    // The old terminal should be killed — new one should be different
    expect(res.body.reviewerTerminalId).not.toBe(oldTerminal.id);
    // Old terminal should no longer exist
    expect(terminalManager.get(oldTerminal.id)).toBeUndefined();
  });

  it('POST /api/prs/:id/relaunch-review returns 404 for unknown PR', async () => {
    const res = await request(server, 'POST', '/api/prs/nonexistent/relaunch-review');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PR not found');
  });

  it('POST /api/prs/:id/relaunch-review returns 400 for merged PR', async () => {
    insertTestPR(prManager, { status: 'merged' });
    const res = await request(server, 'POST', '/api/prs/test-pr-1/relaunch-review');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('merged');
  });

  it('POST /api/prs/:id/relaunch-review returns 400 for closed PR', async () => {
    insertTestPR(prManager, { status: 'closed' });
    const res = await request(server, 'POST', '/api/prs/test-pr-1/relaunch-review');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('closed');
  });

  it('POST /api/prs/:id/relaunch-review works on approved PRs', async () => {
    insertTestPR(prManager, { status: 'approved', verdict: 'approved' });
    const res = await request(server, 'POST', '/api/prs/test-pr-1/relaunch-review');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('reviewing');
    expect(res.body.verdict).toBe('pending');
  });

  it('POST /api/prs/:id/relaunch-review works on open PRs', async () => {
    insertTestPR(prManager, { status: 'open', verdict: 'pending' });
    const res = await request(server, 'POST', '/api/prs/test-pr-1/relaunch-review');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('reviewing');
  });

  it('POST /api/prs/:id/relaunch-review deletes stale review.md', async () => {
    const prId = 'test-pr-stale';
    insertTestPR(prManager, { id: prId, status: 'changes_requested', verdict: 'changes_requested' });

    // Create a stale review.md in the review directory
    const reviewDir = join(config.reviewBase, prId);
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, 'review.md'), 'VERDICT: CHANGES_REQUESTED\nOld stale review.');

    expect(existsSync(join(reviewDir, 'review.md'))).toBe(true);

    const res = await request(server, 'POST', `/api/prs/${prId}/relaunch-review`);
    expect(res.status).toBe(200);
    // The stale review.md should be deleted
    expect(existsSync(join(reviewDir, 'review.md'))).toBe(false);
  });
});
