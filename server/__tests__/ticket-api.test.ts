import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';
import { WorktreeManager } from '../src/worktree-manager.js';
import { PRManager } from '../src/pr-manager.js';
import { createTicketApiRouter } from '../src/ticket-api.js';
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

describe('Ticket API (Agent Communication)', () => {
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
    app.use('/', createTicketApiRouter(issueManager, prManager, terminalManager, worktreeManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /ticket/:id/info returns issue context', async () => {
    const issue = issueManager.create({ title: 'Test task', description: 'Do the thing' });
    const res = await request(server, 'GET', `/ticket/${issue.id}/info`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(issue.id);
    expect(res.body.title).toBe('Test task');
    expect(res.body.description).toBe('Do the thing');
    expect(res.body.reviewUrl).toContain(`/ticket/${issue.id}/review`);
    expect(res.body.previousReviews).toEqual([]);
    expect(res.body.guidelines).toBeDefined();
    expect(res.body.guidelines.screenshots).toContain('screenshotUploadUrl');
    expect(res.body.guidelines.screenshots).toContain('REQUIRED');
    expect(res.body.guidelines.requireScreenshotsForUiChanges).toBe(true);
    expect(res.body.screenshotUploadUrl).toContain(`/ticket/${issue.id}/screenshots`);
    expect(res.body.screenshotUploadInstructions).toContain('curl');
  });

  it('GET /ticket/:id/info returns 404 for unknown issue', async () => {
    const res = await request(server, 'GET', '/ticket/nope/info');
    expect(res.status).toBe(404);
  });

  it('GET /ticket/:id/info includes worktree path when in_progress', async () => {
    const issue = issueManager.create({ title: 'WIP task' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const res = await request(server, 'GET', `/ticket/${issue.id}/info`);
    expect(res.body.branch).toBeTruthy();
    // worktreePath may or may not be set depending on git repo availability
  });

  it('POST /ticket/:id/review moves issue to review', async () => {
    const issue = issueManager.create({ title: 'Review me' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const res = await request(server, 'POST', `/ticket/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
    const updated = issueManager.get(issue.id);
    expect(updated?.status).toBe('review');
  });

  it('POST /ticket/:id/review kills the agent terminal', async () => {
    const issue = issueManager.create({ title: 'Kill term' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const termId = issueManager.get(issue.id)?.terminalId;
    expect(termId).toBeTruthy();

    await request(server, 'POST', `/ticket/${issue.id}/review`);
    const updated = issueManager.get(issue.id);
    expect(updated?.terminalId).toBeNull();
  });

  it('POST /ticket/:id/review rejects if not in_progress', async () => {
    const issue = issueManager.create({ title: 'Not started' });
    const res = await request(server, 'POST', `/ticket/${issue.id}/review`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not in_progress');
  });
});

describe('Ticket API — Screenshot Upload', () => {
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
    app.use('/', createTicketApiRouter(issueManager, prManager, terminalManager, worktreeManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /ticket/:id/screenshots uploads a PNG and returns markdown', async () => {
    const issue = issueManager.create({ title: 'UI task' });
    const res = await rawRequest(
      server, 'POST',
      `/ticket/${issue.id}/screenshots?filename=homepage.png&description=Homepage+before`,
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

  it('POST /ticket/:id/screenshots auto-generates filename when none provided', async () => {
    const issue = issueManager.create({ title: 'Auto name' });
    const res = await rawRequest(
      server, 'POST',
      `/ticket/${issue.id}/screenshots`,
      TINY_PNG, 'image/png'
    );
    expect(res.status).toBe(201);
    expect(res.body.filename).toMatch(/^screenshot-[a-f0-9]+\.png$/);
  });

  it('POST /ticket/:id/screenshots rejects unsupported content types', async () => {
    const issue = issueManager.create({ title: 'Bad type' });
    const res = await rawRequest(
      server, 'POST',
      `/ticket/${issue.id}/screenshots`,
      Buffer.from('not an image'), 'text/plain'
    );
    expect(res.status).toBe(400);
    // raw({ type: 'image/*' }) skips non-image types, so body is empty
    expect(res.body.error).toContain('No image data received');
  });

  it('POST /ticket/:id/screenshots returns 404 for unknown issue', async () => {
    const res = await rawRequest(
      server, 'POST',
      '/ticket/nonexistent/screenshots',
      TINY_PNG, 'image/png'
    );
    expect(res.status).toBe(404);
  });

  it('POST /ticket/:id/screenshots supports JPEG content type', async () => {
    const issue = issueManager.create({ title: 'JPEG test' });
    const res = await rawRequest(
      server, 'POST',
      `/ticket/${issue.id}/screenshots`,
      TINY_PNG, 'image/jpeg'  // Content says JPEG (the data doesn't matter for this test)
    );
    expect(res.status).toBe(201);
    expect(res.body.filename).toContain('.jpg');
  });

  it('POST /ticket/:id/screenshots sanitizes filenames', async () => {
    const issue = issueManager.create({ title: 'Sanitize' });
    const res = await rawRequest(
      server, 'POST',
      `/ticket/${issue.id}/screenshots?filename=../../etc/passwd.png`,
      TINY_PNG, 'image/png'
    );
    expect(res.status).toBe(201);
    // Should not contain path traversal chars
    expect(res.body.filename).not.toContain('..');
    expect(res.body.filename).not.toContain('/');
  });

  it('GET /ticket/:id/screenshots lists uploaded screenshots', async () => {
    const issue = issueManager.create({ title: 'List test' });

    // Upload two screenshots
    await rawRequest(
      server, 'POST',
      `/ticket/${issue.id}/screenshots?filename=before.png`,
      TINY_PNG, 'image/png'
    );
    await rawRequest(
      server, 'POST',
      `/ticket/${issue.id}/screenshots?filename=after.png`,
      TINY_PNG, 'image/png'
    );

    const res = await request(server, 'GET', `/ticket/${issue.id}/screenshots`);
    expect(res.status).toBe(200);
    expect(res.body.screenshots).toHaveLength(2);
    expect(res.body.screenshots[0].filename).toBeTruthy();
    expect(res.body.screenshots[0].url).toContain('/screenshots/');
    expect(res.body.screenshots[0].markdown).toContain('![');
  });

  it('GET /ticket/:id/screenshots returns empty array when no screenshots', async () => {
    const issue = issueManager.create({ title: 'No screenshots' });
    const res = await request(server, 'GET', `/ticket/${issue.id}/screenshots`);
    expect(res.status).toBe(200);
    expect(res.body.screenshots).toEqual([]);
  });

  it('GET /ticket/:id/screenshots returns 404 for unknown issue', async () => {
    const res = await request(server, 'GET', '/ticket/nonexistent/screenshots');
    expect(res.status).toBe(404);
  });
});

describe('Ticket API — Screenshot Requirement Enforcement', () => {
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
    app.use('/', createTicketApiRouter(issueManager, prManager, terminalManager, worktreeManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    config.requireScreenshotsForUiChanges = savedRequireScreenshots;
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /**
   * Helper: create an issue, move to in_progress, commit a file in the worktree.
   * Returns { issue, worktreePath }
   */
  function setupIssueWithFile(title: string, filename: string): { issue: any; worktreePath: string } {
    const issue = issueManager.create({ title });
    issueManager.changeStatus(issue.id, 'in_progress');
    const worktree = worktreeManager.get(issue.id);
    if (!worktree) throw new Error('Worktree not created');

    // Create and commit the file in the worktree
    writeFileSync(join(worktree.path, filename), '// test file\n');
    execSync(`git add "${filename}" && git commit -m "add ${filename}"`, {
      cwd: worktree.path,
      stdio: 'pipe',
    });

    return { issue: issueManager.get(issue.id)!, worktreePath: worktree.path };
  }

  it('rejects review when UI files changed but no screenshots uploaded', async () => {
    const { issue } = setupIssueWithFile('UI change no screenshot', 'Component.tsx');

    const res = await request(server, 'POST', `/ticket/${issue.id}/review`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Screenshots required for UI changes');
    expect(res.body.uiFilesChanged).toContain('Component.tsx');
    expect(res.body.message).toContain('no_ui_changes=true');

    // Issue should still be in_progress (not moved to review)
    const updated = issueManager.get(issue.id);
    expect(updated?.status).toBe('in_progress');
  });

  it('allows review when UI files changed and screenshots are uploaded', async () => {
    const { issue } = setupIssueWithFile('UI change with screenshot', 'Button.tsx');

    // Upload a screenshot first
    await rawRequest(
      server, 'POST',
      `/ticket/${issue.id}/screenshots?filename=button-before.png`,
      TINY_PNG, 'image/png'
    );

    const res = await request(server, 'POST', `/ticket/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('allows review when UI files changed but agent passes no_ui_changes query param', async () => {
    const { issue } = setupIssueWithFile('UI refactor only', 'App.tsx');

    const res = await request(server, 'POST', `/ticket/${issue.id}/review?no_ui_changes=true`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('allows review when UI files changed but agent sends noUiChanges in body', async () => {
    const { issue } = setupIssueWithFile('UI rename only', 'Header.tsx');

    const res = await request(server, 'POST', `/ticket/${issue.id}/review`, { noUiChanges: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('allows review when only non-UI files changed (no screenshot needed)', async () => {
    const { issue } = setupIssueWithFile('Backend change', 'utils.ts');

    const res = await request(server, 'POST', `/ticket/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('allows review when config.requireScreenshotsForUiChanges is false', async () => {
    config.requireScreenshotsForUiChanges = false;
    const { issue } = setupIssueWithFile('UI change config off', 'Modal.tsx');

    const res = await request(server, 'POST', `/ticket/${issue.id}/review`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('review');
  });

  it('lists UI file extensions that triggered the rejection', async () => {
    const issue = issueManager.create({ title: 'Multi UI files' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const worktree = worktreeManager.get(issue.id);
    if (!worktree) throw new Error('Worktree not created');

    // Create multiple UI files
    writeFileSync(join(worktree.path, 'Page.tsx'), '// page\n');
    writeFileSync(join(worktree.path, 'styles.css'), '.page {}\n');
    writeFileSync(join(worktree.path, 'helper.ts'), '// helper\n');
    execSync('git add -A && git commit -m "add files"', {
      cwd: worktree.path,
      stdio: 'pipe',
    });

    const res = await request(server, 'POST', `/ticket/${issue.id}/review`);
    expect(res.status).toBe(400);
    expect(res.body.uiFilesChanged).toContain('Page.tsx');
    expect(res.body.uiFilesChanged).toContain('styles.css');
    // Non-UI file should NOT be listed
    expect(res.body.uiFilesChanged).not.toContain('helper.ts');
  });

  it('GET /ticket/:id/info reflects requireScreenshotsForUiChanges in guidelines', async () => {
    const issue = issueManager.create({ title: 'Check guidelines' });

    // When enabled
    config.requireScreenshotsForUiChanges = true;
    let res = await request(server, 'GET', `/ticket/${issue.id}/info`);
    expect(res.body.guidelines.requireScreenshotsForUiChanges).toBe(true);
    expect(res.body.guidelines.screenshots).toContain('REQUIRED');
    expect(res.body.guidelines.screenshots).toContain('no_ui_changes=true');

    // When disabled
    config.requireScreenshotsForUiChanges = false;
    res = await request(server, 'GET', `/ticket/${issue.id}/info`);
    expect(res.body.guidelines.requireScreenshotsForUiChanges).toBe(false);
    expect(res.body.guidelines.screenshots).not.toContain('REQUIRED');
  });
});
