import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
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

describe('PRManager.handleReviewerExit — terminal cleanup', () => {
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

  it('clears reviewerTerminalId when reviewer terminal exits', async () => {
    // Create a terminal that exits immediately
    const term = terminalManager.create({ command: '/bin/true' });
    const pr = insertTestPR(prManager, {
      id: 'cleanup-pr-1',
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    // Write a review file so handleReviewerExit can process it
    const reviewDir = join(config.reviewBase, pr.id);
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, 'review.md'), 'VERDICT: APPROVED\nLooks great!');

    // Wait for the terminal to exit and trigger handleReviewerExit
    await new Promise((r) => setTimeout(r, 1500));

    // reviewerTerminalId should be cleared
    const updated = prManager.get(pr.id);
    expect(updated).toBeDefined();
    expect(updated!.reviewerTerminalId).toBeNull();
  });

  it('removes reviewer terminal from terminal manager after exit', async () => {
    const term = terminalManager.create({ command: '/bin/true' });
    insertTestPR(prManager, {
      id: 'cleanup-pr-2',
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    const reviewDir = join(config.reviewBase, 'cleanup-pr-2');
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, 'review.md'), 'VERDICT: CHANGES_REQUESTED\nNeeds work.');

    await new Promise((r) => setTimeout(r, 1500));

    // Terminal should be removed from the manager
    expect(terminalManager.get(term.id)).toBeUndefined();
  });

  it('emits pr:updated with null reviewerTerminalId after exit', async () => {
    const term = terminalManager.create({ command: '/bin/true' });
    insertTestPR(prManager, {
      id: 'cleanup-pr-3',
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    const reviewDir = join(config.reviewBase, 'cleanup-pr-3');
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, 'review.md'), 'VERDICT: APPROVED\nAll good.');

    const events: Array<{ event: string; reviewerTerminalId: string | null }> = [];
    prManager.onEvent((event, pr) => {
      events.push({ event, reviewerTerminalId: pr.reviewerTerminalId });
    });

    await new Promise((r) => setTimeout(r, 1500));

    const updateEvent = events.find((e) => e.event === 'pr:updated');
    expect(updateEvent).toBeDefined();
    expect(updateEvent!.reviewerTerminalId).toBeNull();
  });
});

describe('PRManager.handleConflictFixerExit — conflict fixer lifecycle', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;

  beforeEach(() => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
  });

  afterEach(() => {
    prManager.clearAllPendingTimers();
    terminalManager.killAll();
  });

  it('clears reviewerTerminalId immediately when conflict fixer exits', async () => {
    const term = terminalManager.create({ command: '/bin/true' });
    const pr = insertTestPR(prManager, {
      id: 'fixer-pr-1',
      status: 'open',
      reviewerTerminalId: term.id,
    });
    // Register as a conflict fixer via private set
    (prManager as any).conflictFixerTerminals.add(term.id);

    // Wait for the terminal to exit
    await new Promise((r) => setTimeout(r, 1500));

    // reviewerTerminalId should be cleared immediately on exit
    const updated = prManager.get(pr.id);
    expect(updated).toBeDefined();
    expect(updated!.reviewerTerminalId).toBeNull();
  });

  it('emits pr:updated when conflict fixer exits', async () => {
    const term = terminalManager.create({ command: '/bin/true' });
    insertTestPR(prManager, {
      id: 'fixer-pr-2',
      status: 'open',
      reviewerTerminalId: term.id,
    });
    (prManager as any).conflictFixerTerminals.add(term.id);

    const events: Array<{ event: string; reviewerTerminalId: string | null }> = [];
    prManager.onEvent((event, pr) => {
      events.push({ event, reviewerTerminalId: pr.reviewerTerminalId });
    });

    await new Promise((r) => setTimeout(r, 1500));

    const updateEvent = events.find((e) => e.event === 'pr:updated');
    expect(updateEvent).toBeDefined();
    expect(updateEvent!.reviewerTerminalId).toBeNull();
  });

  it('removes terminal from manager after 5-second delay', async () => {
    const term = terminalManager.create({ command: '/bin/true' });
    insertTestPR(prManager, {
      id: 'fixer-pr-3',
      status: 'open',
      reviewerTerminalId: term.id,
    });
    (prManager as any).conflictFixerTerminals.add(term.id);

    // Wait for exit but not the 5-second delay
    await new Promise((r) => setTimeout(r, 1500));
    // Terminal should still be in manager (waiting for delayed kill)
    expect(terminalManager.get(term.id)).toBeDefined();

    // Wait for the 5-second delay to fire
    await new Promise((r) => setTimeout(r, 5500));
    // Terminal should now be removed
    expect(terminalManager.get(term.id)).toBeUndefined();
  }, 10000);

  it('clearAllPendingTimers prevents delayed removal', async () => {
    const term = terminalManager.create({ command: '/bin/true' });
    insertTestPR(prManager, {
      id: 'fixer-pr-4',
      status: 'open',
      reviewerTerminalId: term.id,
    });
    (prManager as any).conflictFixerTerminals.add(term.id);

    // Wait for exit
    await new Promise((r) => setTimeout(r, 1500));
    // Terminal should still be in manager
    expect(terminalManager.get(term.id)).toBeDefined();

    // Clear all pending timers before the 5-second delay fires
    prManager.clearAllPendingTimers();

    // Wait past the 5-second window
    await new Promise((r) => setTimeout(r, 5500));
    // Terminal should still be in manager since we cancelled the timer
    expect(terminalManager.get(term.id)).toBeDefined();
  }, 10000);

  it('relaunchReview cleans up conflict fixer terminals', () => {
    // Create a terminal acting as a conflict fixer
    const fixerTerm = terminalManager.create({ title: 'Conflict fixer' });
    insertTestPR(prManager, {
      id: 'fixer-pr-5',
      status: 'open',
      reviewerTerminalId: fixerTerm.id,
    });
    (prManager as any).conflictFixerTerminals.add(fixerTerm.id);

    // Relaunch review should kill the fixer and remove from the set
    prManager.relaunchReview('fixer-pr-5');

    // Old fixer terminal should be removed
    expect(terminalManager.get(fixerTerm.id)).toBeUndefined();
    // Conflict fixer set should no longer contain the old terminal
    expect((prManager as any).conflictFixerTerminals.has(fixerTerm.id)).toBe(false);
    // PR should have a new reviewer terminal
    const updated = prManager.get('fixer-pr-5');
    expect(updated!.reviewerTerminalId).not.toBeNull();
    expect(updated!.reviewerTerminalId).not.toBe(fixerTerm.id);
  });

  it('handles orphan conflict fixer with no matching PR', async () => {
    // Create a terminal and register it as conflict fixer, but don't associate with any PR
    const term = terminalManager.create({ command: '/bin/true' });
    (prManager as any).conflictFixerTerminals.add(term.id);

    // Wait for exit
    await new Promise((r) => setTimeout(r, 1500));
    // Terminal should still exist (waiting for delayed kill)
    expect(terminalManager.get(term.id)).toBeDefined();

    // Wait for delayed removal
    await new Promise((r) => setTimeout(r, 5500));
    // Terminal should be removed
    expect(terminalManager.get(term.id)).toBeUndefined();
  }, 10000);
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

describe('PR API — Screenshots', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let issueManager: IssueManager;
  let server: Server;
  let screenshotDir: string;

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
    // Clean up screenshot dirs
    if (screenshotDir) {
      try { rmSync(screenshotDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('GET /api/prs/:id/screenshots returns empty array when no screenshots', async () => {
    insertTestPR(prManager, { id: 'pr-no-ss', issueId: 'issue-no-ss' });
    const res = await request(server, 'GET', '/api/prs/pr-no-ss/screenshots');
    expect(res.status).toBe(200);
    expect(res.body.screenshots).toEqual([]);
  });

  it('GET /api/prs/:id/screenshots returns 404 for unknown PR', async () => {
    const res = await request(server, 'GET', '/api/prs/nonexistent/screenshots');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PR not found');
  });

  it('GET /api/prs/:id/screenshots lists uploaded screenshots', async () => {
    const issueId = 'issue-with-ss';
    insertTestPR(prManager, { id: 'pr-with-ss', issueId });

    // Create fake screenshot files
    screenshotDir = join(config.screenshotBase, issueId);
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, 'before-abc12345.png'), 'fake-png-data');
    writeFileSync(join(screenshotDir, 'after-def67890.png'), 'fake-png-data');

    const res = await request(server, 'GET', '/api/prs/pr-with-ss/screenshots');
    expect(res.status).toBe(200);
    expect(res.body.screenshots).toHaveLength(2);
    expect(res.body.screenshots[0].filename).toBeTruthy();
    expect(res.body.screenshots[0].url).toContain(`/screenshots/${issueId}/`);
    expect(res.body.screenshots[1].url).toContain(`/screenshots/${issueId}/`);
  });

  it('GET /api/prs/:id/screenshots only lists image files', async () => {
    const issueId = 'issue-mixed-files';
    insertTestPR(prManager, { id: 'pr-mixed', issueId });

    screenshotDir = join(config.screenshotBase, issueId);
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, 'screenshot.png'), 'fake-png');
    writeFileSync(join(screenshotDir, 'photo.jpg'), 'fake-jpg');
    writeFileSync(join(screenshotDir, 'notes.txt'), 'not an image');
    writeFileSync(join(screenshotDir, 'data.json'), '{}');

    const res = await request(server, 'GET', '/api/prs/pr-mixed/screenshots');
    expect(res.status).toBe(200);
    expect(res.body.screenshots).toHaveLength(2);
    const filenames = res.body.screenshots.map((s: any) => s.filename);
    expect(filenames).toContain('screenshot.png');
    expect(filenames).toContain('photo.jpg');
  });
});
