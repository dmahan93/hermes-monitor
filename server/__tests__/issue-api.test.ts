import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';
import { createIssueApiRouter } from '../src/issue-api.js';

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
});
