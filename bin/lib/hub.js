'use strict';

/**
 * Hub management utilities for the multi-repo hub mode.
 *
 * Provides functions to:
 *   - Check if the hub is running
 *   - Start/stop the hub manager process
 *   - Register/unregister repos with the hub
 *   - List registered repos
 *   - Open the browser
 */

const http = require('http');
const { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, closeSync, readdirSync } = require('fs');
const { join, resolve } = require('path');
const { spawn } = require('child_process');
const os = require('os');

const sharedConstants = require('../../shared/constants.json');

const HERMES_DIR = join(os.homedir(), '.hermes');
const PID_FILE = join(HERMES_DIR, 'hub.pid');
const LOCK_FILE = join(HERMES_DIR, 'hub.lock');
const REPO_PIDS_DIR = join(HERMES_DIR, 'repo-pids');
const HUB_PORT = parseInt(process.env.HUB_PORT || String(sharedConstants.DEFAULT_HUB_PORT), 10);
const HUB_BASE = `http://localhost:${HUB_PORT}`;

/**
 * Client port offset — the Vite dev server (or vite preview) runs on
 * SERVER_PORT + CLIENT_PORT_OFFSET.
 * Single source of truth: shared/constants.json
 */
const CLIENT_PORT_OFFSET = sharedConstants.CLIENT_PORT_OFFSET;

// Resolve hermes-monitor root directory (two levels up from bin/lib/)
const ROOT = resolve(__dirname, '..', '..');

// ────────────────────────────────────────────────────────────
// Hub process management
// ────────────────────────────────────────────────────────────

/**
 * Check if the hub process is alive by reading the PID file
 * and sending signal 0.
 * @param {string} [pidFile] - Override PID file path (for testing). Defaults to ~/.hermes/hub.pid.
 * @returns {number|null} PID if alive, null otherwise
 */
function getHubPid(pidFile = PID_FILE) {
  if (!existsSync(pidFile)) return null;
  const raw = readFileSync(pidFile, 'utf8').trim();
  const pid = parseInt(raw, 10);
  if (isNaN(pid)) return null;
  try {
    process.kill(pid, 0); // check if process exists
    return pid;
  } catch {
    // Stale PID file — clean up
    try { unlinkSync(pidFile); } catch { /* ignore */ }
    return null;
  }
}

/**
 * Check if the hub is running (PID alive).
 * @returns {boolean}
 */
function isHubRunning() {
  return getHubPid() !== null;
}

/**
 * Check if the hub HTTP server is reachable.
 * @param {number} [port]
 * @returns {Promise<boolean>}
 */
function isHubReachable(port = HUB_PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

/**
 * Wait for the hub to become reachable (HTTP health check).
 * @param {number} [port]
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
async function waitForHub(port = HUB_PORT, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isHubReachable(port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * Start the hub manager process.
 * @param {{ foreground?: boolean, port?: number }} [opts]
 * @returns {import('child_process').ChildProcess|null} child process in foreground mode, null in background
 */
function startHub({ foreground = false, port = HUB_PORT } = {}) {
  // Acquire startup lock to prevent concurrent hub starts (TOCTOU race)
  mkdirSync(HERMES_DIR, { recursive: true });
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Lock file exists — check if the locking process is still alive
      try {
        const lockPid = parseInt(readFileSync(LOCK_FILE, 'utf8').trim(), 10);
        if (!isNaN(lockPid)) {
          try {
            process.kill(lockPid, 0);
            // Process is alive — another CLI is starting the hub
            console.error('Another hermes-monitor instance is starting the hub. Waiting...');
            return null;
          } catch {
            // Stale lock — remove and retry
          }
        }
      } catch { /* can't read lock, remove it */ }
      try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
      // Retry lock acquisition — another process may grab it between
      // our unlink and this write (TOCTOU). If so, fall through to wait.
      try {
        writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      } catch (retryErr) {
        if (retryErr.code === 'EEXIST') {
          console.error('Another hermes-monitor instance is starting the hub. Waiting...');
          return null;
        }
        throw retryErr;
      }
    } else {
      throw err;
    }
  }

  // Clean up lock on exit
  const cleanupLock = () => { try { unlinkSync(LOCK_FILE); } catch { /* ignore */ } };
  process.on('exit', cleanupLock);

  const tsxBin = join(ROOT, 'node_modules', '.bin', 'tsx');
  const hubScript = join(ROOT, 'server', 'src', 'hub-start.ts');

  if (!existsSync(tsxBin)) {
    console.error('Error: tsx not found. Run npm install in', ROOT);
    process.exit(1);
  }

  const env = {
    ...process.env,
    HUB_PORT: String(port),
  };

  if (foreground) {
    // Run in foreground — inherits stdio
    const child = spawn(tsxBin, [hubScript], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    });
    return child;
  }

  // Run in background — detached, stdio to /dev/null
  const logFile = join(HERMES_DIR, 'hub.log');
  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');

  const child = spawn(tsxBin, [hubScript], {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ['ignore', out, err],
  });

  child.on('error', (spawnErr) => {
    console.error('Failed to start hub process:', spawnErr.message);
  });

  child.unref();

  // Close parent's copies of the file descriptors — the child inherits its own
  closeSync(out);
  closeSync(err);

  return null;
}

/**
 * Stop the hub manager process.
 * @returns {boolean} true if the hub was stopped, false if it wasn't running
 */
function stopHub() {
  const pid = getHubPid();
  if (!pid) return false;

  try {
    process.kill(pid, 'SIGTERM');
    // Wait briefly for cleanup using synchronous sleep.
    // Atomics.wait blocks the thread for `ms` milliseconds without spawning a
    // subprocess (unlike execSync('sleep ...')). This is necessary because
    // stopHub() is synchronous (used in signal handlers and sequentially with
    // other stop operations).
    const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const start = Date.now();
    while (Date.now() - start < 3000) {
      try {
        process.kill(pid, 0);
        // Still alive, wait
        sleepMs(100);
      } catch {
        // Process is gone
        break;
      }
    }
    // Force kill if still alive
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch { /* already dead */ }
  } catch {
    // Process didn't exist
  }

  // Clean up PID file
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  return true;
}

/**
 * Stop all running repo instances by querying the registry and killing their PIDs.
 * Waits up to 3 seconds for each process to exit, then sends SIGKILL.
 * @param {number} [port]
 * @returns {Promise<number>} number of repos stopped
 */
async function stopAllRepos(port = HUB_PORT) {
  const repos = await listRepos(port);
  const toStop = [];

  for (const repo of repos) {
    if (repo.pid && (repo.status === 'running' || repo.status === 'starting')) {
      try {
        process.kill(repo.pid, 'SIGTERM');
        toStop.push(repo);
      } catch {
        // Process already gone — update status
        try { await updateRepoStatus(repo.id, 'stopped', null, port); } catch { /* non-fatal */ }
      }
    }
  }

  // Wait for processes to exit (up to 3 seconds)
  if (toStop.length > 0) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const alive = toStop.filter((r) => {
        try { process.kill(r.pid, 0); return true; } catch { return false; }
      });
      if (alive.length === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // Force kill any stragglers
    for (const repo of toStop) {
      try {
        process.kill(repo.pid, 0); // check alive
        process.kill(repo.pid, 'SIGKILL');
      } catch { /* already dead */ }
    }
    // Update status to 'stopped' for all killed repos
    for (const repo of toStop) {
      try { await updateRepoStatus(repo.id, 'stopped', null, port); } catch { /* non-fatal */ }
    }
  }

  return toStop.length;
}

// ────────────────────────────────────────────────────────────
// Hub API helpers
// ────────────────────────────────────────────────────────────

/**
 * Make an HTTP request to the hub API.
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @param {number} [port]
 * @returns {Promise<{ status: number, data: any }>}
 */
function hubRequest(method, path, body, port = HUB_PORT) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });

    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Register a repo with the hub.
 * Returns the repo entry (handles "already registered" gracefully).
 * @param {string} repoPath - absolute path to the repo
 * @param {number} [port]
 * @returns {Promise<object>} repo entry from the registry
 */
async function registerRepo(repoPath, port = HUB_PORT) {
  const absPath = resolve(repoPath);
  const { status, data } = await hubRequest('POST', '/api/hub/repos', { path: absPath }, port);

  if (status === 201) {
    return data;
  }

  if (status === 409) {
    // Already registered — find by path
    const list = await listRepos(port);
    const existing = list.find((r) => r.path === absPath);
    if (existing) return existing;
    throw new Error(`Repo registered but could not find entry: ${data.error || 'unknown'}`);
  }

  throw new Error(`Failed to register repo: ${data.error || `HTTP ${status}`}`);
}

/**
 * Unregister a repo from the hub.
 * @param {string} id - repo UUID
 * @param {number} [port]
 * @returns {Promise<boolean>}
 */
async function unregisterRepo(id, port = HUB_PORT) {
  const { status, data } = await hubRequest('DELETE', `/api/hub/repos/${encodeURIComponent(id)}`, null, port);
  if (status === 200) return true;
  if (status === 404) {
    console.error(`Repo not found: ${id}`);
    return false;
  }
  if (status === 409) {
    console.error(data.error || 'Cannot unregister a running repo. Stop it first.');
    return false;
  }
  throw new Error(`Failed to unregister repo: ${data.error || `HTTP ${status}`}`);
}

/**
 * Update a repo's status in the registry.
 * @param {string} id - repo UUID
 * @param {string} status - 'stopped' | 'starting' | 'running' | 'error'
 * @param {number|null} [pid]
 * @param {number} [port]
 * @returns {Promise<object|null>}
 */
async function updateRepoStatus(id, status, pid, port = HUB_PORT) {
  const body = { status };
  if (pid !== undefined) body.pid = pid;
  const { status: httpStatus, data } = await hubRequest('PATCH', `/api/hub/repos/${encodeURIComponent(id)}`, body, port);
  if (httpStatus === 200) return data;
  return null;
}

/**
 * List all registered repos.
 * @param {number} [port]
 * @returns {Promise<object[]>}
 */
async function listRepos(port = HUB_PORT) {
  const { status, data } = await hubRequest('GET', '/api/hub/repos', null, port);
  if (status === 200) return Array.isArray(data) ? data : [];
  throw new Error(`Failed to list repos: HTTP ${status}`);
}

// ────────────────────────────────────────────────────────────
// Repo PID file management (fallback for when hub API is unreachable)
// ────────────────────────────────────────────────────────────

/**
 * Write a PID file for a repo instance.
 * Used as a fallback mechanism to kill repo processes when the hub
 * API is unreachable (e.g. during `hermes-monitor stop` when the hub crashed).
 * @param {string} id - repo UUID
 * @param {number} pid - process ID
 */
function writeRepoPid(id, pid) {
  mkdirSync(REPO_PIDS_DIR, { recursive: true });
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  writeFileSync(join(REPO_PIDS_DIR, `${safe}.pid`), String(pid));
}

/**
 * Remove the PID file for a repo instance.
 * @param {string} id - repo UUID
 */
function removeRepoPid(id) {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  try { unlinkSync(join(REPO_PIDS_DIR, `${safe}.pid`)); } catch { /* ignore */ }
}

/**
 * Kill all repo processes using the PID files fallback.
 * Used when the hub API is unreachable (can't query the registry).
 * @returns {number} number of processes killed
 */
function killReposByPidFiles() {
  let killed = 0;
  try {
    const files = readdirSync(REPO_PIDS_DIR);
    for (const file of files) {
      if (!file.endsWith('.pid')) continue;
      try {
        const pid = parseInt(readFileSync(join(REPO_PIDS_DIR, file), 'utf8').trim(), 10);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 'SIGTERM');
            killed++;
          } catch { /* process already gone */ }
        }
        unlinkSync(join(REPO_PIDS_DIR, file));
      } catch { /* ignore individual file errors */ }
    }
  } catch { /* REPO_PIDS_DIR may not exist */ }
  return killed;
}

// ────────────────────────────────────────────────────────────
// Browser helper
// ────────────────────────────────────────────────────────────

/**
 * Open a URL in the default browser.
 * @param {string} url
 */
function openBrowser(url) {
  try {
    const { platform } = process;
    if (platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    // Silently ignore
  }
}

module.exports = {
  HERMES_DIR,
  PID_FILE,
  LOCK_FILE,
  REPO_PIDS_DIR,
  HUB_PORT,
  HUB_BASE,
  CLIENT_PORT_OFFSET,
  getHubPid,
  isHubRunning,
  isHubReachable,
  waitForHub,
  startHub,
  stopHub,
  stopAllRepos,
  hubRequest,
  registerRepo,
  unregisterRepo,
  updateRepoStatus,
  listRepos,
  writeRepoPid,
  removeRepoPid,
  killReposByPidFiles,
  openBrowser,
};
