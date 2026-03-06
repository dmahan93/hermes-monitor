import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { TerminalManager } from '../src/terminal-manager.js';
import { createApiRouter } from '../src/api.js';

// Simple fetch-based test helper
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

describe('API', () => {
  let manager: TerminalManager;
  let server: Server;

  beforeEach(async () => {
    manager = new TerminalManager();
    const app = express();
    app.use('/api', createApiRouter(manager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    manager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /api/terminals creates a terminal', async () => {
    const res = await request(server, 'POST', '/api/terminals', {});
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.pid).toBeGreaterThan(0);
  });

  it('POST /api/terminals with custom title/command', async () => {
    const res = await request(server, 'POST', '/api/terminals', {
      title: 'My Agent',
      command: '/bin/sh',
      cols: 100,
      rows: 30,
    });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('My Agent');
    expect(res.body.command).toBe('/bin/sh');
    expect(res.body.cols).toBe(100);
    expect(res.body.rows).toBe(30);
  });

  it('GET /api/terminals lists all terminals', async () => {
    await request(server, 'POST', '/api/terminals', { title: 'A' });
    await request(server, 'POST', '/api/terminals', { title: 'B' });
    const res = await request(server, 'GET', '/api/terminals');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET /api/terminals when empty returns []', async () => {
    const res = await request(server, 'GET', '/api/terminals');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('DELETE /api/terminals/:id kills terminal', async () => {
    const created = await request(server, 'POST', '/api/terminals', {});
    const res = await request(server, 'DELETE', `/api/terminals/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const list = await request(server, 'GET', '/api/terminals');
    expect(list.body).toHaveLength(0);
  });

  it('DELETE /api/terminals/:id with bad id returns 404', async () => {
    const res = await request(server, 'DELETE', '/api/terminals/nonexistent');
    expect(res.status).toBe(404);
  });

  it('POST /api/terminals/:id/resize updates dimensions', async () => {
    const created = await request(server, 'POST', '/api/terminals', {});
    const res = await request(server, 'POST', `/api/terminals/${created.body.id}/resize`, {
      cols: 200,
      rows: 50,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /api/terminals/:id/resize with bad id returns 404', async () => {
    const res = await request(server, 'POST', '/api/terminals/nonexistent/resize', {
      cols: 80,
      rows: 24,
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/terminals/:id/resize with bad body returns 400', async () => {
    const created = await request(server, 'POST', '/api/terminals', {});
    const res = await request(server, 'POST', `/api/terminals/${created.body.id}/resize`, {
      cols: 'not a number',
    });
    expect(res.status).toBe(400);
  });
});
