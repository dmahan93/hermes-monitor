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
    expect(res.body.previousReviews).toEqual([]);
    expect(res.body.guidelines).toBeDefined();
    expect(res.body.guidelines.screenshots).toContain('screenshotUploadUrl');
    expect(res.body.guidelines.screenshots).toContain('REQUIRED');
    expect(res.body.guidelines.requireScreenshotsForUiChanges).toBe(true);
    expect(res.body.screenshotUploadUrl).toContain(`/agent/${issue.id}/screenshots`);
    expect(res.body.screenshotUploadInstructions).toContain('curl');

    config.requireScreenshotsForUiChanges = savedRequire;
  });

  it('GET /agent/:id/info returns null reworkFeedback when no reviews', async () => {
    const issue = issueManager.create({ title: 'No reviews', description: 'Fresh issue' });
    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    expect(res.body.reworkFeedback).toBeNull();
  });

  it('GET /agent/:id/info returns reworkFeedback when reviews exist', async () => {
    const issue = issueManager.create({ title: 'Rework issue', description: 'Needs fixes' });

    // Mock the prManager to return a PR with review comments
    vi.spyOn(prManager, 'getByIssueId').mockReturnValue({
      id: 'mock-pr-1',
      issueId: issue.id,
      title: issue.title,
      description: issue.description,
      submitterNotes: '',
      sourceBranch: 'feat/test',
      targetBranch: 'master',
      repoPath: '/tmp/repo',
      status: 'changes_requested',
      diff: '',
      changedFiles: [],
      verdict: 'changes_requested',
      reviewerTerminalId: null,
      comments: [
        {
          id: 'comment-1',
          prId: 'mock-pr-1',
          author: 'hermes-reviewer',
          body: 'VERDICT: CHANGES_REQUESTED\n\nMissing null check in getUserById()',
          createdAt: Date.now(),
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);

    // reworkFeedback should be prominent and contain the review body
    expect(res.body.reworkFeedback).toBeTruthy();
    expect(res.body.reworkFeedback).toContain('REWORK REQUIRED');
    expect(res.body.reworkFeedback).toContain('Missing null check in getUserById()');
  });

  it('GET /agent/:id/info reworkFeedback uses latest review comment', async () => {
    const issue = issueManager.create({ title: 'Multi-review', description: 'Multiple rounds' });

    vi.spyOn(prManager, 'getByIssueId').mockReturnValue({
      id: 'mock-pr-2',
      issueId: issue.id,
      title: issue.title,
      description: issue.description,
      submitterNotes: '',
      sourceBranch: 'feat/multi',
      targetBranch: 'master',
      repoPath: '/tmp/repo',
      status: 'changes_requested',
      diff: '',
      changedFiles: [],
      verdict: 'changes_requested',
      reviewerTerminalId: null,
      comments: [
        {
          id: 'c1',
          prId: 'mock-pr-2',
          author: 'hermes-reviewer',
          body: 'First review: fix typing',
          createdAt: 1000,
        },
        {
          id: 'c2',
          prId: 'mock-pr-2',
          author: 'hermes-reviewer',
          body: 'Second review: still needs error handling',
          createdAt: 2000,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    // Should use the latest comment
    expect(res.body.reworkFeedback).toContain('still needs error handling');
  });

  it('GET /agent/:id/info reworkFeedback ignores non-reviewer comments', async () => {
    const issue = issueManager.create({ title: 'Human comment', description: 'Has non-reviewer comment' });

    vi.spyOn(prManager, 'getByIssueId').mockReturnValue({
      id: 'mock-pr-3',
      issueId: issue.id,
      title: issue.title,
      description: issue.description,
      submitterNotes: '',
      sourceBranch: 'feat/human',
      targetBranch: 'master',
      repoPath: '/tmp/repo',
      status: 'changes_requested',
      diff: '',
      changedFiles: [],
      verdict: 'changes_requested',
      reviewerTerminalId: null,
      comments: [
        {
          id: 'c1',
          prId: 'mock-pr-3',
          author: 'hermes-reviewer',
          body: 'VERDICT: CHANGES_REQUESTED\n\nFix the auth logic',
          createdAt: 1000,
        },
        {
          id: 'c2',
          prId: 'mock-pr-3',
          author: 'human',
          body: 'Actually, also update the docs please',
          createdAt: 2000,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    // Should use the reviewer comment, not the human comment
    expect(res.body.reworkFeedback).toContain('Fix the auth logic');
    expect(res.body.reworkFeedback).not.toContain('update the docs');
  });

  it('GET /agent/:id/info reworkFeedback is null when verdict is approved', async () => {
    const issue = issueManager.create({ title: 'Approved PR', description: 'Was approved' });

    vi.spyOn(prManager, 'getByIssueId').mockReturnValue({
      id: 'mock-pr-4',
      issueId: issue.id,
      title: issue.title,
      description: issue.description,
      submitterNotes: '',
      sourceBranch: 'feat/approved',
      targetBranch: 'master',
      repoPath: '/tmp/repo',
      status: 'approved',
      diff: '',
      changedFiles: [],
      verdict: 'approved',
      reviewerTerminalId: null,
      comments: [
        {
          id: 'c1',
          prId: 'mock-pr-4',
          author: 'hermes-reviewer',
          body: 'VERDICT: APPROVED\n\nLooks great, ship it!',
          createdAt: 1000,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    // Should NOT show rework feedback for approved PRs
    expect(res.body.reworkFeedback).toBeNull();
  });

  it('GET /agent/:id/info reworkFeedback is null when only human comments exist', async () => {
    const issue = issueManager.create({ title: 'Human only', description: 'No reviewer comments' });

    vi.spyOn(prManager, 'getByIssueId').mockReturnValue({
      id: 'mock-pr-5',
      issueId: issue.id,
      title: issue.title,
      description: issue.description,
      submitterNotes: '',
      sourceBranch: 'feat/human-only',
      targetBranch: 'master',
      repoPath: '/tmp/repo',
      status: 'changes_requested',
      diff: '',
      changedFiles: [],
      verdict: 'changes_requested',
      reviewerTerminalId: null,
      comments: [
        {
          id: 'c1',
          prId: 'mock-pr-5',
          author: 'human',
          body: 'I think this needs more work',
          createdAt: 1000,
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const res = await request(server, 'GET', `/agent/${issue.id}/info`);
    expect(res.status).toBe(200);
    // No reviewer comments → no rework feedback
    expect(res.body.reworkFeedback).toBeNull();
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
