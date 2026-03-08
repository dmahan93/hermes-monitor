import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Registry, type RepoEntry } from '../src/manager/registry.js';
import { createRegistryApiRouter } from '../src/manager/registry-api.js';

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

// ── Registry class unit tests ──

describe('Registry', () => {
  let registry: Registry;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hermes-registry-test-'));
    dbPath = join(tmpDir, 'test-hub.db');
    registry = new Registry(dbPath);
  });

  afterEach(() => {
    registry.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers a repo with auto-assigned port', () => {
    const entry = registry.register('/tmp/my-repo');
    expect(entry.id).toBeDefined();
    expect(entry.name).toBe('my-repo');
    expect(entry.path).toBe('/tmp/my-repo');
    expect(entry.port).toBe(4001);
    expect(entry.pid).toBeNull();
    expect(entry.status).toBe('stopped');
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.updatedAt).toBeGreaterThan(0);
  });

  it('registers with custom name', () => {
    const entry = registry.register('/tmp/my-repo', 'Custom Name');
    expect(entry.name).toBe('Custom Name');
  });

  it('auto-detects name from directory basename', () => {
    const entry = registry.register('/home/user/projects/awesome-project');
    expect(entry.name).toBe('awesome-project');
  });

  it('auto-assigns incrementing ports', () => {
    const a = registry.register('/tmp/repo-a');
    const b = registry.register('/tmp/repo-b');
    const c = registry.register('/tmp/repo-c');
    expect(a.port).toBe(4001);
    expect(b.port).toBe(4002);
    expect(c.port).toBe(4003);
  });

  it('fills port gaps when repos are unregistered', () => {
    const a = registry.register('/tmp/repo-a');
    const b = registry.register('/tmp/repo-b');
    registry.register('/tmp/repo-c');

    // Remove repo-a (port 4001) and repo-b (port 4002)
    registry.unregister(a.id);
    registry.unregister(b.id);

    // Next registration should fill the gap at 4001
    const d = registry.register('/tmp/repo-d');
    expect(d.port).toBe(4001);

    const e = registry.register('/tmp/repo-e');
    expect(e.port).toBe(4002);
  });

  it('throws when registering duplicate path', () => {
    registry.register('/tmp/my-repo');
    expect(() => registry.register('/tmp/my-repo')).toThrow('already registered');
  });

  it('resolves relative paths for dedup', () => {
    registry.register('/tmp/my-repo');
    // /tmp/my-repo and /tmp/./my-repo resolve to the same path
    expect(() => registry.register('/tmp/./my-repo')).toThrow('already registered');
  });

  it('lists all repos', () => {
    registry.register('/tmp/repo-a', 'Repo A');
    registry.register('/tmp/repo-b', 'Repo B');
    const repos = registry.list();
    expect(repos).toHaveLength(2);
    expect(repos[0].name).toBe('Repo A');
    expect(repos[1].name).toBe('Repo B');
  });

  it('lists empty when no repos registered', () => {
    expect(registry.list()).toEqual([]);
  });

  it('gets a repo by ID', () => {
    const entry = registry.register('/tmp/my-repo');
    const fetched = registry.get(entry.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(entry.id);
    expect(fetched!.name).toBe('my-repo');
  });

  it('returns null for unknown ID', () => {
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('unregisters a repo', () => {
    const entry = registry.register('/tmp/my-repo');
    const removed = registry.unregister(entry.id);
    expect(removed).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it('returns false when unregistering unknown ID', () => {
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('updates status and pid', () => {
    const entry = registry.register('/tmp/my-repo');
    const updated = registry.updateStatus(entry.id, 'running', 12345);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('running');
    expect(updated!.pid).toBe(12345);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt);
  });

  it('clears pid when stopping', () => {
    const entry = registry.register('/tmp/my-repo');
    registry.updateStatus(entry.id, 'running', 12345);
    const stopped = registry.updateStatus(entry.id, 'stopped');
    expect(stopped!.status).toBe('stopped');
    expect(stopped!.pid).toBeNull();
  });

  it('finds by path', () => {
    const entry = registry.register('/tmp/my-repo');
    const found = registry.findByPath('/tmp/my-repo');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(entry.id);
  });

  it('findByPath resolves relative paths', () => {
    registry.register('/tmp/my-repo');
    const found = registry.findByPath('/tmp/./my-repo');
    expect(found).not.toBeNull();
    expect(found!.path).toBe('/tmp/my-repo');
  });

  it('findByPath returns null for unknown path', () => {
    expect(registry.findByPath('/tmp/unknown')).toBeNull();
  });

  it('nextPort returns 4001 when empty', () => {
    expect(registry.nextPort()).toBe(4001);
  });

  it('data survives close and reopen', () => {
    registry.register('/tmp/persistent-repo', 'Persisted');
    registry.close();

    const registry2 = new Registry(dbPath);
    const repos = registry2.list();
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('Persisted');
    expect(repos[0].path).toBe('/tmp/persistent-repo');
    registry2.close();

    // Reassign so afterEach doesn't double-close
    registry = new Registry(dbPath);
  });
});

// ── Registry API endpoint tests ──

describe('Registry API', () => {
  let registry: Registry;
  let server: Server;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hermes-registry-api-test-'));
    const dbPath = join(tmpDir, 'test-hub.db');
    registry = new Registry(dbPath);

    const app = express();
    app.use('/api', createRegistryApiRouter(registry));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    registry.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── GET /api/hub/repos ──

  it('GET /api/hub/repos returns empty array when no repos', async () => {
    const res = await request(server, 'GET', '/api/hub/repos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /api/hub/repos returns all registered repos', async () => {
    registry.register('/tmp/repo-a', 'Repo A');
    registry.register('/tmp/repo-b', 'Repo B');

    const res = await request(server, 'GET', '/api/hub/repos');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Repo A');
    expect(res.body[1].name).toBe('Repo B');
  });

  // ── POST /api/hub/repos ──

  it('POST /api/hub/repos registers a new repo', async () => {
    const res = await request(server, 'POST', '/api/hub/repos', {
      path: '/tmp/new-repo',
      name: 'New Repo',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Repo');
    expect(res.body.path).toBe('/tmp/new-repo');
    expect(res.body.port).toBe(4001);
    expect(res.body.status).toBe('stopped');
  });

  it('POST /api/hub/repos auto-detects name from path', async () => {
    const res = await request(server, 'POST', '/api/hub/repos', {
      path: '/home/user/my-awesome-project',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('my-awesome-project');
  });

  it('POST /api/hub/repos returns 400 when path missing', async () => {
    const res = await request(server, 'POST', '/api/hub/repos', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('path is required');
  });

  it('POST /api/hub/repos returns 400 when path is not a string', async () => {
    const res = await request(server, 'POST', '/api/hub/repos', { path: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('path is required');
  });

  it('POST /api/hub/repos returns 409 for duplicate path', async () => {
    await request(server, 'POST', '/api/hub/repos', { path: '/tmp/dup-repo' });
    const res = await request(server, 'POST', '/api/hub/repos', { path: '/tmp/dup-repo' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already registered');
  });

  it('POST /api/hub/repos trims whitespace from path and name', async () => {
    const res = await request(server, 'POST', '/api/hub/repos', {
      path: '  /tmp/trimmed-repo  ',
      name: '  Trimmed Name  ',
    });
    expect(res.status).toBe(201);
    expect(res.body.path).toBe('/tmp/trimmed-repo');
    expect(res.body.name).toBe('Trimmed Name');
  });

  // ── GET /api/hub/repos/:id ──

  it('GET /api/hub/repos/:id returns repo details', async () => {
    const created = await request(server, 'POST', '/api/hub/repos', {
      path: '/tmp/detail-repo',
    });
    const res = await request(server, 'GET', `/api/hub/repos/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.name).toBe('detail-repo');
  });

  it('GET /api/hub/repos/:id returns 404 for unknown id', async () => {
    const res = await request(server, 'GET', '/api/hub/repos/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Repo not found');
  });

  // ── DELETE /api/hub/repos/:id ──

  it('DELETE /api/hub/repos/:id removes a repo', async () => {
    const created = await request(server, 'POST', '/api/hub/repos', {
      path: '/tmp/delete-repo',
    });
    const res = await request(server, 'DELETE', `/api/hub/repos/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify it's gone
    const list = await request(server, 'GET', '/api/hub/repos');
    expect(list.body).toEqual([]);
  });

  it('DELETE /api/hub/repos/:id returns 404 for unknown id', async () => {
    const res = await request(server, 'DELETE', '/api/hub/repos/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Repo not found');
  });

  // ── Port auto-assignment through API ──

  it('auto-assigns incrementing ports through API', async () => {
    const a = await request(server, 'POST', '/api/hub/repos', { path: '/tmp/port-a' });
    const b = await request(server, 'POST', '/api/hub/repos', { path: '/tmp/port-b' });
    expect(a.body.port).toBe(4001);
    expect(b.body.port).toBe(4002);
  });

  it('reassigns freed ports after deletion', async () => {
    const a = await request(server, 'POST', '/api/hub/repos', { path: '/tmp/port-a' });
    await request(server, 'POST', '/api/hub/repos', { path: '/tmp/port-b' });

    // Delete the first one (port 4001)
    await request(server, 'DELETE', `/api/hub/repos/${a.body.id}`);

    // New registration should get port 4001 back
    const c = await request(server, 'POST', '/api/hub/repos', { path: '/tmp/port-c' });
    expect(c.body.port).toBe(4001);
  });
});
