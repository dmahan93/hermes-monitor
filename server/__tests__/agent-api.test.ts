import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';
import { WorktreeManager } from '../src/worktree-manager.js';
import { PRManager } from '../src/pr-manager.js';
import { createAgentApiRouter } from '../src/agent-api.js';
import { createIssueApiRouter } from '../src/issue-api.js';
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

async function rawRequest(server: Server, method: string, path: string, data: Buffer, contentType: string) {
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': contentType },
    body: data,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// Minimal valid 1x1 PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe('Agent API (Agent Communication)', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);
    issueManager.setWorktreeManager(worktreeManager);
    issueManager.setPRManager(prManager);

    const app = express();
    app.use('/api', createIssueApiRouter(issueManager));
    app.use('/agent', createAgentApiRouter(issueManager, prManager, terminalManager, worktreeManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /agent/:id/info returns issue context', async () => {
    // Explicitly set config so test doesn't depend on env vars
    const savedRequire = config.requireScreenshotsForUiChanges;
    config.requireScreenshotsForUiChanges = true;

    const issue = issueManager.create({ title: 'Test task', description: 'Do the thing' });
    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(issue.id);
    expect(res.body.title).toBe('Test task');
    expect(res.body.description).toBe('Do the thing');
    expect(res.body.reviewUrl).toContain(`/agent/${issue.id}/review`);
    expect(res.body.isRework).toBe(false);
    expect(res.body.attempt).toBe(1);
    expect(res.body.changedFiles).toEqual([]);
    expect(res.body.previousReviews).toEqual([]);
    expect(res.body.recentMerges).toEqual([]);
    expect(res.body.guidelines).toBeDefined();
    expect(res.body.guidelines.screenshots).toContain('screenshotUploadUrl');
    expect(res.body.guidelines.screenshots).toContain('REQUIRED');
    expect(res.body.guidelines.requireScreenshotsForUiChanges).toBe(true);
    expect(res.body.screenshotUploadUrl).toContain(`/agent/${issue.id}/screenshots`);
    expect(res.body.screenshotUploadInstructions).toContain('curl');

    config.requireScreenshotsForUiChanges = savedRequire;
  });

  it('GET /agent/:id/info returns 404 for unknown issue', async () => {
    const res = await request(server, 'GET', '/agent/nope/info');
    expect(res.status).toBe(404);
  });

  it('GET /agent/:id/info includes worktree path when in_progress', async () => {
    const issue = issueManager.create({ title: 'WIP task' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    // branch and worktreePath may or may not be set depending on git repo availability
    // In test environments without a git repo, worktree creation fails gracefully
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('branch');
    expect(res.body).toHaveProperty('worktreePath');
  });

  it('POST /agent/:id/review moves issue to review', async () => {
    const issue = issueManager.create({ title: 'Review me' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const res = await request(server, 'POST', `/agent/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
    const updated = issueManager.get(issue.id);
    expect(updated?.status).toBe('review');
  });

  it('POST /agent/:id/review kills the agent terminal', async () => {
    const issue = issueManager.create({ title: 'Kill term' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const termId = issueManager.get(issue.id)?.terminalId;
    expect(termId).toBeTruthy();

    await request(server, 'POST', `/agent/${issue.id}/review`);
    const updated = issueManager.get(issue.id);
    expect(updated?.terminalId).toBeNull();
  });

  it('POST /agent/:id/review rejects if not in_progress', async () => {
    const issue = issueManager.create({ title: 'Not started' });
    const res = await request(server, 'POST', `/agent/${issue.id}/review`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not in_progress');
  });

  it('POST /agent/:id/review accepts details in body', async () => {
    const issue = issueManager.create({ title: 'With details' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const res = await request(server, 'POST', `/agent/${issue.id}/review`, {
      details: 'I refactored the auth module and added edge case tests.',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify submitterNotes was set on the issue (transient)
    const updated = issueManager.get(issue.id);
    expect(updated?.submitterNotes).toBe('I refactored the auth module and added edge case tests.');
  });

  it('POST /agent/:id/review works without details (backward compat)', async () => {
    const issue = issueManager.create({ title: 'No details' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const res = await request(server, 'POST', `/agent/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /agent/:id/review ignores non-string details', async () => {
    const issue = issueManager.create({ title: 'Bad details' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const res = await request(server, 'POST', `/agent/${issue.id}/review`, {
      details: 12345,
    });
    expect(res.status).toBe(200);
    // Non-string details should be silently ignored
    const updated = issueManager.get(issue.id);
    expect(updated?.submitterNotes).toBeUndefined();
  });
});

describe('Agent API — Screenshot Upload', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);
    issueManager.setWorktreeManager(worktreeManager);
    issueManager.setPRManager(prManager);

    const app = express();
    app.use('/api', createIssueApiRouter(issueManager));
    app.use('/agent', createAgentApiRouter(issueManager, prManager, terminalManager, worktreeManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /agent/:id/screenshots uploads a PNG and returns markdown', async () => {
    const issue = issueManager.create({ title: 'UI task' });
    const res = await rawRequest(
      server, 'POST',
      `/agent/${issue.id}/screenshots?filename=homepage.png&description=Homepage+before`,
      TINY_PNG, 'image/png'
    );
    expect(res.status).toBe(201);
    expect(res.body.url).toContain(`/screenshots/${issue.id}/`);
    expect(res.body.url).toContain('.png');
    expect(res.body.fullUrl).toContain('http://localhost:');
    expect(res.body.markdown).toContain('![Homepage before]');
    expect(res.body.markdown).toContain('.png)');
    expect(res.body.filename).toContain('homepage');

    // Verify file was written to disk
    const filePath = join(config.screenshotBase, issue.id, res.body.filename);
    expect(existsSync(filePath)).toBe(true);
    const written = readFileSync(filePath);
    expect(written.equals(TINY_PNG)).toBe(true);
  });

  it('POST /agent/:id/screenshots auto-generates filename when none provided', async () => {
    const issue = issueManager.create({ title: 'Auto name' });
    const res = await rawRequest(
      server, 'POST',
      `/agent/${issue.id}/screenshots`,
      TINY_PNG, 'image/png'
    );
    expect(res.status).toBe(201);
    expect(res.body.filename).toMatch(/^screenshot-[a-f0-9]+\.png$/);
  });

  it('POST /agent/:id/screenshots rejects unsupported content types', async () => {
    const issue = issueManager.create({ title: 'Bad type' });
    const res = await rawRequest(
      server, 'POST',
      `/agent/${issue.id}/screenshots`,
      Buffer.from('not an image'), 'text/plain'
    );
    expect(res.status).toBe(400);
    // raw({ type: 'image/*' }) skips non-image types, so body is empty
    expect(res.body.error).toContain('No image data received');
  });

  it('POST /agent/:id/screenshots returns 404 for unknown issue', async () => {
    const res = await rawRequest(
      server, 'POST',
      '/agent/nonexistent/screenshots',
      TINY_PNG, 'image/png'
    );
    expect(res.status).toBe(404);
  });

  it('POST /agent/:id/screenshots supports JPEG content type', async () => {
    const issue = issueManager.create({ title: 'JPEG test' });
    const res = await rawRequest(
      server, 'POST',
      `/agent/${issue.id}/screenshots`,
      TINY_PNG, 'image/jpeg'  // Content says JPEG (the data doesn't matter for this test)
    );
    expect(res.status).toBe(201);
    expect(res.body.filename).toContain('.jpg');
  });

  it('POST /agent/:id/screenshots sanitizes filenames', async () => {
    const issue = issueManager.create({ title: 'Sanitize' });
    const res = await rawRequest(
      server, 'POST',
      `/agent/${issue.id}/screenshots?filename=../../etc/passwd.png`,
      TINY_PNG, 'image/png'
    );
    expect(res.status).toBe(201);
    // Should not contain path traversal chars
    expect(res.body.filename).not.toContain('..');
    expect(res.body.filename).not.toContain('/');
  });

  it('GET /agent/:id/screenshots lists uploaded screenshots', async () => {
    const issue = issueManager.create({ title: 'List test' });

    // Upload two screenshots
    await rawRequest(
      server, 'POST',
      `/agent/${issue.id}/screenshots?filename=before.png`,
      TINY_PNG, 'image/png'
    );
    await rawRequest(
      server, 'POST',
      `/agent/${issue.id}/screenshots?filename=after.png`,
      TINY_PNG, 'image/png'
    );

    const res = await request(server, 'GET', `/agent/${issue.id}/screenshots`);
    expect(res.status).toBe(200);
    expect(res.body.screenshots).toHaveLength(2);
    expect(res.body.screenshots[0].filename).toBeTruthy();
    expect(res.body.screenshots[0].url).toContain('/screenshots/');
    expect(res.body.screenshots[0].markdown).toContain('![');
  });

  it('GET /agent/:id/screenshots returns empty array when no screenshots', async () => {
    const issue = issueManager.create({ title: 'No screenshots' });
    const res = await request(server, 'GET', `/agent/${issue.id}/screenshots`);
    expect(res.status).toBe(200);
    expect(res.body.screenshots).toEqual([]);
  });

  it('GET /agent/:id/screenshots returns 404 for unknown issue', async () => {
    const res = await request(server, 'GET', '/agent/nonexistent/screenshots');
    expect(res.status).toBe(404);
  });
});

describe('Agent API — Backward Compatibility (/ticket/ routes)', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);
    issueManager.setWorktreeManager(worktreeManager);
    issueManager.setPRManager(prManager);

    const app = express();
    app.use('/api', createIssueApiRouter(issueManager));
    const agentRouter = createAgentApiRouter(issueManager, prManager, terminalManager, worktreeManager);
    app.use('/agent', agentRouter);
    // Mirror the backward compat setup from index.ts
    app.use('/ticket', agentRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /ticket/:id/info works as backward compat for /agent/:id/info', async () => {
    const issue = issueManager.create({ title: 'Compat test', description: 'Check old route' });
    const res = await request(server, 'GET', `/ticket/${issue.id}/info`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(issue.id);
    expect(res.body.title).toBe('Compat test');
    // Response URLs should reference the canonical /agent/ prefix
    expect(res.body.reviewUrl).toContain('/agent/');
    expect(res.body.screenshotUploadUrl).toContain('/agent/');
  });

  it('POST /ticket/:id/review works as backward compat for /agent/:id/review', async () => {
    const issue = issueManager.create({ title: 'Compat review' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const res = await request(server, 'POST', `/ticket/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('GET /ticket/:id/info returns 404 for unknown issue (same as /agent/)', async () => {
    const res = await request(server, 'GET', '/ticket/nonexistent/info');
    expect(res.status).toBe(404);
  });

  it('POST /ticket/:id/review with query params works', async () => {
    const issue = issueManager.create({ title: 'Compat query' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const res = await request(server, 'POST', `/ticket/${issue.id}/review?no_ui_changes=true`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('Agent API — Rework Context', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);
    issueManager.setWorktreeManager(worktreeManager);
    issueManager.setPRManager(prManager);

    const app = express();
    app.use('/api', createIssueApiRouter(issueManager));
    app.use('/agent', createAgentApiRouter(issueManager, prManager, terminalManager, worktreeManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    terminalManager.killAll();
    prManager.clearAllPendingTimers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /agent/:id/info returns isRework=false and attempt=1 when no PR exists', async () => {
    const issue = issueManager.create({ title: 'Fresh task', description: 'Brand new' });
    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    expect(res.body.isRework).toBe(false);
    expect(res.body.attempt).toBe(1);
    expect(res.body.changedFiles).toEqual([]);
    expect(res.body.previousReviews).toEqual([]);
    expect(res.body.recentMerges).toEqual([]);
  });

  it('GET /agent/:id/info returns isRework=true when PR exists for issue', async () => {
    const issue = issueManager.create({ title: 'Reviewed task' });

    // Mock worktree to allow PR creation
    vi.spyOn(worktreeManager, 'get').mockReturnValue({
      branch: 'issue/test-branch',
      path: '/tmp/test',
      issueId: issue.id,
    });
    vi.spyOn(worktreeManager, 'getDiff').mockReturnValue('diff content');
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue(['src/index.ts']);

    // Create a PR for this issue
    prManager.create({ issueId: issue.id, title: issue.title });

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    expect(res.body.isRework).toBe(true);
    expect(res.body.changedFiles).toEqual(['src/index.ts']);
  });

  it('GET /agent/:id/info returns correct attempt count based on reviewer comments', async () => {
    const issue = issueManager.create({ title: 'Multi-attempt task' });

    vi.spyOn(worktreeManager, 'get').mockReturnValue({
      branch: 'issue/test-branch',
      path: '/tmp/test',
      issueId: issue.id,
    });
    vi.spyOn(worktreeManager, 'getDiff').mockReturnValue('diff');
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue([]);

    const pr = prManager.create({ issueId: issue.id, title: issue.title });
    expect(pr).not.toBeNull();

    // Add two reviewer comments (simulating two review cycles)
    prManager.addComment(pr!.id, 'hermes-reviewer', 'VERDICT: CHANGES_REQUESTED\n- Fix bug A');
    prManager.addComment(pr!.id, 'hermes-reviewer', 'VERDICT: CHANGES_REQUESTED\n- Fix bug B');

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    // 2 reviewer comments + 1 = attempt 3
    expect(res.body.attempt).toBe(3);
  });

  it('GET /agent/:id/info does not count non-reviewer comments in attempt', async () => {
    const issue = issueManager.create({ title: 'Mixed comments task' });

    vi.spyOn(worktreeManager, 'get').mockReturnValue({
      branch: 'issue/test-branch',
      path: '/tmp/test',
      issueId: issue.id,
    });
    vi.spyOn(worktreeManager, 'getDiff').mockReturnValue('diff');
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue([]);

    const pr = prManager.create({ issueId: issue.id, title: issue.title });
    expect(pr).not.toBeNull();

    // Add one reviewer comment and one human comment
    prManager.addComment(pr!.id, 'hermes-reviewer', 'VERDICT: CHANGES_REQUESTED\n- Fix it');
    prManager.addComment(pr!.id, 'human', 'Looks almost good, just one thing.');

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    // Only 1 hermes-reviewer comment + 1 = attempt 2
    expect(res.body.attempt).toBe(2);
  });

  it('GET /agent/:id/info sorts previousReviews latest-first with isLatest flag', async () => {
    const issue = issueManager.create({ title: 'Sorted reviews task' });

    vi.spyOn(worktreeManager, 'get').mockReturnValue({
      branch: 'issue/test-branch',
      path: '/tmp/test',
      issueId: issue.id,
    });
    vi.spyOn(worktreeManager, 'getDiff').mockReturnValue('diff');
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue([]);

    const pr = prManager.create({ issueId: issue.id, title: issue.title });
    expect(pr).not.toBeNull();

    // Add comments with different timestamps
    prManager.addComment(pr!.id, 'hermes-reviewer', 'First review');
    // Small delay to ensure different createdAt
    await new Promise((r) => setTimeout(r, 10));
    prManager.addComment(pr!.id, 'hermes-reviewer', 'Second review');

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);

    const reviews = res.body.previousReviews;
    expect(reviews.length).toBe(2);
    // Latest first
    expect(reviews[0].body).toBe('Second review');
    expect(reviews[0].isLatest).toBe(true);
    expect(reviews[1].body).toBe('First review');
    expect(reviews[1].isLatest).toBe(false);
    // Confirm sort order
    expect(reviews[0].createdAt).toBeGreaterThanOrEqual(reviews[1].createdAt);
  });

  it('GET /agent/:id/info extracts actionItems from review body', async () => {
    const issue = issueManager.create({ title: 'Action items task' });

    vi.spyOn(worktreeManager, 'get').mockReturnValue({
      branch: 'issue/test-branch',
      path: '/tmp/test',
      issueId: issue.id,
    });
    vi.spyOn(worktreeManager, 'getDiff').mockReturnValue('diff');
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue([]);

    const pr = prManager.create({ issueId: issue.id, title: issue.title });
    expect(pr).not.toBeNull();

    const reviewBody = [
      'VERDICT: CHANGES_REQUESTED',
      '',
      '## Issues found:',
      '- Missing error handling in auth module',
      '- No input validation on user endpoint',
      '* Should add rate limiting',
      '',
      'Also noticed:',
      '1. Tests are incomplete',
      '2. Missing documentation for new API',
    ].join('\n');

    prManager.addComment(pr!.id, 'hermes-reviewer', reviewBody);

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);

    const reviews = res.body.previousReviews;
    expect(reviews.length).toBe(1);
    expect(reviews[0].actionItems).toEqual([
      'Missing error handling in auth module',
      'No input validation on user endpoint',
      'Should add rate limiting',
      'Tests are incomplete',
      'Missing documentation for new API',
    ]);
  });

  it('GET /agent/:id/info returns empty actionItems for reviews without bullet points', async () => {
    const issue = issueManager.create({ title: 'No bullets task' });

    vi.spyOn(worktreeManager, 'get').mockReturnValue({
      branch: 'issue/test-branch',
      path: '/tmp/test',
      issueId: issue.id,
    });
    vi.spyOn(worktreeManager, 'getDiff').mockReturnValue('diff');
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue([]);

    const pr = prManager.create({ issueId: issue.id, title: issue.title });
    expect(pr).not.toBeNull();

    prManager.addComment(pr!.id, 'hermes-reviewer', 'VERDICT: APPROVED\nLooks great overall.');

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    expect(res.body.previousReviews[0].actionItems).toEqual([]);
  });

  it('GET /agent/:id/info returns recentMerges from merged PRs', async () => {
    const issue = issueManager.create({ title: 'Main task' });

    // Create some "merged" PRs by manipulating the prManager
    // We need worktree mocks for each
    const otherIssue1 = issueManager.create({ title: 'Other task 1' });
    const otherIssue2 = issueManager.create({ title: 'Other task 2' });

    vi.spyOn(worktreeManager, 'get').mockReturnValue({
      branch: 'issue/other-branch',
      path: '/tmp/other',
      issueId: 'other',
    });
    vi.spyOn(worktreeManager, 'getDiff').mockReturnValue('diff');
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue(['file1.ts']);

    const pr1 = prManager.create({ issueId: otherIssue1.id, title: 'Merged PR 1' });
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue(['file2.ts']);
    const pr2 = prManager.create({ issueId: otherIssue2.id, title: 'Merged PR 2' });

    expect(pr1).not.toBeNull();
    expect(pr2).not.toBeNull();

    // Manually set status to merged (simulating a real merge without git)
    prManager.setVerdict(pr1!.id, 'approved');
    (pr1 as any).status = 'merged';
    (pr1 as any).updatedAt = Date.now();

    prManager.setVerdict(pr2!.id, 'approved');
    (pr2 as any).status = 'merged';
    (pr2 as any).updatedAt = Date.now() + 1000;

    // Reset mock for the main issue
    vi.spyOn(worktreeManager, 'get').mockReturnValue(undefined);
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue([]);

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);

    const merges = res.body.recentMerges;
    expect(merges.length).toBe(2);
    // Most recent first
    expect(merges[0].title).toBe('Merged PR 2');
    expect(merges[0].changedFiles).toEqual(['file2.ts']);
    expect(merges[0].mergedAt).toBeDefined();
    expect(merges[1].title).toBe('Merged PR 1');
  });

  it('GET /agent/:id/info limits recentMerges to 5', async () => {
    const issue = issueManager.create({ title: 'Main task' });

    vi.spyOn(worktreeManager, 'get').mockReturnValue({
      branch: 'issue/test-branch',
      path: '/tmp/test',
      issueId: 'test',
    });
    vi.spyOn(worktreeManager, 'getDiff').mockReturnValue('diff');
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue(['f.ts']);

    // Create 7 merged PRs
    for (let i = 0; i < 7; i++) {
      const otherIssue = issueManager.create({ title: `Task ${i}` });
      const pr = prManager.create({ issueId: otherIssue.id, title: `Merged PR ${i}` });
      if (pr) {
        (pr as any).status = 'merged';
        (pr as any).updatedAt = Date.now() + i;
      }
    }

    vi.spyOn(worktreeManager, 'get').mockReturnValue(undefined);
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue([]);

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    expect(res.body.recentMerges.length).toBe(5);
  });
});

describe('Agent API — Screenshot Requirement Enforcement', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let server: Server;
  let savedRequireScreenshots: boolean;

  beforeEach(async () => {
    // Save and ensure config is enabled
    savedRequireScreenshots = config.requireScreenshotsForUiChanges;
    config.requireScreenshotsForUiChanges = true;

    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);
    issueManager.setWorktreeManager(worktreeManager);
    issueManager.setPRManager(prManager);

    const app = express();
    app.use('/api', createIssueApiRouter(issueManager));
    app.use('/agent', createAgentApiRouter(issueManager, prManager, terminalManager, worktreeManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    config.requireScreenshotsForUiChanges = savedRequireScreenshots;
    vi.restoreAllMocks();
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /**
   * Helper: create an issue, move to in_progress, mock getChangedFiles.
   * Tests the agent API's enforcement logic without requiring real git worktrees.
   */
  function setupIssueWithChangedFiles(title: string, changedFiles: string[]): { issue: any } {
    const issue = issueManager.create({ title });
    issueManager.changeStatus(issue.id, 'in_progress');
    vi.spyOn(worktreeManager, 'getChangedFiles').mockReturnValue(changedFiles);
    return { issue: issueManager.get(issue.id)! };
  }

  it('rejects review when UI files changed but no screenshots uploaded', async () => {
    const { issue } = setupIssueWithChangedFiles('UI change no screenshot', ['Component.tsx']);

    const res = await request(server, 'POST', `/agent/${issue.id}/review`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Screenshots required for UI changes');
    expect(res.body.uiFilesChanged).toContain('Component.tsx');
    expect(res.body.message).toContain('no_ui_changes=true');

    // Issue should still be in_progress (not moved to review)
    const updated = issueManager.get(issue.id);
    expect(updated?.status).toBe('in_progress');
  });

  it('allows review when UI files changed and screenshots are uploaded', async () => {
    const { issue } = setupIssueWithChangedFiles('UI change with screenshot', ['Button.tsx']);

    // Upload a screenshot first
    await rawRequest(
      server, 'POST',
      `/agent/${issue.id}/screenshots?filename=button-before.png`,
      TINY_PNG, 'image/png'
    );

    const res = await request(server, 'POST', `/agent/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('allows review when UI files changed but agent passes no_ui_changes query param', async () => {
    const { issue } = setupIssueWithChangedFiles('UI refactor only', ['App.tsx']);

    const res = await request(server, 'POST', `/agent/${issue.id}/review?no_ui_changes=true`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('allows review when UI files changed but agent sends noUiChanges in body', async () => {
    const { issue } = setupIssueWithChangedFiles('UI rename only', ['Header.tsx']);

    const res = await request(server, 'POST', `/agent/${issue.id}/review`, { noUiChanges: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('allows review when only non-UI files changed (no screenshot needed)', async () => {
    const { issue } = setupIssueWithChangedFiles('Backend change', ['utils.ts']);

    const res = await request(server, 'POST', `/agent/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('allows review when config.requireScreenshotsForUiChanges is false', async () => {
    config.requireScreenshotsForUiChanges = false;
    const { issue } = setupIssueWithChangedFiles('UI change config off', ['Modal.tsx']);

    const res = await request(server, 'POST', `/agent/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('lists UI file extensions that triggered the rejection', async () => {
    // Mock getChangedFiles to return a mix of UI and non-UI files
    const { issue } = setupIssueWithChangedFiles('Multi UI files', [
      'Page.tsx', 'styles.css', 'helper.ts',
    ]);

    const res = await request(server, 'POST', `/agent/${issue.id}/review`);
    expect(res.status).toBe(400);
    expect(res.body.uiFilesChanged).toContain('Page.tsx');
    expect(res.body.uiFilesChanged).toContain('styles.css');
    // Non-UI file should NOT be listed
    expect(res.body.uiFilesChanged).not.toContain('helper.ts');
  });

  it('GET /agent/:id/info reflects requireScreenshotsForUiChanges in guidelines', async () => {
    const issue = issueManager.create({ title: 'Check guidelines' });

    // When enabled
    config.requireScreenshotsForUiChanges = true;
    let res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.body.guidelines.requireScreenshotsForUiChanges).toBe(true);
    expect(res.body.guidelines.screenshots).toContain('REQUIRED');
    expect(res.body.guidelines.screenshots).toContain('no_ui_changes=true');

    // When disabled
    config.requireScreenshotsForUiChanges = false;
    res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.body.guidelines.requireScreenshotsForUiChanges).toBe(false);
    expect(res.body.guidelines.screenshots).not.toContain('REQUIRED');
  });
});
