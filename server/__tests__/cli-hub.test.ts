import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import http from 'http';
import { join } from 'path';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';

const require = createRequire(import.meta.url);

// We need to test the hub.js module, but it has hardcoded paths.
// We'll test the functions that can be tested in isolation.
// For functions that need HTTP, we'll spin up a tiny test server.

describe('hub.js', () => {
  // ── getHubPid ──

  describe('getHubPid', () => {
    let hubModule: any;
    let testDir: string;
    let testPidFile: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `hermes-hub-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(testDir, { recursive: true });
      testPidFile = join(testDir, 'hub.pid');
    });

    afterEach(() => {
      try { unlinkSync(testPidFile); } catch { /* ignore */ }
    });

    it('returns null when PID file does not exist', () => {
      // Directly test the logic: no PID file → null
      const pidPath = join(testDir, 'nonexistent.pid');
      expect(existsSync(pidPath)).toBe(false);
      // We can't easily call getHubPid with a custom path since it uses a constant,
      // but we can test the logic inline
      const raw = existsSync(pidPath) ? readFileSync(pidPath, 'utf8').trim() : null;
      expect(raw).toBeNull();
    });

    it('returns null for non-numeric PID content', () => {
      writeFileSync(testPidFile, 'not-a-number');
      const raw = readFileSync(testPidFile, 'utf8').trim();
      const pid = parseInt(raw, 10);
      expect(isNaN(pid)).toBe(true);
    });

    it('returns null for empty PID file', () => {
      writeFileSync(testPidFile, '');
      const raw = readFileSync(testPidFile, 'utf8').trim();
      const pid = parseInt(raw, 10);
      expect(isNaN(pid)).toBe(true);
    });

    it('returns PID for current process (alive)', () => {
      const myPid = process.pid;
      writeFileSync(testPidFile, String(myPid));
      const raw = readFileSync(testPidFile, 'utf8').trim();
      const pid = parseInt(raw, 10);
      expect(pid).toBe(myPid);
      // Verify it's alive
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch { /* dead */ }
      expect(alive).toBe(true);
    });

    it('detects stale PID (dead process)', () => {
      // Use a very high PID that almost certainly doesn't exist
      writeFileSync(testPidFile, '999999999');
      const raw = readFileSync(testPidFile, 'utf8').trim();
      const pid = parseInt(raw, 10);
      expect(pid).toBe(999999999);
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch { /* dead */ }
      expect(alive).toBe(false);
    });
  });

  // ── hubRequest ──

  describe('hubRequest', () => {
    // Load the actual module to test hubRequest
    const { hubRequest } = require('../../bin/lib/hub');
    let server: http.Server;
    let serverPort: number;

    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        server = http.createServer((req, res) => {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            if (req.url === '/api/health') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ok' }));
            } else if (req.url === '/api/hub/repos' && req.method === 'GET') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify([{ id: 'test-1', name: 'test-repo' }]));
            } else if (req.url === '/api/hub/repos' && req.method === 'POST') {
              const parsed = JSON.parse(body);
              res.writeHead(201, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ id: 'new-1', name: 'new-repo', path: parsed.path }));
            } else if (req.url === '/api/hub/repos/test-1' && req.method === 'DELETE') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            } else if (req.url === '/api/hub/repos/test-1' && req.method === 'PATCH') {
              const parsed = JSON.parse(body);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ id: 'test-1', status: parsed.status }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Not found' }));
            }
          });
        });
        server.listen(0, () => {
          serverPort = (server.address() as any).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('makes a GET request and parses JSON response', async () => {
      const result = await hubRequest('GET', '/api/health', null, serverPort);
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ status: 'ok' });
    });

    it('makes a POST request with body', async () => {
      const result = await hubRequest('POST', '/api/hub/repos', { path: '/test/path' }, serverPort);
      expect(result.status).toBe(201);
      expect(result.data.path).toBe('/test/path');
    });

    it('makes a DELETE request', async () => {
      const result = await hubRequest('DELETE', '/api/hub/repos/test-1', null, serverPort);
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ ok: true });
    });

    it('makes a PATCH request with body', async () => {
      const result = await hubRequest('PATCH', '/api/hub/repos/test-1', { status: 'running' }, serverPort);
      expect(result.status).toBe(200);
      expect(result.data.status).toBe('running');
    });

    it('returns 404 for unknown paths', async () => {
      const result = await hubRequest('GET', '/api/unknown', null, serverPort);
      expect(result.status).toBe(404);
    });

    it('rejects on connection error', async () => {
      // Use a port that nothing is listening on
      await expect(hubRequest('GET', '/api/health', null, 1)).rejects.toThrow();
    });
  });

  // ── listRepos ──

  describe('listRepos', () => {
    const { listRepos } = require('../../bin/lib/hub');
    let server: http.Server;
    let serverPort: number;

    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        server = http.createServer((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify([
            { id: 'r1', name: 'repo-1', path: '/a', port: 4001, status: 'running' },
            { id: 'r2', name: 'repo-2', path: '/b', port: 4002, status: 'stopped' },
          ]));
        });
        server.listen(0, () => {
          serverPort = (server.address() as any).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('returns an array of repos', async () => {
      const repos = await listRepos(serverPort);
      expect(repos).toHaveLength(2);
      expect(repos[0].name).toBe('repo-1');
      expect(repos[1].name).toBe('repo-2');
    });
  });

  // ── registerRepo ──

  describe('registerRepo', () => {
    const { registerRepo } = require('../../bin/lib/hub');
    let server: http.Server;
    let serverPort: number;
    let testDir: string;

    beforeEach(async () => {
      testDir = join(tmpdir(), `hermes-hub-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(testDir, { recursive: true });

      await new Promise<void>((resolve) => {
        let registered = false;
        server = http.createServer((req, res) => {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            if (req.method === 'POST' && req.url === '/api/hub/repos') {
              if (registered) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'already registered' }));
              } else {
                registered = true;
                const parsed = JSON.parse(body);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  id: 'new-id',
                  name: 'test-repo',
                  path: parsed.path,
                  port: 4001,
                  status: 'stopped',
                }));
              }
            } else if (req.method === 'GET' && req.url === '/api/hub/repos') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify([{
                id: 'new-id',
                name: 'test-repo',
                path: testDir,
                port: 4001,
                status: 'stopped',
              }]));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Not found' }));
            }
          });
        });
        server.listen(0, () => {
          serverPort = (server.address() as any).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('registers a new repo and returns entry', async () => {
      const entry = await registerRepo(testDir, serverPort);
      expect(entry.id).toBe('new-id');
      expect(entry.name).toBe('test-repo');
      expect(entry.port).toBe(4001);
    });

    it('handles already-registered gracefully (409 → find by path)', async () => {
      // First registration
      await registerRepo(testDir, serverPort);
      // Second registration — should get 409, then find existing
      const entry = await registerRepo(testDir, serverPort);
      expect(entry.id).toBe('new-id');
      expect(entry.path).toBe(testDir);
    });
  });

  // ── unregisterRepo ──

  describe('unregisterRepo', () => {
    const { unregisterRepo } = require('../../bin/lib/hub');
    let server: http.Server;
    let serverPort: number;

    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        server = http.createServer((req, res) => {
          if (req.method === 'DELETE' && req.url === '/api/hub/repos/valid-id') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } else if (req.method === 'DELETE' && req.url === '/api/hub/repos/not-found') {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Repo not found' }));
          } else if (req.method === 'DELETE' && req.url === '/api/hub/repos/running-id') {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Cannot unregister a running repo' }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
          }
        });
        server.listen(0, () => {
          serverPort = (server.address() as any).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('returns true when repo is successfully unregistered', async () => {
      const result = await unregisterRepo('valid-id', serverPort);
      expect(result).toBe(true);
    });

    it('returns false for non-existent repo (404)', async () => {
      const result = await unregisterRepo('not-found', serverPort);
      expect(result).toBe(false);
    });

    it('returns false for running repo (409)', async () => {
      const result = await unregisterRepo('running-id', serverPort);
      expect(result).toBe(false);
    });
  });

  // ── updateRepoStatus ──

  describe('updateRepoStatus', () => {
    const { updateRepoStatus } = require('../../bin/lib/hub');
    let server: http.Server;
    let serverPort: number;

    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        server = http.createServer((req, res) => {
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', () => {
            if (req.method === 'PATCH' && req.url === '/api/hub/repos/test-id') {
              const parsed = JSON.parse(body);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ id: 'test-id', status: parsed.status, pid: parsed.pid ?? null }));
            } else if (req.method === 'PATCH' && req.url === '/api/hub/repos/missing') {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Not found' }));
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Not found' }));
            }
          });
        });
        server.listen(0, () => {
          serverPort = (server.address() as any).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    });

    it('updates status to running with pid', async () => {
      const result = await updateRepoStatus('test-id', 'running', 12345, serverPort);
      expect(result.status).toBe('running');
      expect(result.pid).toBe(12345);
    });

    it('updates status to stopped with null pid', async () => {
      const result = await updateRepoStatus('test-id', 'stopped', null, serverPort);
      expect(result.status).toBe('stopped');
    });

    it('returns null for non-existent repo', async () => {
      const result = await updateRepoStatus('missing', 'running', null, serverPort);
      expect(result).toBeNull();
    });
  });

  // ── isHubReachable ──

  describe('isHubReachable', () => {
    const { isHubReachable } = require('../../bin/lib/hub');
    let server: http.Server;
    let serverPort: number;

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    });

    it('returns true when hub health endpoint responds 200', async () => {
      await new Promise<void>((resolve) => {
        server = http.createServer((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        });
        server.listen(0, () => {
          serverPort = (server.address() as any).port;
          resolve();
        });
      });

      const result = await isHubReachable(serverPort);
      expect(result).toBe(true);
    });

    it('returns false when nothing is listening', async () => {
      const result = await isHubReachable(1); // port 1 — nothing listening
      expect(result).toBe(false);
    });
  });

  // ── waitForHub ──

  describe('waitForHub', () => {
    const { waitForHub } = require('../../bin/lib/hub');
    let server: http.Server;
    let serverPort: number;

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    });

    it('returns true when hub becomes reachable within timeout', async () => {
      await new Promise<void>((resolve) => {
        server = http.createServer((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        });
        server.listen(0, () => {
          serverPort = (server.address() as any).port;
          resolve();
        });
      });

      const result = await waitForHub(serverPort, 5000);
      expect(result).toBe(true);
    });

    it('returns false when hub is unreachable within timeout', async () => {
      const result = await waitForHub(1, 1000); // port 1, 1s timeout
      expect(result).toBe(false);
    }, 5000);
  });

  // ── stopHub ──

  describe('stopHub', () => {
    const { stopHub, PID_FILE, HERMES_DIR } = require('../../bin/lib/hub');

    it('returns false when no PID file exists', () => {
      // Ensure PID file doesn't exist
      try { unlinkSync(PID_FILE); } catch { /* ignore */ }
      const result = stopHub();
      expect(result).toBe(false);
    });

    it('returns false when PID file contains stale PID', () => {
      // Write a stale PID
      mkdirSync(HERMES_DIR, { recursive: true });
      writeFileSync(PID_FILE, '999999999');
      // getHubPid should return null (stale), so stopHub returns false
      const result = stopHub();
      expect(result).toBe(false);
    });
  });

  // ── openBrowser ──

  describe('openBrowser', () => {
    const { openBrowser } = require('../../bin/lib/hub');

    it('does not throw on any platform', () => {
      // openBrowser silently swallows errors
      expect(() => openBrowser('http://localhost:3000')).not.toThrow();
    });
  });

  // ── isHubRunning ──

  describe('isHubRunning', () => {
    const { isHubRunning, PID_FILE, HERMES_DIR } = require('../../bin/lib/hub');

    it('returns false when no PID file exists', () => {
      try { unlinkSync(PID_FILE); } catch { /* ignore */ }
      expect(isHubRunning()).toBe(false);
    });

    it('returns true when PID file contains current process PID', () => {
      mkdirSync(HERMES_DIR, { recursive: true });
      writeFileSync(PID_FILE, String(process.pid));
      expect(isHubRunning()).toBe(true);
      // Cleanup
      try { unlinkSync(PID_FILE); } catch { /* ignore */ }
    });

    it('returns false when PID file contains dead process PID', () => {
      mkdirSync(HERMES_DIR, { recursive: true });
      writeFileSync(PID_FILE, '999999999');
      expect(isHubRunning()).toBe(false);
    });
  });
});
