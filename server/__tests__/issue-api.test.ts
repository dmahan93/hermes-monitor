import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';
import { createIssueApiRouter } from '../src/issue-api.js';
import { saveDiagnostics } from '../src/diagnostics.js';
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

describe('Issue API', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;
  let server: Server;

  beforeEach(async () => {
    terminalManager = new TerminalManager();
    issueManager = new IssueManager(terminalManager);
    const app = express();
    app.use('/api', createIssueApiRouter(issueManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /api/issues creates issue', async () => {
    const res = await request(server, 'POST', '/api/issues', { title: 'Test issue' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test issue');
    expect(res.body.status).toBe('backlog');
    expect(res.body.id).toBeTruthy();
  });

  it('POST /api/issues requires title', async () => {
    const res = await request(server, 'POST', '/api/issues', {});
    expect(res.status).toBe(400);
  });

  it('GET /api/issues lists issues', async () => {
    await request(server, 'POST', '/api/issues', { title: 'A' });
    await request(server, 'POST', '/api/issues', { title: 'B' });
    const res = await request(server, 'GET', '/api/issues');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /api/issues/:id gets single issue', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Find me' });
    const res = await request(server, 'GET', `/api/issues/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Find me');
  });

  it('PATCH /api/issues/:id updates issue', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Old' });
    const res = await request(server, 'PATCH', `/api/issues/${created.body.id}`, {
      title: 'New',
      description: 'Updated',
    });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New');
    expect(res.body.description).toBe('Updated');
  });

  it('PATCH /api/issues/:id/status changes status', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Status test' });
    const res = await request(server, 'PATCH', `/api/issues/${created.body.id}/status`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
  });

  it('PATCH /api/issues/:id/status spawns terminal', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Spawn test' });
    const res = await request(server, 'PATCH', `/api/issues/${created.body.id}/status`, {
      status: 'in_progress',
    });
    expect(res.body.terminalId).toBeTruthy();
    expect(terminalManager.size).toBe(1);
  });

  it('PATCH /api/issues/:id/status rejects invalid status', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Bad status' });
    const res = await request(server, 'PATCH', `/api/issues/${created.body.id}/status`, {
      status: 'invalid',
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/issues/:id removes issue', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Delete me' });
    const res = await request(server, 'DELETE', `/api/issues/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const list = await request(server, 'GET', '/api/issues');
    expect(list.body).toHaveLength(0);
  });

  it('POST /api/issues/:id/plan starts planning terminal', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Plan test' });
    expect(created.body.status).toBe('backlog');
    const res = await request(server, 'POST', `/api/issues/${created.body.id}/plan`);
    expect(res.status).toBe(200);
    expect(res.body.terminalId).toBeTruthy();
    expect(terminalManager.size).toBe(1);
  });

  it('DELETE /api/issues/:id/plan stops planning terminal', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Stop plan' });
    await request(server, 'POST', `/api/issues/${created.body.id}/plan`);
    expect(terminalManager.size).toBe(1);
    const res = await request(server, 'DELETE', `/api/issues/${created.body.id}/plan`);
    expect(res.status).toBe(200);
    expect(res.body.terminalId).toBeNull();
    expect(terminalManager.size).toBe(0);
  });

  it('POST /api/issues/:id/plan rejects non-backlog issue', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Not backlog' });
    await request(server, 'PATCH', `/api/issues/${created.body.id}/status`, { status: 'todo' });
    const res = await request(server, 'POST', `/api/issues/${created.body.id}/plan`);
    expect(res.status).toBe(400);
  });

  it('operations on nonexistent issue return 404', async () => {
    const get = await request(server, 'GET', '/api/issues/nope');
    expect(get.status).toBe(404);
    const patch = await request(server, 'PATCH', '/api/issues/nope', { title: 'x' });
    expect(patch.status).toBe(404);
    const status = await request(server, 'PATCH', '/api/issues/nope/status', { status: 'done' });
    expect(status.status).toBe(404);
    const del = await request(server, 'DELETE', '/api/issues/nope');
    expect(del.status).toBe(404);
  });

  // ── Subtask API endpoints ──

  it('POST /api/issues/:id/subtasks creates a subtask', async () => {
    const parent = await request(server, 'POST', '/api/issues', { title: 'Parent' });
    const res = await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, {
      title: 'Subtask 1',
      description: 'Sub desc',
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Subtask 1');
    expect(res.body.description).toBe('Sub desc');
    expect(res.body.parentId).toBe(parent.body.id);
    expect(res.body.status).toBe('backlog');
  });

  it('GET /api/issues/:id/subtasks lists subtasks', async () => {
    const parent = await request(server, 'POST', '/api/issues', { title: 'Parent' });
    await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, { title: 'Sub A' });
    await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, { title: 'Sub B' });
    const res = await request(server, 'GET', `/api/issues/${parent.body.id}/subtasks`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((s: any) => s.title).sort()).toEqual(['Sub A', 'Sub B']);
  });

  it('POST /api/issues/:id/subtasks requires title', async () => {
    const parent = await request(server, 'POST', '/api/issues', { title: 'Parent' });
    const res = await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, {});
    expect(res.status).toBe(400);
  });

  it('POST /api/issues/:id/subtasks returns 404 for nonexistent parent', async () => {
    const res = await request(server, 'POST', '/api/issues/nonexistent/subtasks', { title: 'Orphan' });
    expect(res.status).toBe(404);
  });

  it('GET /api/issues/:id/subtasks returns 404 for nonexistent parent', async () => {
    const res = await request(server, 'GET', '/api/issues/nonexistent/subtasks');
    expect(res.status).toBe(404);
  });

  it('POST /api/issues/:id/subtasks rejects nested subtasks (subtask of subtask)', async () => {
    const parent = await request(server, 'POST', '/api/issues', { title: 'Parent' });
    const sub = await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, { title: 'Sub' });
    expect(sub.status).toBe(201);
    const nested = await request(server, 'POST', `/api/issues/${sub.body.id}/subtasks`, { title: 'Nested' });
    expect(nested.status).toBe(400);
    expect(nested.body.error).toMatch(/subtask of a subtask/);
  });

  it('POST /api/issues with parentId creates a subtask via main endpoint', async () => {
    const parent = await request(server, 'POST', '/api/issues', { title: 'Parent' });
    const res = await request(server, 'POST', '/api/issues', {
      title: 'Sub via main',
      parentId: parent.body.id,
    });
    expect(res.status).toBe(201);
    expect(res.body.parentId).toBe(parent.body.id);
  });

  it('subtasks appear in full issue list with parentId set', async () => {
    const parent = await request(server, 'POST', '/api/issues', { title: 'Parent' });
    await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, { title: 'Sub' });
    const res = await request(server, 'GET', '/api/issues');
    expect(res.body).toHaveLength(2);
    const sub = res.body.find((i: any) => i.title === 'Sub');
    expect(sub.parentId).toBe(parent.body.id);
    const par = res.body.find((i: any) => i.title === 'Parent');
    expect(par.parentId).toBeNull();
  });

  it('PATCH /api/issues/:id/status rejects parent done with open subtasks', async () => {
    const parent = await request(server, 'POST', '/api/issues', { title: 'Parent' });
    const sub = await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, { title: 'Sub' });
    expect(sub.status).toBe(201);

    const res = await request(server, 'PATCH', `/api/issues/${parent.body.id}/status`, { status: 'done' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/subtask.*still open/);

    // Verify parent status is unchanged
    const check = await request(server, 'GET', `/api/issues/${parent.body.id}`);
    expect(check.body.status).toBe('backlog');
  });

  it('PATCH /api/issues/:id/status allows parent done when all subtasks done', async () => {
    const parent = await request(server, 'POST', '/api/issues', { title: 'Parent' });
    const sub = await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, { title: 'Sub' });

    // Complete the subtask first
    await request(server, 'PATCH', `/api/issues/${sub.body.id}/status`, { status: 'done' });

    // Now parent can be completed
    const res = await request(server, 'PATCH', `/api/issues/${parent.body.id}/status`, { status: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
  });

  it('deleting parent cascades to subtasks via API', async () => {
    const parent = await request(server, 'POST', '/api/issues', { title: 'Parent' });
    await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, { title: 'Sub 1' });
    await request(server, 'POST', `/api/issues/${parent.body.id}/subtasks`, { title: 'Sub 2' });
    const before = await request(server, 'GET', '/api/issues');
    expect(before.body).toHaveLength(3);

    await request(server, 'DELETE', `/api/issues/${parent.body.id}`);
    const after = await request(server, 'GET', '/api/issues');
    expect(after.body).toHaveLength(0);
  });
});

describe('Issue API — Diagnostics', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;
  let server: Server;
  let savedDiagnosticsBase: string;
  let testDiagBase: string;

  beforeEach(async () => {
    savedDiagnosticsBase = config.diagnosticsBase;
    testDiagBase = join(tmpdir(), `hermes-diag-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDiagBase, { recursive: true });
    config.diagnosticsBase = testDiagBase;

    terminalManager = new TerminalManager();
    issueManager = new IssueManager(terminalManager);
    const app = express();
    app.use('/api', createIssueApiRouter(issueManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    config.diagnosticsBase = savedDiagnosticsBase;
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      rmSync(testDiagBase, { recursive: true, force: true });
    } catch { /* best effort */ }
  });

  it('GET /api/issues/:id/diagnostics returns empty when no diagnostics', async () => {
    const issue = issueManager.create({ title: 'No diagnostics' });
    const res = await request(server, 'GET', `/api/issues/${issue.id}/diagnostics`);
    expect(res.status).toBe(200);
    expect(res.body.issueId).toBe(issue.id);
    expect(res.body.diagnostics).toEqual([]);
  });

  it('GET /api/issues/:id/diagnostics returns saved diagnostics', async () => {
    const issue = issueManager.create({ title: 'Has diagnostics' });

    // Manually save a diagnostic
    saveDiagnostics({
      issueId: issue.id,
      issueTitle: issue.title,
      branch: 'feat/test',
      exitCode: 1,
      scrollback: 'error: something failed\nstack trace here',
      diagnosticsBase: testDiagBase,
    });

    const res = await request(server, 'GET', `/api/issues/${issue.id}/diagnostics`);
    expect(res.status).toBe(200);
    expect(res.body.issueId).toBe(issue.id);
    expect(res.body.diagnostics).toHaveLength(1);
    expect(res.body.diagnostics[0].exitCode).toBe(1);
    expect(res.body.diagnostics[0].timestamp).toBeGreaterThan(0);
    expect(res.body.diagnostics[0].content).toContain('something failed');
    expect(res.body.diagnostics[0].content).toContain('AGENT TERMINAL EXIT DIAGNOSTIC');
  });

  it('GET /api/issues/:id/diagnostics returns 404 for unknown issue', async () => {
    const res = await request(server, 'GET', '/api/issues/nonexistent/diagnostics');
    expect(res.status).toBe(404);
  });

  it('GET /api/issues/:id/diagnostics returns multiple entries newest first', async () => {
    const issue = issueManager.create({ title: 'Multiple diags' });

    saveDiagnostics({
      issueId: issue.id,
      issueTitle: issue.title,
      branch: null,
      exitCode: 1,
      scrollback: 'first attempt',
      diagnosticsBase: testDiagBase,
    });

    // Ensure different timestamp
    const start = Date.now();
    while (Date.now() === start) { /* spin */ }

    saveDiagnostics({
      issueId: issue.id,
      issueTitle: issue.title,
      branch: null,
      exitCode: 2,
      scrollback: 'second attempt',
      diagnosticsBase: testDiagBase,
    });

    const res = await request(server, 'GET', `/api/issues/${issue.id}/diagnostics`);
    expect(res.status).toBe(200);
    expect(res.body.diagnostics).toHaveLength(2);
    // Newest first
    expect(res.body.diagnostics[0].exitCode).toBe(2);
    expect(res.body.diagnostics[1].exitCode).toBe(1);
    expect(res.body.diagnostics[0].timestamp).toBeGreaterThan(res.body.diagnostics[1].timestamp);
  });

  // ── Reviewer Model ──

  it('POST /api/issues creates issue with reviewerModel', async () => {
    const res = await request(server, 'POST', '/api/issues', {
      title: 'Reviewer model test',
      reviewerModel: 'anthropic/claude-sonnet-4',
    });
    expect(res.status).toBe(201);
    expect(res.body.reviewerModel).toBe('anthropic/claude-sonnet-4');
  });

  it('POST /api/issues creates issue without reviewerModel (defaults to null)', async () => {
    const res = await request(server, 'POST', '/api/issues', { title: 'No model' });
    expect(res.status).toBe(201);
    expect(res.body.reviewerModel).toBeNull();
  });

  it('PATCH /api/issues/:id updates reviewerModel', async () => {
    const created = await request(server, 'POST', '/api/issues', { title: 'Update model' });
    const res = await request(server, 'PATCH', `/api/issues/${created.body.id}`, {
      reviewerModel: 'google/gemini-2.5-pro',
    });
    expect(res.status).toBe(200);
    expect(res.body.reviewerModel).toBe('google/gemini-2.5-pro');
  });

  it('PATCH /api/issues/:id can clear reviewerModel with null', async () => {
    const created = await request(server, 'POST', '/api/issues', {
      title: 'Clear model',
      reviewerModel: 'openai/gpt-4.1',
    });
    expect(created.body.reviewerModel).toBe('openai/gpt-4.1');
    const res = await request(server, 'PATCH', `/api/issues/${created.body.id}`, {
      reviewerModel: null,
    });
    expect(res.status).toBe(200);
    expect(res.body.reviewerModel).toBeNull();
  });

  it('GET /api/models returns available models', async () => {
    const res = await request(server, 'GET', '/api/models');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // Check structure
    const first = res.body[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('provider');
  });
});
