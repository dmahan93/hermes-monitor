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
const { existsSync, readFileSync, unlinkSync, mkdirSync } = require('fs');
const { join, resolve } = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

const HERMES_DIR = join(os.homedir(), '.hermes');
const PID_FILE = join(HERMES_DIR, 'hub.pid');
const HUB_PORT = 3000;
const HUB_BASE = `http://localhost:${HUB_PORT}`;

// Resolve hermes-monitor root directory (two levels up from bin/lib/)
const ROOT = resolve(__dirname, '..', '..');

// ────────────────────────────────────────────────────────────
// Hub process management
// ────────────────────────────────────────────────────────────

/**
 * Check if the hub process is alive by reading the PID file
 * and sending signal 0.
 * @returns {number|null} PID if alive, null otherwise
 */
function getHubPid() {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, 'utf8').trim();
  const pid = parseInt(raw, 10);
  if (isNaN(pid)) return null;
  try {
    process.kill(pid, 0); // check if process exists
    return pid;
  } catch {
    // Stale PID file — clean up
    try { unlinkSync(PID_FILE); } catch { /* ignore */ }
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
  const tsxBin = join(ROOT, 'node_modules', '.bin', 'tsx');
  const hubScript = join(ROOT, 'server', 'src', 'hub-server.ts');

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
  const out = require('fs').openSync(logFile, 'a');
  const err = require('fs').openSync(logFile, 'a');

  const child = spawn(tsxBin, [hubScript], {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ['ignore', out, err],
  });

  child.unref();
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
    // Wait briefly for cleanup
    const start = Date.now();
    while (Date.now() - start < 3000) {
      try {
        process.kill(pid, 0);
        // Still alive, wait
        execSync('sleep 0.1', { stdio: 'ignore' });
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
 * @param {number} [port]
 * @returns {Promise<number>} number of repos stopped
 */
async function stopAllRepos(port = HUB_PORT) {
  const repos = await listRepos(port);
  let stopped = 0;

  for (const repo of repos) {
    if (repo.pid && (repo.status === 'running' || repo.status === 'starting')) {
      try {
        process.kill(repo.pid, 'SIGTERM');
        stopped++;
      } catch {
        // Process already gone
      }
    }
  }

  return stopped;
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
  const { status, data } = await hubRequest('DELETE', `/api/hub/repos/${id}`, null, port);
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
  const { status: httpStatus, data } = await hubRequest('PATCH', `/api/hub/repos/${id}`, body, port);
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
  HUB_PORT,
  HUB_BASE,
  getHubPid,
  isHubRunning,
  isHubReachable,
  waitForHub,
  startHub,
  stopHub,
  stopAllRepos,
  registerRepo,
  unregisterRepo,
  updateRepoStatus,
  listRepos,
  openBrowser,
};
