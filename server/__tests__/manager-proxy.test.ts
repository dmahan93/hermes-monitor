import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import {
  createManagerProxy,
  registerRepo,
  unregisterRepo,
  listRepos,
  getRepo,
  clearRegistry,
  setupWebSocketProxy,
} from '../src/manager/proxy.js';

// Helper: HTTP request returning { status, body, headers }
async function request(
  server: Server,
  path: string,
  options: RequestInit = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const res = await fetch(url, options);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

// Helper: open a WebSocket via the proxy and wait for it to connect
function connectWs(server: Server, path: string): Promise<WebSocket> {
  const addr = server.address() as any;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}${path}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// Helper: wait for next WS message
function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(data.toString()));
  });
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------
let backendApp: express.Express;
let backendServer: Server;
let backendPort: number;
let backendWss: WebSocketServer;

let proxyApp: express.Express;
let proxyServer: Server;

beforeAll(async () => {
  // Backend: simulates a per-repo hermes-monitor instance
  backendApp = express();
  backendApp.get('/api/health', (_req, res) => res.json({ status: 'ok', source: 'backend' }));
  backendApp.get('/api/issues', (_req, res) => res.json({ issues: ['issue-1', 'issue-2'] }));
  backendApp.get('/', (_req, res) => res.json({ page: 'repo-home' }));
  backendApp.post('/api/agents', (_req, res) => res.status(201).json({ created: true }));
  backendApp.delete('/api/agents/:id', (req, res) =>
    res.json({ deleted: req.params.id }),
  );

  backendServer = createServer(backendApp);

  // WebSocket echo server on the backend
  backendWss = new WebSocketServer({ server: backendServer, path: '/ws' });
  backendWss.on('connection', (ws) => {
    ws.on('message', (msg) => ws.send(`echo:${msg}`));
  });

  await new Promise<void>((resolve) => backendServer.listen(0, resolve));
  backendPort = (backendServer.address() as any).port;

  // Manager proxy
  proxyApp = createManagerProxy();
  proxyServer = createServer(proxyApp);
  setupWebSocketProxy(proxyServer);
  await new Promise<void>((resolve) => proxyServer.listen(0, resolve));
});

afterAll(async () => {
  backendWss.close();
  await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
  await new Promise<void>((resolve) => backendServer.close(() => resolve()));
});

beforeEach(() => {
  clearRegistry();
});

// ---------------------------------------------------------------------------
// Registry unit tests
// ---------------------------------------------------------------------------
describe('registry', () => {
  it('registerRepo and listRepos', () => {
    registerRepo('my-repo', { port: 4001, name: 'My Repo', path: '/home/user/my-repo' });
    const repos = listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0]).toEqual({
      repoId: 'my-repo',
      port: 4001,
      name: 'My Repo',
      path: '/home/user/my-repo',
    });
  });

  it('getRepo returns instance or undefined', () => {
    registerRepo('repo-a', { port: 4001, name: 'A', path: '/a' });
    expect(getRepo('repo-a')).toEqual({ port: 4001, name: 'A', path: '/a' });
    expect(getRepo('nonexistent')).toBeUndefined();
  });

  it('unregisterRepo removes entry', () => {
    registerRepo('repo-b', { port: 4002, name: 'B', path: '/b' });
    expect(unregisterRepo('repo-b')).toBe(true);
    expect(getRepo('repo-b')).toBeUndefined();
    expect(unregisterRepo('repo-b')).toBe(false);
  });

  it('clearRegistry empties everything', () => {
    registerRepo('r1', { port: 4001, name: 'R1', path: '/r1' });
    registerRepo('r2', { port: 4002, name: 'R2', path: '/r2' });
    clearRegistry();
    expect(listRepos()).toHaveLength(0);
  });

  it('re-registration updates instance and proxy', async () => {
    registerRepo('test-repo', { port: 59998, name: 'Old', path: '/old' });
    // Re-register with the real backend port
    registerRepo('test-repo', { port: backendPort, name: 'New', path: '/new' });
    expect(getRepo('test-repo')?.name).toBe('New');
    expect(getRepo('test-repo')?.port).toBe(backendPort);

    // Verify proxy actually routes to the new port
    const { status, body } = await request(proxyServer, '/test-repo/api/health');
    expect(status).toBe(200);
    expect(body.source).toBe('backend');
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
describe('validation', () => {
  it('rejects empty repoId', () => {
    expect(() => registerRepo('', { port: 4001, name: 'X', path: '/x' })).toThrow('Invalid repoId');
  });

  it('rejects repoId with uppercase letters', () => {
    expect(() => registerRepo('MyRepo', { port: 4001, name: 'X', path: '/x' })).toThrow(
      'Invalid repoId',
    );
  });

  it('rejects repoId with slashes', () => {
    expect(() => registerRepo('a/b', { port: 4001, name: 'X', path: '/x' })).toThrow(
      'Invalid repoId',
    );
  });

  it('rejects repoId starting with dash', () => {
    expect(() => registerRepo('-bad', { port: 4001, name: 'X', path: '/x' })).toThrow(
      'Invalid repoId',
    );
  });

  it('rejects reserved repoIds', () => {
    for (const reserved of ['api', 'static', 'health', 'ws']) {
      expect(() => registerRepo(reserved, { port: 4001, name: 'X', path: '/x' })).toThrow(
        'Reserved repoId',
      );
    }
  });

  it('rejects invalid ports', () => {
    expect(() => registerRepo('repo', { port: 0, name: 'X', path: '/x' })).toThrow('Invalid port');
    expect(() => registerRepo('repo', { port: -1, name: 'X', path: '/x' })).toThrow('Invalid port');
    expect(() => registerRepo('repo', { port: 70000, name: 'X', path: '/x' })).toThrow(
      'Invalid port',
    );
    expect(() => registerRepo('repo', { port: 3.14, name: 'X', path: '/x' })).toThrow(
      'Invalid port',
    );
  });

  it('accepts valid repoIds with dots, dashes, underscores', () => {
    expect(() =>
      registerRepo('my.repo_v2-test', { port: 4001, name: 'X', path: '/x' }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Landing page & Hub API — no info disclosure
// ---------------------------------------------------------------------------
describe('landing page & hub API', () => {
  it('GET / returns service info with safe repo list (no port/path)', async () => {
    registerRepo('demo', { port: backendPort, name: 'Demo', path: '/secret/demo' });
    const { status, body } = await request(proxyServer, '/');
    expect(status).toBe(200);
    expect(body.service).toBe('hermes-monitor-manager');
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].repoId).toBe('demo');
    expect(body.repos[0].name).toBe('Demo');
    // Must NOT expose internal details
    expect(body.repos[0].port).toBeUndefined();
    expect(body.repos[0].path).toBeUndefined();
  });

  it('GET /api/hub/repos lists repos without port/path', async () => {
    registerRepo('alpha', { port: 4001, name: 'Alpha', path: '/alpha' });
    registerRepo('beta', { port: 4002, name: 'Beta', path: '/beta' });
    const { status, body } = await request(proxyServer, '/api/hub/repos');
    expect(status).toBe(200);
    expect(body.repos).toHaveLength(2);
    expect(body.repos[0]).toEqual({ repoId: 'alpha', name: 'Alpha' });
    expect(body.repos[1]).toEqual({ repoId: 'beta', name: 'Beta' });
  });

  it('GET /api/hub/repos/:repoId returns single repo without port/path', async () => {
    registerRepo('gamma', { port: 4003, name: 'Gamma', path: '/gamma' });
    const { status, body } = await request(proxyServer, '/api/hub/repos/gamma');
    expect(status).toBe(200);
    expect(body).toEqual({ repoId: 'gamma', name: 'Gamma' });
  });

  it('GET /api/hub/repos/:repoId returns 404 for unknown repo', async () => {
    const { status, body } = await request(proxyServer, '/api/hub/repos/nope');
    expect(status).toBe(404);
    expect(body.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Proxy routing — HTTP
// ---------------------------------------------------------------------------
describe('proxy routing', () => {
  beforeEach(() => {
    registerRepo('test-repo', { port: backendPort, name: 'Test', path: '/test' });
  });

  it('proxies GET /{repoId}/api/health to backend', async () => {
    const { status, body } = await request(proxyServer, '/test-repo/api/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.source).toBe('backend');
  });

  it('proxies GET /{repoId}/api/issues to backend', async () => {
    const { status, body } = await request(proxyServer, '/test-repo/api/issues');
    expect(status).toBe(200);
    expect(body.issues).toEqual(['issue-1', 'issue-2']);
  });

  it('proxies /{repoId}/ root to backend', async () => {
    const { status, body } = await request(proxyServer, '/test-repo/');
    expect(status).toBe(200);
    expect(body.page).toBe('repo-home');
  });

  it('proxies /{repoId} without trailing slash', async () => {
    const { status, body } = await request(proxyServer, '/test-repo');
    expect(status).toBe(200);
    expect(body.page).toBe('repo-home');
  });

  it('proxies POST requests', async () => {
    const { status, body } = await request(proxyServer, '/test-repo/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'agent-1' }),
    });
    expect(status).toBe(201);
    expect(body.created).toBe(true);
  });

  it('proxies DELETE requests', async () => {
    const { status, body } = await request(proxyServer, '/test-repo/api/agents/42', {
      method: 'DELETE',
    });
    expect(status).toBe(200);
    expect(body.deleted).toBe('42');
  });

  it('returns 404 for unknown repoId', async () => {
    const { status, body } = await request(proxyServer, '/unknown-repo/api/health');
    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('returns 502 when upstream is down', async () => {
    registerRepo('dead-repo', { port: 59999, name: 'Dead', path: '/dead' });
    const { status, body } = await request(proxyServer, '/dead-repo/api/health');
    expect(status).toBe(502);
    expect(body.error).toContain('unavailable');
  });
});

// ---------------------------------------------------------------------------
// WebSocket proxy
// ---------------------------------------------------------------------------
describe('websocket proxy', () => {
  beforeEach(() => {
    registerRepo('test-repo', { port: backendPort, name: 'Test', path: '/test' });
  });

  it('proxies WebSocket connections through /{repoId}/ws', async () => {
    const ws = await connectWs(proxyServer, '/test-repo/ws');
    try {
      expect(ws.readyState).toBe(WebSocket.OPEN);

      const msgPromise = waitForMessage(ws);
      ws.send('hello');
      const reply = await msgPromise;
      expect(reply).toBe('echo:hello');
    } finally {
      ws.close();
    }
  });

  it('destroys socket for unknown repoId', async () => {
    await expect(connectWs(proxyServer, '/unknown-repo/ws')).rejects.toThrow();
  });

  it('destroys socket for reserved path', async () => {
    await expect(connectWs(proxyServer, '/api/something')).rejects.toThrow();
  });
});
