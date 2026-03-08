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
 * - Crash-loop backoff: exponential delay on repeated crashes (30s → 60s → 120s → 5min cap)
 * - Per-repo spawn lock to prevent concurrent duplicate spawns
 */
import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import { join, resolve } from 'path';
import type { Registry, RepoEntry } from './registry.js';

const LOG_DIR = '/tmp/hermes-hub';
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000; // 5 minutes
const MAX_RESTART_ATTEMPTS = 10;

/** Resolve the hermes-monitor root directory (repo root). */
function getHermesRoot(): string {
  // In source mode (tsx): this file is at server/src/manager/spawner.ts → root is ../../..
  // In compiled mode: this file is at server/dist/manager/spawner.js → root is ../../..
  return resolve(new URL('.', import.meta.url).pathname, '../../..');
}

/**
 * Typed error class for spawner operations, replacing fragile string matching.
 * API layer uses `code` to determine HTTP status codes.
 */
export class SpawnerError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'ALREADY_RUNNING' | 'SPAWN_IN_PROGRESS' | 'INTERNAL',
  ) {
    super(message);
    this.name = 'SpawnerError';
  }
}

/** Environment variable patterns that should NOT be inherited by child processes. */
const SENSITIVE_ENV_PATTERNS = [
  /^DATABASE_URL$/i,
  /_SECRET$/i,
  /_KEY$/i,
  /_TOKEN$/i,
  /_PASSWORD$/i,
  /^AWS_/i,
  /^OPENAI_/i,
  /^ANTHROPIC_/i,
];

/** Filter out sensitive environment variables from process.env. */
function sanitizeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!SENSITIVE_ENV_PATTERNS.some((re) => re.test(key))) {
      env[key] = value;
    }
  }
  return env;
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
  /** Override the max backoff in ms (for testing). */
  maxBackoffMs?: number;
  /** Override the max restart attempts (for testing). */
  maxRestartAttempts?: number;
}

export class Spawner {
  private registry: Registry;
  private processes = new Map<string, ChildProcess>();
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private hermesRoot: string;
  private logDir: string;
  private healthCheckIntervalMs: number;
  private stopTimeoutMs: number;
  private maxBackoffMs: number;
  private maxRestartAttempts: number;
  private stopped = false;

  /**
   * Per-repo spawn lock. Prevents concurrent spawn attempts for the same repo,
   * guarding against race conditions from:
   * - Double-click on UI start button
   * - Health check + manual restart overlap
   * - startAll + API request overlap at boot
   */
  private spawning = new Set<string>();

  /**
   * Crash-loop backoff state per repo.
   * Tracks consecutive restart attempts and the next eligible restart time.
   */
  private restartState = new Map<string, { attempts: number; nextAllowedAt: number }>();

  constructor(registry: Registry, options: SpawnerOptions = {}) {
    this.registry = registry;
    this.hermesRoot = options.hermesRoot ?? getHermesRoot();
    this.logDir = options.logDir ?? LOG_DIR;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? HEALTH_CHECK_INTERVAL_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
    this.maxRestartAttempts = options.maxRestartAttempts ?? MAX_RESTART_ATTEMPTS;
  }

  /**
   * Spawn a hermes-monitor process for the given repo.
   * Looks up the repo in the registry, spawns the process, stores PID,
   * sets up logging, and monitors for unexpected exits.
   *
   * Uses a per-repo lock to prevent concurrent duplicate spawns.
   */
  async spawnInstance(repoId: string): Promise<RepoEntry> {
    const repo = this.registry.get(repoId);
    if (!repo) {
      throw new SpawnerError(`Repo not found: ${repoId}`, 'NOT_FOUND');
    }

    // Per-repo spawn lock — prevents race conditions
    if (this.spawning.has(repoId)) {
      throw new SpawnerError(`Spawn already in progress for repo ${repoId}`, 'SPAWN_IN_PROGRESS');
    }

    this.spawning.add(repoId);
    try {
      return await this._doSpawn(repoId, repo);
    } finally {
      this.spawning.delete(repoId);
    }
  }

  /**
   * Internal spawn logic. Caller must hold the spawn lock.
   */
  private async _doSpawn(repoId: string, repo: RepoEntry): Promise<RepoEntry> {
    // Don't spawn if already running
    if (this.processes.has(repoId)) {
      const existing = this.processes.get(repoId)!;
      if (existing.exitCode === null && !existing.killed) {
        throw new SpawnerError(`Instance already running for repo ${repoId}`, 'ALREADY_RUNNING');
      }
      // Process exited but wasn't cleaned up — remove stale ref
      this.processes.delete(repoId);
    }

    // Mark as starting — clear stale PID to avoid confusion
    this.registry.updateStatus(repoId, 'starting', null);

    // Ensure log directory exists
    mkdirSync(this.logDir, { recursive: true });

    const logPath = join(this.logDir, `${repoId}.log`);
    const logStream = createWriteStream(logPath, { flags: 'a' });

    // Write startup header
    logStream.write(`\n--- Instance starting at ${new Date().toISOString()} ---\n`);

    const binPath = join(this.hermesRoot, 'bin', 'hermes-monitor.js');

    let child: ChildProcess;
    try {
      child = spawn('node', [
        binPath,
        '--server-port', String(repo.port),
        '--repo', repo.path,
        '--no-browser',
      ], {
        cwd: this.hermesRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: { ...sanitizeEnv(), MARKER_DIR: process.env.MARKER_DIR },
      });
    } catch (err: any) {
      // Synchronous spawn failure — clean up the log stream
      try {
        logStream.write(`\n--- Spawn failed: ${err.message} ---\n`);
        logStream.end();
      } catch {
        // Stream may already be closed — ignore
      }
      this.registry.updateStatus(repoId, 'error', null);
      throw new SpawnerError(`Failed to spawn instance: ${err.message}`, 'INTERNAL');
    }

    // Pipe stdout/stderr to log file
    if (child.stdout) child.stdout.pipe(logStream, { end: false });
    if (child.stderr) child.stderr.pipe(logStream, { end: false });

    this.processes.set(repoId, child);

    // Update registry with PID and running status
    const pid = child.pid ?? null;
    this.registry.updateStatus(repoId, 'running', pid);

    // Clear restart backoff state on successful start
    this.restartState.delete(repoId);

    // Monitor for unexpected exit
    child.on('exit', (code, signal) => {
      this._handleProcessExit(repoId, child, logStream, code, signal);
    });

    child.on('error', (err) => {
      this._handleProcessError(repoId, logStream, err);
    });

    return this.registry.get(repoId)!;
  }

  /**
   * Handle a child process exit event.
   */
  private _handleProcessExit(
    repoId: string,
    child: ChildProcess,
    logStream: WriteStream,
    code: number | null,
    signal: string | null,
  ): void {
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

      // Track restart attempts for backoff
      const state = this.restartState.get(repoId) || { attempts: 0, nextAllowedAt: 0 };
      state.attempts++;
      const backoffMs = Math.min(
        this.healthCheckIntervalMs * Math.pow(2, state.attempts - 1),
        this.maxBackoffMs,
      );
      state.nextAllowedAt = Date.now() + backoffMs;
      this.restartState.set(repoId, state);
    }
  }

  /**
   * Handle a child process error event.
   */
  private _handleProcessError(repoId: string, logStream: WriteStream, err: Error): void {
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
  }

  /**
   * Stop a running instance. Sends SIGTERM, waits up to 5 seconds,
   * then sends SIGKILL if the process hasn't exited.
   */
  async stopInstance(repoId: string): Promise<RepoEntry> {
    const repo = this.registry.get(repoId);
    if (!repo) {
      throw new SpawnerError(`Repo not found: ${repoId}`, 'NOT_FOUND');
    }

    // Clear restart backoff state on explicit stop
    this.restartState.delete(repoId);

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
   * Uses Promise.allSettled for parallel startup — a single failure
   * doesn't block the rest.
   */
  async startAll(): Promise<void> {
    // Reset the stopped flag so the spawner is active again
    this.stopped = false;

    const repos = this.registry.list();
    const startPromises = repos
      .filter((repo) => !(repo.status === 'running' && this.processes.has(repo.id)))
      .map((repo) =>
        this.spawnInstance(repo.id).catch((err: any) => {
          console.error(`[spawner] Failed to start ${repo.name} (${repo.id}): ${err.message}`);
        }),
      );

    await Promise.allSettled(startPromises);
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
   * Start periodic health checks. Auto-restarts crashed instances
   * with exponential backoff to avoid crash loops.
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
   * attempt to restart them with exponential backoff.
   *
   * Respects the per-repo spawn lock — if a spawn is already in progress
   * (from a concurrent API call or previous health check), it skips the repo.
   */
  private runHealthCheck(): void {
    if (this.stopped) return;

    const repos = this.registry.list();
    for (const repo of repos) {
      if (repo.status !== 'error' || this.processes.has(repo.id)) continue;

      // Skip if a spawn is already in progress for this repo
      if (this.spawning.has(repo.id)) continue;

      // Check backoff state
      const state = this.restartState.get(repo.id);
      if (state) {
        // Exceeded max restart attempts — mark as permanently failed
        if (state.attempts >= this.maxRestartAttempts) {
          // Only log once (when attempts == max, not on every check)
          if (state.attempts === this.maxRestartAttempts) {
            console.error(
              `[spawner] ${repo.name} (${repo.id}) exceeded ${this.maxRestartAttempts} restart attempts — giving up`,
            );
            // Bump so we don't log again
            state.attempts++;
            this.restartState.set(repo.id, state);
          }
          continue;
        }

        // Not yet eligible for restart — backoff not expired
        if (Date.now() < state.nextAllowedAt) {
          continue;
        }
      }

      console.log(`[spawner] Health check: restarting crashed instance ${repo.name} (${repo.id})`);
      this.spawnInstance(repo.id).catch((err) => {
        console.error(`[spawner] Health check restart failed for ${repo.name}: ${err.message}`);
      });
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
   * Get the restart backoff state for a repo (for diagnostics/testing).
   */
  getRestartState(repoId: string): { attempts: number; nextAllowedAt: number } | undefined {
    return this.restartState.get(repoId);
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
