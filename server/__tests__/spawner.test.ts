import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Registry } from '../src/manager/registry.js';
import { Spawner, SpawnerError } from '../src/manager/spawner.js';
import { createSpawnerApiRouter } from '../src/manager/spawner-api.js';

/**
 * Helper: create a minimal fake hermes-monitor entry point that just stays alive.
 * Accepts --server-port, --repo, --no-browser like the real one.
 * Writes a marker file so we can verify it was spawned.
 */
function createFakeBin(dir: string): string {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const script = `
    const fs = require('fs');
    const path = require('path');
    const args = process.argv.slice(2);
    const markerDir = process.env.MARKER_DIR || '/tmp';
    const portIdx = args.indexOf('--server-port');
    const port = portIdx >= 0 ? args[portIdx + 1] : 'unknown';
    const repoIdx = args.indexOf('--repo');
    const repo = repoIdx >= 0 ? args[repoIdx + 1] : 'unknown';
    // Write a marker so tests can verify spawn happened
    fs.writeFileSync(path.join(markerDir, 'spawned-' + port + '.marker'), JSON.stringify({ port, repo, args, pid: process.pid }));
    console.log('Fake hermes-monitor started on port ' + port);
    console.error('Fake stderr output');
    // Stay alive until killed
    setInterval(() => {}, 1000);
    process.on('SIGTERM', () => {
      fs.writeFileSync(path.join(markerDir, 'stopped-' + port + '.marker'), 'stopped');
      process.exit(0);
    });
  `;
  writeFileSync(join(binDir, 'hermes-monitor.js'), script);
  return dir;
}

/**
 * Helper: create a fake bin that exits immediately (simulates crash).
 */
function createCrashingBin(dir: string): string {
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'hermes-monitor.js'), `
    console.log('Crashing immediately');
    process.exit(1);
  `);
  return dir;
}

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

/** Wait for a condition with timeout. */
async function waitFor(fn: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// ── Spawner unit tests ──

describe('Spawner', () => {
  let registry: Registry;
  let spawner: Spawner;
  let tmpDir: string;
  let logDir: string;
  let markerDir: string;
  let hermesRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hermes-spawner-test-'));
    logDir = join(tmpDir, 'logs');
    markerDir = join(tmpDir, 'markers');
    mkdirSync(markerDir, { recursive: true });

    const dbPath = join(tmpDir, 'test-hub.db');
    registry = new Registry(dbPath);

    hermesRoot = createFakeBin(join(tmpDir, 'hermes'));

    spawner = new Spawner(registry, {
      hermesRoot,
      logDir,
      healthCheckIntervalMs: 100, // Fast for testing
      stopTimeoutMs: 2000,
      maxRestartAttempts: 3,
    });

    // Set MARKER_DIR so the fake bin knows where to write markers
    process.env.MARKER_DIR = markerDir;
  });

  afterEach(async () => {
    spawner.stopHealthCheck();
    await spawner.stopAll();
    registry.close();
    delete process.env.MARKER_DIR;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('spawns an instance and updates registry', async () => {
    const repo = registry.register('/tmp/test-repo-a');
    const result = await spawner.spawnInstance(repo.id);

    expect(result.status).toBe('running');
    expect(result.pid).toBeGreaterThan(0);
    expect(spawner.isRunning(repo.id)).toBe(true);

    // Verify marker file was created by the spawned process
    await waitFor(() => existsSync(join(markerDir, `spawned-${repo.port}.marker`)));
    const marker = JSON.parse(readFileSync(join(markerDir, `spawned-${repo.port}.marker`), 'utf-8'));
    expect(marker.port).toBe(String(repo.port));
    expect(marker.repo).toBe('/tmp/test-repo-a');
  });

  it('stops an instance gracefully', async () => {
    const repo = registry.register('/tmp/test-repo-b');
    await spawner.spawnInstance(repo.id);
    expect(spawner.isRunning(repo.id)).toBe(true);

    const result = await spawner.stopInstance(repo.id);
    expect(result.status).toBe('stopped');
    expect(result.pid).toBeNull();
    expect(spawner.isRunning(repo.id)).toBe(false);
  }, 10_000);

  it('restarts an instance', async () => {
    const repo = registry.register('/tmp/test-repo-c');
    await spawner.spawnInstance(repo.id);
    const firstPid = registry.get(repo.id)!.pid;

    const result = await spawner.restartInstance(repo.id);
    expect(result.status).toBe('running');
    expect(result.pid).toBeGreaterThan(0);
    // New process should have a different PID
    expect(result.pid).not.toBe(firstPid);
  });

  it('throws SpawnerError NOT_FOUND when spawning for nonexistent repo', async () => {
    try {
      await spawner.spawnInstance('nonexistent');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnerError);
      expect((err as SpawnerError).code).toBe('NOT_FOUND');
    }
  });

  it('throws SpawnerError ALREADY_RUNNING when instance is already running', async () => {
    const repo = registry.register('/tmp/test-repo-d');
    await spawner.spawnInstance(repo.id);

    try {
      await spawner.spawnInstance(repo.id);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnerError);
      expect((err as SpawnerError).code).toBe('ALREADY_RUNNING');
    }
  });

  it('throws SpawnerError NOT_FOUND when stopping nonexistent repo', async () => {
    try {
      await spawner.stopInstance('nonexistent');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SpawnerError);
      expect((err as SpawnerError).code).toBe('NOT_FOUND');
    }
  });

  it('stopInstance on non-running repo just sets status to stopped', async () => {
    const repo = registry.register('/tmp/test-repo-e');
    // Don't spawn, just stop
    const result = await spawner.stopInstance(repo.id);
    expect(result.status).toBe('stopped');
    expect(result.pid).toBeNull();
  });

  it('startAll starts all registered repos in parallel', async () => {
    registry.register('/tmp/test-repo-f');
    registry.register('/tmp/test-repo-g');

    await spawner.startAll();

    const repos = registry.list();
    expect(repos).toHaveLength(2);
    expect(repos[0].status).toBe('running');
    expect(repos[1].status).toBe('running');
    expect(spawner.isRunning(repos[0].id)).toBe(true);
    expect(spawner.isRunning(repos[1].id)).toBe(true);
  });

  it('startAll skips already-running repos', async () => {
    const repo = registry.register('/tmp/test-repo-h');
    await spawner.spawnInstance(repo.id);
    const firstPid = registry.get(repo.id)!.pid;

    // startAll should not restart an already-running instance
    await spawner.startAll();
    const currentPid = registry.get(repo.id)!.pid;
    expect(currentPid).toBe(firstPid);
  });

  it('stopAll stops all running instances', async () => {
    registry.register('/tmp/test-repo-i');
    registry.register('/tmp/test-repo-j');
    await spawner.startAll();

    await spawner.stopAll();

    const repos = registry.list();
    expect(repos[0].status).toBe('stopped');
    expect(repos[1].status).toBe('stopped');
    expect(repos[0].pid).toBeNull();
    expect(repos[1].pid).toBeNull();
  });

  it('startAll resets stopped flag after stopAll', async () => {
    const repo = registry.register('/tmp/test-repo-reset');
    await spawner.spawnInstance(repo.id);
    await spawner.stopAll();

    // startAll should reset the stopped flag and work again
    await spawner.startAll();
    const current = registry.get(repo.id)!;
    expect(current.status).toBe('running');
    expect(spawner.isRunning(repo.id)).toBe(true);
  });

  it('creates log directory and writes logs', async () => {
    const repo = registry.register('/tmp/test-repo-k');
    await spawner.spawnInstance(repo.id);

    // Wait for the fake process to write output
    await waitFor(() => {
      if (!existsSync(join(logDir, `${repo.id}.log`))) return false;
      const content = readFileSync(join(logDir, `${repo.id}.log`), 'utf-8');
      return content.includes('Instance starting');
    });

    const logContent = readFileSync(join(logDir, `${repo.id}.log`), 'utf-8');
    expect(logContent).toContain('Instance starting');
  });

  it('getLogPath returns correct path', () => {
    const repo = registry.register('/tmp/test-repo-l');
    expect(spawner.getLogPath(repo.id)).toBe(join(logDir, `${repo.id}.log`));
  });

  it('marks crashed process as error in registry', async () => {
    // Use a crashing binary
    const crashRoot = createCrashingBin(join(tmpDir, 'crash-hermes'));
    const crashSpawner = new Spawner(registry, {
      hermesRoot: crashRoot,
      logDir,
      healthCheckIntervalMs: 100,
      stopTimeoutMs: 2000,
    });

    const repo = registry.register('/tmp/test-repo-crash');
    await crashSpawner.spawnInstance(repo.id);

    // Wait for the process to crash and registry to update
    await waitFor(() => {
      const current = registry.get(repo.id);
      return current?.status === 'error';
    });

    const current = registry.get(repo.id)!;
    expect(current.status).toBe('error');
    expect(crashSpawner.isRunning(repo.id)).toBe(false);

    await crashSpawner.stopAll();
  });

  it('clears stale PID when setting status to starting', async () => {
    const repo = registry.register('/tmp/test-repo-stale-pid');
    // Manually set a PID as if from a previous run
    registry.updateStatus(repo.id, 'running', 99999);
    expect(registry.get(repo.id)!.pid).toBe(99999);

    // Simulate a crash
    registry.updateStatus(repo.id, 'error', null);

    // Spawn should clear the stale PID when setting 'starting'
    await spawner.spawnInstance(repo.id);
    const current = registry.get(repo.id)!;
    expect(current.status).toBe('running');
    // PID should be the real new PID, not the stale 99999
    expect(current.pid).not.toBe(99999);
    expect(current.pid).toBeGreaterThan(0);
  });

  it('health check restarts crashed instances', async () => {
    const repo = registry.register('/tmp/test-repo-health');

    // Manually set status to error to simulate a crash
    registry.updateStatus(repo.id, 'error', null);

    // Start health checking — it should detect the errored instance and restart it
    spawner.startHealthCheck();

    // Wait for the health check to restart the instance
    await waitFor(() => {
      const current = registry.get(repo.id);
      return current?.status === 'running';
    }, 5000);

    const current = registry.get(repo.id)!;
    expect(current.status).toBe('running');
    expect(current.pid).toBeGreaterThan(0);
  });

  // ── Concurrency tests ──

  it('prevents concurrent spawnInstance calls for the same repo', async () => {
    const repo = registry.register('/tmp/test-repo-concurrent');

    // Fire two spawns concurrently
    const results = await Promise.allSettled([
      spawner.spawnInstance(repo.id),
      spawner.spawnInstance(repo.id),
    ]);

    // One should succeed, one should fail with SPAWN_IN_PROGRESS or ALREADY_RUNNING
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(SpawnerError);
    expect(['SPAWN_IN_PROGRESS', 'ALREADY_RUNNING']).toContain(err.code);
  });

  it('crash-loop backoff tracks restart attempts', async () => {
    const crashRoot = createCrashingBin(join(tmpDir, 'crash-backoff'));
    const backoffSpawner = new Spawner(registry, {
      hermesRoot: crashRoot,
      logDir,
      healthCheckIntervalMs: 50,
      stopTimeoutMs: 2000,
      maxRestartAttempts: 2,
    });

    const repo = registry.register('/tmp/test-repo-backoff');
    await backoffSpawner.spawnInstance(repo.id);

    // Wait for crash → error status
    await waitFor(() => {
      const current = registry.get(repo.id);
      return current?.status === 'error';
    });

    // Should have restart state after crash
    const state = backoffSpawner.getRestartState(repo.id);
    expect(state).toBeDefined();
    expect(state!.attempts).toBe(1);
    expect(state!.nextAllowedAt).toBeGreaterThan(0);

    await backoffSpawner.stopAll();
  });

  it('explicit stop clears restart backoff state', async () => {
    const crashRoot = createCrashingBin(join(tmpDir, 'crash-clear'));
    const clearSpawner = new Spawner(registry, {
      hermesRoot: crashRoot,
      logDir,
      healthCheckIntervalMs: 50,
      stopTimeoutMs: 2000,
    });

    const repo = registry.register('/tmp/test-repo-clear-backoff');
    await clearSpawner.spawnInstance(repo.id);

    // Wait for crash
    await waitFor(() => {
      const current = registry.get(repo.id);
      return current?.status === 'error';
    });

    // Backoff state should exist
    expect(clearSpawner.getRestartState(repo.id)).toBeDefined();

    // Explicit stop should clear it
    await clearSpawner.stopInstance(repo.id);
    expect(clearSpawner.getRestartState(repo.id)).toBeUndefined();

    await clearSpawner.stopAll();
  });

  it('SpawnerError has correct name and code', () => {
    const err = new SpawnerError('test error', 'NOT_FOUND');
    expect(err.name).toBe('SpawnerError');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('test error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SpawnerError);
  });
});

// ── Spawner API tests ──

describe('Spawner API', () => {
  let registry: Registry;
  let spawner: Spawner;
  let server: Server;
  let tmpDir: string;
  let markerDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hermes-spawner-api-test-'));
    markerDir = join(tmpDir, 'markers');
    mkdirSync(markerDir, { recursive: true });
    process.env.MARKER_DIR = markerDir;

    const dbPath = join(tmpDir, 'test-hub.db');
    registry = new Registry(dbPath);

    const hermesRoot = createFakeBin(join(tmpDir, 'hermes'));
    spawner = new Spawner(registry, {
      hermesRoot,
      logDir: join(tmpDir, 'logs'),
      healthCheckIntervalMs: 60_000, // Don't interfere with tests
      stopTimeoutMs: 2000,
    });

    const app = express();
    app.use('/api', createSpawnerApiRouter(spawner));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    spawner.stopHealthCheck();
    await spawner.stopAll();
    registry.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.MARKER_DIR;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('POST /api/hub/repos/:id/start starts an instance', async () => {
    const repo = registry.register('/tmp/test-api-start');
    const res = await request(server, 'POST', `/api/hub/repos/${repo.id}/start`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.pid).toBeGreaterThan(0);
  });

  it('POST /api/hub/repos/:id/start returns 404 for unknown repo', async () => {
    const res = await request(server, 'POST', '/api/hub/repos/nonexistent/start');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('POST /api/hub/repos/:id/start returns 409 when already running', async () => {
    const repo = registry.register('/tmp/test-api-dup-start');
    await request(server, 'POST', `/api/hub/repos/${repo.id}/start`);

    const res = await request(server, 'POST', `/api/hub/repos/${repo.id}/start`);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already running');
    expect(res.body.code).toBe('ALREADY_RUNNING');
  });

  it('POST /api/hub/repos/:id/stop stops an instance', async () => {
    const repo = registry.register('/tmp/test-api-stop');
    await request(server, 'POST', `/api/hub/repos/${repo.id}/start`);

    const res = await request(server, 'POST', `/api/hub/repos/${repo.id}/stop`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stopped');
    expect(res.body.pid).toBeNull();
  });

  it('POST /api/hub/repos/:id/stop returns 404 for unknown repo', async () => {
    const res = await request(server, 'POST', '/api/hub/repos/nonexistent/stop');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('POST /api/hub/repos/:id/restart restarts an instance', async () => {
    const repo = registry.register('/tmp/test-api-restart');
    await request(server, 'POST', `/api/hub/repos/${repo.id}/start`);
    const firstPid = registry.get(repo.id)!.pid;

    const res = await request(server, 'POST', `/api/hub/repos/${repo.id}/restart`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('running');
    expect(res.body.pid).toBeGreaterThan(0);
    expect(res.body.pid).not.toBe(firstPid);
  });

  it('POST /api/hub/repos/:id/restart returns 404 for unknown repo', async () => {
    const res = await request(server, 'POST', '/api/hub/repos/nonexistent/restart');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('concurrent start requests return 409 for the second', async () => {
    const repo = registry.register('/tmp/test-api-concurrent');

    // Fire two starts concurrently via the API
    const [res1, res2] = await Promise.all([
      request(server, 'POST', `/api/hub/repos/${repo.id}/start`),
      request(server, 'POST', `/api/hub/repos/${repo.id}/start`),
    ]);

    // One should succeed (200), one should get 409
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});
