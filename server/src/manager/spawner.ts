/**
 * @module manager/spawner
 * Spawns and manages hermes-monitor server processes for each registered repo.
 *
 * Responsibilities:
 * - Start/stop/restart individual repo instances
 * - Start all / stop all on manager startup/shutdown
 * - Monitor child processes — mark crashed ones in the registry
 * - Periodic health checks (every 30s) to auto-restart crashed instances
 * - Log stdout/stderr to /tmp/hermes-hub/{repoId}.log
 */
import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import type { Registry, RepoEntry } from './registry.js';

const LOG_DIR = '/tmp/hermes-hub';
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;

/** Resolve the hermes-monitor root directory (repo root). */
function getHermesRoot(): string {
  // In source mode (tsx): this file is at server/src/manager/spawner.ts → root is ../../..
  // In compiled mode: this file is at server/dist/manager/spawner.js → root is ../../..
  return resolve(new URL('.', import.meta.url).pathname, '../../..');
}

export interface SpawnerOptions {
  /** Override the hermes-monitor root directory (for testing). */
  hermesRoot?: string;
  /** Override the log directory (for testing). */
  logDir?: string;
  /** Override the health check interval in ms (for testing). */
  healthCheckIntervalMs?: number;
  /** Override the stop timeout in ms (for testing). */
  stopTimeoutMs?: number;
}

export class Spawner {
  private registry: Registry;
  private processes = new Map<string, ChildProcess>();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private hermesRoot: string;
  private logDir: string;
  private healthCheckIntervalMs: number;
  private stopTimeoutMs: number;
  private stopped = false;

  constructor(registry: Registry, options: SpawnerOptions = {}) {
    this.registry = registry;
    this.hermesRoot = options.hermesRoot ?? getHermesRoot();
    this.logDir = options.logDir ?? LOG_DIR;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? HEALTH_CHECK_INTERVAL_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  }

  /**
   * Spawn a hermes-monitor process for the given repo.
   * Looks up the repo in the registry, spawns the process, stores PID,
   * sets up logging, and monitors for unexpected exits.
   */
  async spawnInstance(repoId: string): Promise<RepoEntry> {
    const repo = this.registry.get(repoId);
    if (!repo) {
      throw new Error(`Repo not found: ${repoId}`);
    }

    // Don't spawn if already running
    if (this.processes.has(repoId)) {
      const existing = this.processes.get(repoId)!;
      if (existing.exitCode === null && !existing.killed) {
        throw new Error(`Instance already running for repo ${repoId}`);
      }
      // Process exited but wasn't cleaned up — remove stale ref
      this.processes.delete(repoId);
    }

    // Mark as starting
    this.registry.updateStatus(repoId, 'starting');

    // Ensure log directory exists
    mkdirSync(this.logDir, { recursive: true });

    const logPath = join(this.logDir, `${repoId}.log`);
    const logStream = createWriteStream(logPath, { flags: 'a' });

    // Write startup header
    logStream.write(`\n--- Instance starting at ${new Date().toISOString()} ---\n`);

    const binPath = join(this.hermesRoot, 'bin', 'hermes-monitor.js');

    const child = spawn('node', [
      binPath,
      '--server-port', String(repo.port),
      '--repo', repo.path,
      '--no-browser',
    ], {
      cwd: this.hermesRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env },
    });

    // Pipe stdout/stderr to log file
    if (child.stdout) child.stdout.pipe(logStream, { end: false });
    if (child.stderr) child.stderr.pipe(logStream, { end: false });

    this.processes.set(repoId, child);

    // Update registry with PID and running status
    const pid = child.pid ?? null;
    this.registry.updateStatus(repoId, 'running', pid);

    // Monitor for unexpected exit
    child.on('exit', (code, signal) => {
      // Unpipe before writing final message to avoid races
      if (child.stdout) child.stdout.unpipe(logStream);
      if (child.stderr) child.stderr.unpipe(logStream);

      try {
        logStream.write(
          `\n--- Instance exited at ${new Date().toISOString()} (code=${code}, signal=${signal}) ---\n`
        );
        logStream.end();
      } catch {
        // Stream may already be closed — ignore
      }

      this.processes.delete(repoId);

      // Only update registry if we're not in a controlled shutdown
      if (this.stopped) return;

      // Check if this was an expected stop (status already set to 'stopped')
      const current = this.registry.get(repoId);
      if (current && current.status !== 'stopped') {
        this.registry.updateStatus(repoId, 'error', null);
      }
    });

    child.on('error', (err) => {
      try {
        logStream.write(`\n--- Spawn error: ${err.message} ---\n`);
        logStream.end();
      } catch {
        // Stream may already be closed — ignore
      }

      this.processes.delete(repoId);

      if (!this.stopped) {
        const current = this.registry.get(repoId);
        if (current && current.status !== 'stopped') {
          this.registry.updateStatus(repoId, 'error', null);
        }
      }
    });

    return this.registry.get(repoId)!;
  }

  /**
   * Stop a running instance. Sends SIGTERM, waits up to 5 seconds,
   * then sends SIGKILL if the process hasn't exited.
   */
  async stopInstance(repoId: string): Promise<RepoEntry> {
    const repo = this.registry.get(repoId);
    if (!repo) {
      throw new Error(`Repo not found: ${repoId}`);
    }

    const child = this.processes.get(repoId);
    if (!child) {
      // No process tracked — just ensure registry says stopped
      this.registry.updateStatus(repoId, 'stopped');
      return this.registry.get(repoId)!;
    }

    // Mark as stopped in registry first so the exit handler doesn't mark as error
    this.registry.updateStatus(repoId, 'stopped');

    await this.killProcess(repoId, child);

    return this.registry.get(repoId)!;
  }

  /**
   * Restart an instance: stop then start.
   */
  async restartInstance(repoId: string): Promise<RepoEntry> {
    await this.stopInstance(repoId);
    return this.spawnInstance(repoId);
  }

  /**
   * Start instances for all registered repos.
   * Skips repos that are already running.
   */
  async startAll(): Promise<void> {
    const repos = this.registry.list();
    for (const repo of repos) {
      if (repo.status === 'running' && this.processes.has(repo.id)) {
        continue; // Already running
      }
      try {
        await this.spawnInstance(repo.id);
      } catch (err: any) {
        console.error(`[spawner] Failed to start ${repo.name} (${repo.id}): ${err.message}`);
      }
    }
  }

  /**
   * Stop all running instances. Called on manager shutdown.
   */
  async stopAll(): Promise<void> {
    this.stopped = true;
    this.stopHealthCheck();

    const stopPromises: Promise<void>[] = [];
    for (const [repoId, child] of Array.from(this.processes.entries())) {
      this.registry.updateStatus(repoId, 'stopped');
      stopPromises.push(this.killProcess(repoId, child));
    }

    await Promise.all(stopPromises);
    this.processes.clear();
  }

  /**
   * Start periodic health checks. Auto-restarts crashed instances.
   */
  startHealthCheck(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck();
    }, this.healthCheckIntervalMs);

    // Don't prevent process exit
    this.healthCheckTimer.unref();
  }

  /**
   * Stop the periodic health check timer.
   */
  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Check all registered repos. If any are in 'error' status (crashed),
   * attempt to restart them.
   */
  private runHealthCheck(): void {
    if (this.stopped) return;

    const repos = this.registry.list();
    for (const repo of repos) {
      if (repo.status === 'error' && !this.processes.has(repo.id)) {
        console.log(`[spawner] Health check: restarting crashed instance ${repo.name} (${repo.id})`);
        this.spawnInstance(repo.id).catch((err) => {
          console.error(`[spawner] Health check restart failed for ${repo.name}: ${err.message}`);
        });
      }
    }
  }

  /**
   * Get the log file path for a repo instance.
   */
  getLogPath(repoId: string): string {
    return join(this.logDir, `${repoId}.log`);
  }

  /**
   * Check if an instance is currently tracked (has a live child process).
   */
  isRunning(repoId: string): boolean {
    const child = this.processes.get(repoId);
    return !!child && child.exitCode === null && !child.killed;
  }

  /**
   * Kill a child process: SIGTERM first, then SIGKILL after timeout.
   */
  private killProcess(repoId: string, child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve) => {
      // If process already exited, we're done
      if (child.exitCode !== null || child.killed) {
        this.processes.delete(repoId);
        resolve();
        return;
      }

      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        this.processes.delete(repoId);
        resolve();
      };

      // Set up timeout for SIGKILL
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process may have already exited
        }
        done();
      }, this.stopTimeoutMs);
      killTimer.unref();

      child.once('exit', () => {
        clearTimeout(killTimer);
        done();
      });

      // Send SIGTERM
      try {
        child.kill('SIGTERM');
      } catch {
        // Process may have already exited
        clearTimeout(killTimer);
        done();
      }
    });
  }
}
