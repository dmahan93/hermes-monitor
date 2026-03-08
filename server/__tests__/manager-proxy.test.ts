import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import {
  createManagerProxy,
  registerRepo,
  unregisterRepo,
  listRepos,
  getRepo,
  clearRegistry,
} from '../src/manager/proxy.js';

// Helper: make an HTTP request and return { status, body }
async function request(server: Server, path: string): Promise<{ status: number; body: any }> {
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Mock backend — simulates a per-repo hermes-monitor instance
// ---------------------------------------------------------------------------
let backendApp: express.Express;
let backendServer: Server;
let backendPort: number;

// Manager proxy
let proxyApp: express.Express;
let proxyServer: Server;

beforeAll(async () => {
  // Start a fake backend that echoes request info
  backendApp = express();
  backendApp.get('/api/health', (_req, res) => res.json({ status: 'ok', source: 'backend' }));
  backendApp.get('/api/issues', (_req, res) => res.json({ issues: ['issue-1', 'issue-2'] }));
  backendApp.get('/', (_req, res) => res.json({ page: 'repo-home' }));

  backendServer = createServer(backendApp);
  await new Promise<void>((resolve) => backendServer.listen(0, resolve));
  backendPort = (backendServer.address() as any).port;

  // Start the manager proxy
  proxyApp = createManagerProxy();
  proxyServer = createServer(proxyApp);
  await new Promise<void>((resolve) => proxyServer.listen(0, resolve));
});

afterAll(async () => {
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
});

// ---------------------------------------------------------------------------
// Landing page & Hub API
// ---------------------------------------------------------------------------
describe('landing page & hub API', () => {
  it('GET / returns service info and repo list', async () => {
    registerRepo('demo', { port: backendPort, name: 'Demo', path: '/demo' });
    const { status, body } = await request(proxyServer, '/');
    expect(status).toBe(200);
    expect(body.service).toBe('hermes-monitor-manager');
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].repoId).toBe('demo');
  });

  it('GET /api/hub/repos lists registered repos', async () => {
    registerRepo('alpha', { port: 4001, name: 'Alpha', path: '/alpha' });
    registerRepo('beta', { port: 4002, name: 'Beta', path: '/beta' });
    const { status, body } = await request(proxyServer, '/api/hub/repos');
    expect(status).toBe(200);
    expect(body.repos).toHaveLength(2);
  });

  it('GET /api/hub/repos/:repoId returns single repo', async () => {
    registerRepo('gamma', { port: 4003, name: 'Gamma', path: '/gamma' });
    const { status, body } = await request(proxyServer, '/api/hub/repos/gamma');
    expect(status).toBe(200);
    expect(body.repoId).toBe('gamma');
    expect(body.name).toBe('Gamma');
  });

  it('GET /api/hub/repos/:repoId returns 404 for unknown repo', async () => {
    const { status, body } = await request(proxyServer, '/api/hub/repos/nope');
    expect(status).toBe(404);
    expect(body.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Proxy routing
// ---------------------------------------------------------------------------
describe('proxy routing', () => {
  beforeEach(() => {
    registerRepo('test-repo', { port: backendPort, name: 'Test', path: '/test' });
  });

  it('proxies /{repoId}/api/health to backend', async () => {
    const { status, body } = await request(proxyServer, '/test-repo/api/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.source).toBe('backend');
  });

  it('proxies /{repoId}/api/issues to backend', async () => {
    const { status, body } = await request(proxyServer, '/test-repo/api/issues');
    expect(status).toBe(200);
    expect(body.issues).toEqual(['issue-1', 'issue-2']);
  });

  it('proxies /{repoId}/ root to backend', async () => {
    const { status, body } = await request(proxyServer, '/test-repo/');
    expect(status).toBe(200);
    expect(body.page).toBe('repo-home');
  });

  it('returns 404 for unknown repoId', async () => {
    const { status, body } = await request(proxyServer, '/unknown-repo/api/health');
    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('returns 502 when upstream is down', async () => {
    // Register a repo pointing to a port with nothing listening
    registerRepo('dead-repo', { port: 59999, name: 'Dead', path: '/dead' });
    const { status, body } = await request(proxyServer, '/dead-repo/api/health');
    expect(status).toBe(502);
    expect(body.error).toContain('unavailable');
  });
});
