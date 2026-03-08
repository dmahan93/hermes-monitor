import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { config, updateConfig } from '../src/config.js';
import * as github from '../src/github.js';

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
    submitterNotes: '',
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

describe('PRManager.close', () => {
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

  it('closes an open PR', () => {
    const pr = insertTestPR(prManager, { status: 'open', verdict: 'pending' });
    const result = prManager.close(pr.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('closed');
  });

  it('closes an approved PR', () => {
    const pr = insertTestPR(prManager, { id: 'close-approved', status: 'approved', verdict: 'approved' });
    const result = prManager.close(pr.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('closed');
  });

  it('closes a reviewing PR', () => {
    const pr = insertTestPR(prManager, { id: 'close-reviewing', status: 'reviewing', verdict: 'pending' });
    const result = prManager.close(pr.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('closed');
  });

  it('closes a changes_requested PR', () => {
    const pr = insertTestPR(prManager, { id: 'close-changes', status: 'changes_requested', verdict: 'changes_requested' });
    const result = prManager.close(pr.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('closed');
  });

  it('returns null for merged PR', () => {
    insertTestPR(prManager, { id: 'close-merged', status: 'merged', verdict: 'approved' });
    const result = prManager.close('close-merged');
    expect(result).toBeNull();
  });

  it('closes an already closed PR (idempotent)', () => {
    insertTestPR(prManager, { id: 'close-closed', status: 'closed', verdict: 'pending' });
    const result = prManager.close('close-closed');
    // Still returns the PR since it's already closed (not merged)
    expect(result).not.toBeNull();
    expect(result!.status).toBe('closed');
  });

  it('returns null for nonexistent PR', () => {
    const result = prManager.close('nonexistent');
    expect(result).toBeNull();
  });

  it('emits pr:updated event', () => {
    const pr = insertTestPR(prManager, { id: 'close-event', status: 'open', verdict: 'pending' });
    const events: string[] = [];
    prManager.onEvent((event) => events.push(event));
    prManager.close(pr.id);
    expect(events).toContain('pr:updated');
  });

  it('kills active reviewer terminal when closing', () => {
    const term = terminalManager.create({ title: 'Active reviewer' });
    insertTestPR(prManager, {
      id: 'close-with-terminal',
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    prManager.close('close-with-terminal');
    expect(terminalManager.get(term.id)).toBeUndefined();

    const updated = prManager.get('close-with-terminal');
    expect(updated!.reviewerTerminalId).toBeNull();
  });

  it('calls worktreeManager.remove to clean up worktree', () => {
    const removeSpy = vi.spyOn(worktreeManager, 'remove').mockReturnValue(true);
    const pr = insertTestPR(prManager, { id: 'close-cleanup', status: 'open', verdict: 'pending' });
    prManager.close(pr.id);
    expect(removeSpy).toHaveBeenCalledWith(pr.issueId, false);
    removeSpy.mockRestore();
  });
});

describe('PR API — Close PR endpoint', () => {
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
    prManager.clearAllPendingTimers();
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /api/prs/:id/close closes an open PR', async () => {
    insertTestPR(prManager, { id: 'api-close-1', status: 'open' });
    const res = await request(server, 'POST', '/api/prs/api-close-1/close');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });

  it('POST /api/prs/:id/close returns 404 for unknown PR', async () => {
    const res = await request(server, 'POST', '/api/prs/nonexistent/close');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PR not found');
  });

  it('POST /api/prs/:id/close returns 400 for merged PR', async () => {
    insertTestPR(prManager, { id: 'api-close-merged', status: 'merged' });
    const res = await request(server, 'POST', '/api/prs/api-close-merged/close');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('merged');
  });

  it('POST /api/prs/:id/close returns 400 for already closed PR', async () => {
    insertTestPR(prManager, { id: 'api-close-closed', status: 'closed' });
    const res = await request(server, 'POST', '/api/prs/api-close-closed/close');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already closed');
  });

  it('POST /api/prs/:id/close works for reviewing PRs', async () => {
    insertTestPR(prManager, { id: 'api-close-reviewing', status: 'reviewing' });
    const res = await request(server, 'POST', '/api/prs/api-close-reviewing/close');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });

  it('POST /api/prs/:id/close works for approved PRs', async () => {
    insertTestPR(prManager, { id: 'api-close-approved', status: 'approved', verdict: 'approved' });
    const res = await request(server, 'POST', '/api/prs/api-close-approved/close');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
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

describe('PR API — Enriched Screenshot Data', () => {
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
    if (screenshotDir) {
      try { rmSync(screenshotDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('GET /api/prs includes screenshotCount for each PR', async () => {
    const issueId = 'issue-enriched-list';
    insertTestPR(prManager, { id: 'pr-enriched-1', issueId });

    screenshotDir = join(config.screenshotBase, issueId);
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, 'shot1.png'), 'fake');
    writeFileSync(join(screenshotDir, 'shot2.png'), 'fake');

    const res = await request(server, 'GET', '/api/prs');
    expect(res.status).toBe(200);
    const pr = res.body.find((p: any) => p.id === 'pr-enriched-1');
    expect(pr).toBeDefined();
    expect(pr.screenshotCount).toBe(2);
    expect(pr.screenshots).toHaveLength(2);
    expect(pr.screenshots[0].url).toContain(`/screenshots/${issueId}/`);
  });

  it('GET /api/prs includes screenshotCount=0 when no screenshots', async () => {
    insertTestPR(prManager, { id: 'pr-no-enriched', issueId: 'issue-no-enriched' });

    const res = await request(server, 'GET', '/api/prs');
    expect(res.status).toBe(200);
    const pr = res.body.find((p: any) => p.id === 'pr-no-enriched');
    expect(pr).toBeDefined();
    expect(pr.screenshotCount).toBe(0);
    expect(pr.screenshots).toEqual([]);
  });

  it('GET /api/prs/:id includes screenshots array', async () => {
    const issueId = 'issue-enriched-detail';
    insertTestPR(prManager, { id: 'pr-enriched-detail', issueId });

    screenshotDir = join(config.screenshotBase, issueId);
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, 'before-abc12345.png'), 'fake');

    const res = await request(server, 'GET', '/api/prs/pr-enriched-detail');
    expect(res.status).toBe(200);
    expect(res.body.screenshots).toHaveLength(1);
    expect(res.body.screenshots[0].filename).toBe('before-abc12345.png');
    expect(res.body.screenshots[0].url).toContain('/screenshots/issue-enriched-detail/before-abc12345.png');
    expect(res.body.screenshotCount).toBe(1);
  });
});

describe('PRManager.handleReviewerExit — auto-relaunch', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;

  /** Helper: wait for a condition to become true */
  const waitFor = async (pred: () => boolean, ms = 10000) => {
    const start = Date.now();
    while (!pred() && Date.now() - start < ms) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!pred()) throw new Error('Timed out waiting for condition');
  };

  beforeEach(() => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    prManager.setRelaunchDelay(100); // 100ms for fast tests
  });

  afterEach(() => {
    prManager.clearAllPendingTimers();
    terminalManager.killAll();
  });

  it('auto-relaunch: relaunches reviewer when it dies without producing a review', async () => {
    // Create a terminal that exits immediately — no review.md will be written
    const term = terminalManager.create({ command: '/bin/true' });
    const pr = insertTestPR(prManager, {
      id: 'relaunch-pr-1',
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    const originalTermId = term.id;

    // Use an event listener to catch the relaunch — the relaunched terminal
    // may exit extremely quickly (bad cwd), so polling can miss the brief
    // window where reviewerTerminalId is set to the new ID.
    let relaunchedTerminalId: string | null = null;
    prManager.onEvent((_event, updatedPr) => {
      if (
        updatedPr.id === pr.id &&
        updatedPr.reviewerTerminalId !== null &&
        updatedPr.reviewerTerminalId !== originalTermId
      ) {
        relaunchedTerminalId = updatedPr.reviewerTerminalId;
      }
    });

    // Wait for the event listener to capture a relaunch
    await waitFor(() => relaunchedTerminalId !== null, 5000);

    expect(relaunchedTerminalId).toBeTruthy();
    expect(relaunchedTerminalId).not.toBe(originalTermId);
  });

  it('auto-relaunch: stops after max relaunch attempts', async () => {
    // Create a terminal that exits immediately
    const term = terminalManager.create({ command: '/bin/true' });
    const pr = insertTestPR(prManager, {
      id: 'relaunch-pr-2',
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    // Wait for all relaunch cycles to complete.
    // With MAX_REVIEWER_RELAUNCH=2:
    // Exit 1 → relaunch (attempt 1) → Exit 2 → relaunch (attempt 2) → Exit 3 → max reached → done
    // Each cycle: ~1s for process exit + 100ms delay = ~1.1s × 3 cycles ≈ 3.3s
    // After max is reached, reviewerTerminalId should be null and a warning comment present
    await waitFor(() => {
      const current = prManager.get(pr.id);
      if (!current) return false;
      // Wait until the final cleanup happens: reviewerTerminalId is null and warning comment exists
      return current.reviewerTerminalId === null
        && current.comments.some((c) => c.body.includes('without producing a review file'));
    }, 15000);

    const updated = prManager.get(pr.id)!;
    expect(updated.reviewerTerminalId).toBeNull();
    expect(updated.comments.some((c) => c.body.includes('without producing a review file'))).toBe(true);
  }, 20000);

  it('auto-relaunch: does NOT relaunch when review file exists (success)', async () => {
    const term = terminalManager.create({ command: '/bin/true' });
    const prId = 'relaunch-pr-3';
    insertTestPR(prManager, {
      id: prId,
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    // Write a review file so the success path is taken
    const reviewDir = join(config.reviewBase, prId);
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, 'review.md'), 'VERDICT: APPROVED\nLooks great!');

    // Wait for the terminal to exit and review to be processed
    await new Promise((r) => setTimeout(r, 1500));

    const updated = prManager.get(prId)!;
    // Review was processed — not relaunched
    expect(updated.status).toBe('approved');
    expect(updated.verdict).toBe('approved');
    expect(updated.reviewerTerminalId).toBeNull();
    expect(updated.comments.some((c) => c.body.includes('VERDICT: APPROVED'))).toBe(true);
  });

  it('auto-relaunch: does NOT relaunch when terminal is killed via internal method', async () => {
    const term = terminalManager.create({ command: 'sleep 60' });
    const prId = 'relaunch-pr-4';
    insertTestPR(prManager, {
      id: prId,
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    // Simulate what relaunchReview/fixConflicts does: mark the terminal as
    // intentionally killed so handleReviewerExit skips cleanup
    (prManager as any).intentionallyKilledTerminals.add(term.id);
    terminalManager.kill(term.id);

    // Wait a bit — should NOT relaunch
    await new Promise((r) => setTimeout(r, 500));

    // PR should still have the old terminal ID (handleReviewerExit returned early)
    // since the caller (relaunchReview) handles its own cleanup
    const updated = prManager.get(prId)!;
    expect(updated.status).toBe('reviewing');
    // No warning comment added (handleReviewerExit returned early)
    expect(updated.comments).toHaveLength(0);
  });

  it('auto-relaunch: does NOT relaunch when PR status changed during delay', async () => {
    const term = terminalManager.create({ command: '/bin/true' });
    const prId = 'relaunch-pr-5';
    const pr = insertTestPR(prManager, {
      id: prId,
      status: 'reviewing',
      reviewerTerminalId: term.id,
    });

    // Use a longer delay so we can change status before relaunch fires
    prManager.setRelaunchDelay(500);

    // Wait for the process to exit (triggers auto-relaunch timer)
    await new Promise((r) => setTimeout(r, 300));

    // Change PR status during the delay — should prevent relaunch
    pr.status = 'closed';

    // Wait past the relaunch delay
    await new Promise((r) => setTimeout(r, 500));

    // PR should still be closed, no new terminal
    const updated = prManager.get(prId)!;
    expect(updated.status).toBe('closed');
  });
});

describe('PR API — Confirm Merge endpoint', () => {
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

  it('POST /api/prs/:id/confirm-merge marks PR as merged', async () => {
    insertTestPR(prManager, {
      id: 'confirm-pr-1',
      status: 'approved',
      verdict: 'approved',
      githubPrUrl: 'https://github.com/test/repo/pull/1',
    });

    const res = await request(server, 'POST', '/api/prs/confirm-pr-1/confirm-merge');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('merged');
  });

  it('POST /api/prs/:id/confirm-merge returns 404 for unknown PR', async () => {
    const res = await request(server, 'POST', '/api/prs/nonexistent/confirm-merge');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PR not found');
  });

  it('POST /api/prs/:id/confirm-merge returns 400 for already merged PR', async () => {
    insertTestPR(prManager, { id: 'confirm-pr-2', status: 'merged' });

    const res = await request(server, 'POST', '/api/prs/confirm-pr-2/confirm-merge');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('already merged');
  });

  it('POST /api/prs/:id/confirm-merge returns 400 for closed PR', async () => {
    insertTestPR(prManager, { id: 'confirm-pr-3', status: 'closed' });

    const res = await request(server, 'POST', '/api/prs/confirm-pr-3/confirm-merge');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('closed');
  });

  it('POST /api/prs/:id/confirm-merge emits pr:updated event', async () => {
    insertTestPR(prManager, {
      id: 'confirm-pr-4',
      status: 'approved',
      verdict: 'approved',
    });

    const events: string[] = [];
    prManager.onEvent((event) => events.push(event));

    await request(server, 'POST', '/api/prs/confirm-pr-4/confirm-merge');
    expect(events).toContain('pr:updated');
  });
});

describe('PR API — mergeMode config', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let issueManager: IssueManager;
  let server: Server;
  let originalMergeMode: string;

  beforeEach(async () => {
    originalMergeMode = config.mergeMode;
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
    // Restore original mergeMode
    updateConfig({ mergeMode: originalMergeMode as any });
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('PATCH /api/config updates mergeMode to github', async () => {
    const res = await request(server, 'PATCH', '/api/config', { mergeMode: 'github' });
    expect(res.status).toBe(200);
    expect(res.body.mergeMode).toBe('github');
    expect(config.mergeMode).toBe('github');
  });

  it('PATCH /api/config updates mergeMode to both', async () => {
    const res = await request(server, 'PATCH', '/api/config', { mergeMode: 'both' });
    expect(res.status).toBe(200);
    expect(res.body.mergeMode).toBe('both');
    expect(config.mergeMode).toBe('both');
  });

  it('PATCH /api/config ignores invalid mergeMode', async () => {
    updateConfig({ mergeMode: 'local' });
    const res = await request(server, 'PATCH', '/api/config', { mergeMode: 'invalid' });
    expect(res.status).toBe(200);
    expect(res.body.mergeMode).toBe('local'); // unchanged
  });

  it('GET /api/config includes mergeMode', async () => {
    updateConfig({ mergeMode: 'github' });
    const res = await request(server, 'GET', '/api/config');
    expect(res.status).toBe(200);
    expect(res.body.mergeMode).toBe('github');
  });
});

describe('PRManager.confirmMerge', () => {
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

  it('marks an approved PR as merged', () => {
    insertTestPR(prManager, { id: 'cm-1', status: 'approved', verdict: 'approved' });
    const result = prManager.confirmMerge('cm-1');
    expect(result.error).toBeUndefined();
    expect(result.pr).toBeDefined();
    expect(result.pr!.status).toBe('merged');
  });

  it('marks a reviewing PR as merged', () => {
    insertTestPR(prManager, { id: 'cm-2', status: 'reviewing', verdict: 'pending' });
    const result = prManager.confirmMerge('cm-2');
    expect(result.error).toBeUndefined();
    expect(result.pr!.status).toBe('merged');
  });

  it('returns error for already merged PR', () => {
    insertTestPR(prManager, { id: 'cm-3', status: 'merged', verdict: 'approved' });
    const result = prManager.confirmMerge('cm-3');
    expect(result.error).toContain('already merged');
  });

  it('returns error for closed PR', () => {
    insertTestPR(prManager, { id: 'cm-4', status: 'closed', verdict: 'pending' });
    const result = prManager.confirmMerge('cm-4');
    expect(result.error).toContain('closed');
  });

  it('returns error for nonexistent PR', () => {
    const result = prManager.confirmMerge('nonexistent');
    expect(result.error).toBe('PR not found');
  });

  it('emits pr:updated event on successful confirm', () => {
    insertTestPR(prManager, { id: 'cm-5', status: 'approved', verdict: 'approved' });
    const events: string[] = [];
    prManager.onEvent((event) => events.push(event));

    prManager.confirmMerge('cm-5');
    expect(events).toContain('pr:updated');
  });

  it('does not emit event for merged/closed PRs', () => {
    insertTestPR(prManager, { id: 'cm-6', status: 'merged', verdict: 'approved' });
    const events: string[] = [];
    prManager.onEvent((event) => events.push(event));

    prManager.confirmMerge('cm-6');
    expect(events).toHaveLength(0);
  });
});

describe('PRManager.createGitHubPRForMerge', () => {
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
    vi.restoreAllMocks();
  });

  it('returns error when PR not found', async () => {
    const result = await prManager.createGitHubPRForMerge('nonexistent');
    expect(result.error).toBe('PR not found');
  });

  it('returns error when pushBranch fails', async () => {
    insertTestPR(prManager, { id: 'ghpr-1', status: 'approved' });
    vi.spyOn(github, 'pushBranch').mockResolvedValue({ success: false, error: 'push rejected' });

    const result = await prManager.createGitHubPRForMerge('ghpr-1');
    expect(result.error).toContain('push rejected');
  });

  it('returns error when createGitHubPR fails', async () => {
    insertTestPR(prManager, { id: 'ghpr-2', status: 'approved' });
    vi.spyOn(github, 'pushBranch').mockResolvedValue({ success: true });
    vi.spyOn(github, 'createGitHubPR').mockResolvedValue({ success: false, error: 'gh CLI not found' });

    const result = await prManager.createGitHubPRForMerge('ghpr-2');
    expect(result.error).toContain('gh CLI not found');
  });

  it('stores GitHub PR URL via setGithubPrUrl (validates URL)', async () => {
    insertTestPR(prManager, { id: 'ghpr-3', status: 'approved' });
    vi.spyOn(github, 'pushBranch').mockResolvedValue({ success: true });
    vi.spyOn(github, 'createGitHubPR').mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/test/repo/pull/42',
    });

    const result = await prManager.createGitHubPRForMerge('ghpr-3');
    expect(result.error).toBeUndefined();
    expect(result.pr).toBeDefined();
    expect(result.pr!.githubPrUrl).toBe('https://github.com/test/repo/pull/42');
    expect(result.prUrl).toBe('https://github.com/test/repo/pull/42');
  });

  it('rejects non-GitHub URLs (defense-in-depth validation)', async () => {
    insertTestPR(prManager, { id: 'ghpr-4', status: 'approved' });
    vi.spyOn(github, 'pushBranch').mockResolvedValue({ success: true });
    vi.spyOn(github, 'createGitHubPR').mockResolvedValue({
      success: true,
      prUrl: 'javascript:alert(1)',
    });

    const result = await prManager.createGitHubPRForMerge('ghpr-4');
    expect(result.error).toContain('invalid PR URL');
    // URL should NOT be stored on the PR
    const pr = prManager.get('ghpr-4');
    expect(pr!.githubPrUrl).toBeUndefined();
  });

  it('emits pr:updated event on success', async () => {
    insertTestPR(prManager, { id: 'ghpr-5', status: 'approved' });
    vi.spyOn(github, 'pushBranch').mockResolvedValue({ success: true });
    vi.spyOn(github, 'createGitHubPR').mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/test/repo/pull/5',
    });

    const events: string[] = [];
    prManager.onEvent((event) => events.push(event));

    await prManager.createGitHubPRForMerge('ghpr-5');
    expect(events).toContain('pr:updated');
  });
});

describe('PR API — GitHub merge mode endpoint', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let issueManager: IssueManager;
  let server: Server;
  let originalMergeMode: string;

  beforeEach(async () => {
    originalMergeMode = config.mergeMode;
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
    updateConfig({ mergeMode: originalMergeMode as any });
    terminalManager.killAll();
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /api/prs/:id/merge in github mode creates GH PR and returns github_pr_created', async () => {
    updateConfig({ mergeMode: 'github' });
    insertTestPR(prManager, { id: 'gh-merge-1', status: 'approved', verdict: 'approved' });
    vi.spyOn(github, 'pushBranch').mockResolvedValue({ success: true });
    vi.spyOn(github, 'createGitHubPR').mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/test/repo/pull/10',
    });

    const res = await request(server, 'POST', '/api/prs/gh-merge-1/merge');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('github_pr_created');
    expect(res.body.prUrl).toBe('https://github.com/test/repo/pull/10');
  });

  it('POST /api/prs/:id/merge in github mode does NOT move issue to done', async () => {
    updateConfig({ mergeMode: 'github' });
    const issue = issueManager.create({ title: 'Test Issue' });
    // Manually set status to 'review' for testing
    (issue as any).status = 'review';
    insertTestPR(prManager, {
      id: 'gh-merge-2',
      issueId: issue.id,
      status: 'approved',
      verdict: 'approved',
    });
    vi.spyOn(github, 'pushBranch').mockResolvedValue({ success: true });
    vi.spyOn(github, 'createGitHubPR').mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/test/repo/pull/11',
    });

    await request(server, 'POST', `/api/prs/gh-merge-2/merge`);
    // Issue should still be in review, NOT done
    const updatedIssue = issueManager.get(issue.id);
    expect(updatedIssue!.status).toBe('review');
  });

  it('POST /api/prs/:id/merge in github mode returns 500 if GH PR creation fails', async () => {
    updateConfig({ mergeMode: 'github' });
    insertTestPR(prManager, { id: 'gh-merge-3', status: 'approved' });
    vi.spyOn(github, 'pushBranch').mockResolvedValue({ success: false, error: 'no remote' });

    const res = await request(server, 'POST', '/api/prs/gh-merge-3/merge');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  it('POST /api/prs/:id/merge in both mode creates GH PR BEFORE merging locally', async () => {
    updateConfig({ mergeMode: 'both' });
    // We need a real repo setup for merge to work, so just test that
    // createGitHubPRForMerge is called and that the API handles the flow.
    // Since merge() requires a real git repo and we can't set that up easily,
    // we spy on the methods directly.
    const pr = insertTestPR(prManager, {
      id: 'both-merge-1',
      status: 'approved',
      verdict: 'approved',
    });

    const callOrder: string[] = [];
    vi.spyOn(prManager, 'createGitHubPRForMerge').mockImplementation(async () => {
      callOrder.push('createGitHubPRForMerge');
      return { pr, prUrl: 'https://github.com/test/repo/pull/20' };
    });
    vi.spyOn(prManager, 'merge').mockImplementation(() => {
      callOrder.push('merge');
      pr.status = 'merged';
      return { pr };
    });

    const res = await request(server, 'POST', '/api/prs/both-merge-1/merge');
    expect(res.status).toBe(200);

    // Verify ordering: GH PR must be created BEFORE merge
    expect(callOrder).toEqual(['createGitHubPRForMerge', 'merge']);
  });

  it('POST /api/prs/:id/merge in both mode passes skipGitHubClose to merge()', async () => {
    updateConfig({ mergeMode: 'both' });
    const pr = insertTestPR(prManager, {
      id: 'both-merge-skip-1',
      status: 'approved',
      verdict: 'approved',
    });

    vi.spyOn(prManager, 'createGitHubPRForMerge').mockResolvedValue({
      pr, prUrl: 'https://github.com/test/repo/pull/30',
    });
    const mergeSpy = vi.spyOn(prManager, 'merge').mockImplementation(() => {
      pr.status = 'merged';
      return { pr };
    });

    await request(server, 'POST', '/api/prs/both-merge-skip-1/merge');

    // merge() must be called with skipGitHubClose: true so it doesn't
    // close the just-created GH PR
    expect(mergeSpy).toHaveBeenCalledWith('both-merge-skip-1', { skipGitHubClose: true });
  });

  it('POST /api/prs/:id/merge in both mode returns { status, prUrl, pr } response shape', async () => {
    updateConfig({ mergeMode: 'both' });
    const pr = insertTestPR(prManager, {
      id: 'both-merge-shape-1',
      status: 'approved',
      verdict: 'approved',
    });

    vi.spyOn(prManager, 'createGitHubPRForMerge').mockResolvedValue({
      pr, prUrl: 'https://github.com/test/repo/pull/25',
    });
    vi.spyOn(prManager, 'merge').mockImplementation(() => {
      pr.status = 'merged';
      return { pr };
    });

    const res = await request(server, 'POST', '/api/prs/both-merge-shape-1/merge');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('merged');
    expect(res.body.prUrl).toBe('https://github.com/test/repo/pull/25');
    expect(res.body.pr).toBeDefined();
    expect(res.body.pr.id).toBe('both-merge-shape-1');
  });

  it('POST /api/prs/:id/merge in both mode continues merging even if GH PR fails', async () => {
    updateConfig({ mergeMode: 'both' });
    const pr = insertTestPR(prManager, {
      id: 'both-merge-2',
      status: 'approved',
      verdict: 'approved',
    });

    vi.spyOn(prManager, 'createGitHubPRForMerge').mockResolvedValue({
      error: 'gh CLI not found',
    });
    vi.spyOn(prManager, 'merge').mockImplementation(() => {
      pr.status = 'merged';
      return { pr };
    });

    const res = await request(server, 'POST', '/api/prs/both-merge-2/merge');
    expect(res.status).toBe(200);
    // Merge should still succeed even if GH PR failed
    expect(res.body.status).toBe('merged');
    // prUrl should be undefined when GH PR creation failed
    expect(res.body.prUrl).toBeUndefined();
  });

  it('POST /api/prs/:id/merge in both mode moves linked issue to done', async () => {
    updateConfig({ mergeMode: 'both' });
    const issue = issueManager.create({ title: 'Both Mode Issue' });
    (issue as any).status = 'review';
    const pr = insertTestPR(prManager, {
      id: 'both-merge-issue-1',
      issueId: issue.id,
      status: 'approved',
      verdict: 'approved',
    });

    vi.spyOn(prManager, 'createGitHubPRForMerge').mockResolvedValue({
      pr, prUrl: 'https://github.com/test/repo/pull/50',
    });
    vi.spyOn(prManager, 'merge').mockImplementation(() => {
      pr.status = 'merged';
      return { pr };
    });

    const res = await request(server, 'POST', `/api/prs/both-merge-issue-1/merge`);
    expect(res.status).toBe(200);

    // Issue should be moved to done
    const updatedIssue = issueManager.get(issue.id);
    expect(updatedIssue!.status).toBe('done');
  });
});

describe('PR API — Confirm Merge issue status transition', () => {
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

  it('POST /api/prs/:id/confirm-merge moves linked issue to done', async () => {
    const issue = issueManager.create({ title: 'Test Issue' });
    // Manually set status to 'review' for testing
    (issue as any).status = 'review';
    insertTestPR(prManager, {
      id: 'confirm-issue-1',
      issueId: issue.id,
      status: 'approved',
      verdict: 'approved',
      githubPrUrl: 'https://github.com/test/repo/pull/1',
    });

    const res = await request(server, 'POST', '/api/prs/confirm-issue-1/confirm-merge');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('merged');

    // The linked issue should be moved to done
    const updatedIssue = issueManager.get(issue.id);
    expect(updatedIssue).toBeDefined();
    expect(updatedIssue!.status).toBe('done');
  });

  it('POST /api/prs/:id/confirm-merge does not crash without an issueManager', async () => {
    // Create router without issueManager
    const app2 = express();
    app2.use('/api', createPRApiRouter(prManager));
    const server2 = createServer(app2);
    await new Promise<void>((resolve) => server2.listen(0, resolve));

    insertTestPR(prManager, {
      id: 'confirm-issue-2',
      status: 'approved',
      verdict: 'approved',
    });

    const res = await request(server2, 'POST', '/api/prs/confirm-issue-2/confirm-merge');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('merged');

    await new Promise<void>((resolve) => server2.close(() => resolve()));
  });
});
