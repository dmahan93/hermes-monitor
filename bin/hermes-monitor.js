#!/usr/bin/env node

'use strict';

const { spawn, execSync } = require('child_process');
const { existsSync } = require('fs');
const { resolve, join } = require('path');
const http = require('http');
const { parseArgs, ParseError, HELP_TEXT } = require('./lib/parse-args');
const { showVersion, performUpdate, checkForUpdatesInBackground } = require('./lib/updater');
const {
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
  writeRepoPid,
  removeRepoPid,
  killReposByPidFiles,
  openBrowser,
  HUB_PORT,
  CLIENT_PORT_OFFSET,
} = require('./lib/hub');

// Resolve hermes-monitor root directory (one level up from bin/)
const ROOT = resolve(__dirname, '..');

// ────────────────────────────────────────────────────────────
// Argument parsing
// ────────────────────────────────────────────────────────────
let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  if (err instanceof ParseError) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  throw err;
}

if (opts.help) {
  console.log(HELP_TEXT.trimEnd());
  process.exit(0);
}

// ────────────────────────────────────────────────────────────
// Subcommands (version, update) — run and exit
// ────────────────────────────────────────────────────────────
if (opts.command === 'version') {
  showVersion();
  process.exit(0);
}

if (opts.command === 'update') {
  performUpdate();
  process.exit(); // uses process.exitCode if set (e.g., build failure)
}

// ────────────────────────────────────────────────────────────
// Hub management commands — async entry point
// ────────────────────────────────────────────────────────────
async function main() {
  // ── hermes-monitor stop ──
  if (opts.command === 'stop') {
    return await handleStop();
  }

  // ── hermes-monitor hub ──
  if (opts.command === 'hub') {
    return await handleHub();
  }

  // ── hermes-monitor --list ──
  if (opts.list) {
    return await handleList();
  }

  // ── hermes-monitor --add <path> ──
  if (opts.add) {
    return await handleAdd(opts.add);
  }

  // ── hermes-monitor --remove <id> ──
  if (opts.remove) {
    return await handleRemove(opts.remove);
  }

  // ── hermes-monitor (default: start repo in hub mode) ──
  return await handleDefault();
}

// ────────────────────────────────────────────────────────────
// Command handlers
// ────────────────────────────────────────────────────────────

async function handleStop() {
  if (!isHubRunning()) {
    console.log('Hub is not running.');
    process.exit(0);
  }

  console.log('Stopping all repo instances...');
  try {
    const stopped = await stopAllRepos();
    if (stopped > 0) {
      console.log(`  Stopped ${stopped} repo instance(s)`);
    }
  } catch {
    // Hub API unreachable — fall back to PID files on disk
    console.log('  Hub API unreachable, using PID file fallback...');
    const killed = killReposByPidFiles();
    if (killed > 0) {
      console.log(`  Killed ${killed} repo process(es) via PID files`);
    }
  }

  console.log('Stopping hub...');
  const killed = stopHub();
  if (killed) {
    console.log('Hub stopped.');
  } else {
    // isHubRunning() was true above but stopHub() returned false — the hub
    // exited between our check and the kill attempt (race window).
    console.log('Hub exited before it could be stopped.');
  }
  process.exit(0);
}

async function handleHub() {
  if (isHubRunning()) {
    const reachable = await isHubReachable();
    if (reachable) {
      console.log(`Hub is already running on :${HUB_PORT}`);
      if (opts.browser) {
        openBrowser(`http://localhost:${HUB_PORT}`);
      }
      process.exit(0);
    }
    // PID exists but not reachable — stale, restart
    console.log('Hub PID exists but not reachable. Restarting...');
    stopHub();
  }

  if (opts.foreground) {
    console.log(`Starting hub in foreground on :${HUB_PORT}...`);
    const child = startHub({ foreground: true, port: HUB_PORT });
    if (child) {
      child.on('exit', (code) => process.exit(code || 0));
      return; // Don't exit — foreground process keeps running
    }
    // startHub returned null — another instance holds the startup lock.
    // Wait for the hub to come up, then report and exit.
    const ready = await waitForHub(HUB_PORT);
    if (ready) {
      console.log(`Hub is now running on :${HUB_PORT} (started by another instance).`);
      process.exit(0);
    } else {
      console.error('Error: Hub failed to start. Check ~/.hermes/hub.log for details.');
      process.exit(1);
    }
  }

  console.log(`Starting hub on :${HUB_PORT}...`);
  startHub({ foreground: false, port: HUB_PORT });

  const ready = await waitForHub(HUB_PORT);
  if (!ready) {
    console.error('Error: Hub failed to start. Check ~/.hermes/hub.log for details.');
    process.exit(1);
  }

  console.log('Hub started.');
  if (opts.browser) {
    openBrowser(`http://localhost:${HUB_PORT}`);
  }
  process.exit(0);
}

async function handleList() {
  if (!isHubRunning()) {
    console.error('Hub is not running. Start it with: hermes-monitor hub');
    process.exit(1);
  }

  const reachable = await isHubReachable();
  if (!reachable) {
    console.error('Hub is not reachable. Try restarting: hermes-monitor stop && hermes-monitor hub');
    process.exit(1);
  }

  const repos = await listRepos();
  if (repos.length === 0) {
    console.log('No repos registered. Run hermes-monitor in a git repo to add one.');
    process.exit(0);
  }

  console.log('');
  console.log('  Registered repos:');
  console.log('');
  for (const repo of repos) {
    const status = repo.status === 'running' ? '\x1b[32m● running\x1b[0m' :
                   repo.status === 'starting' ? '\x1b[33m◐ starting\x1b[0m' :
                   repo.status === 'error' ? '\x1b[31m✗ error\x1b[0m' :
                   '\x1b[90m○ stopped\x1b[0m';
    const clientPort = repo.status === 'running' ? `  :${repo.port + CLIENT_PORT_OFFSET}` : '';
    console.log(`  ${status}  ${repo.name}${clientPort}`);
    console.log(`           ${repo.path}`);
    console.log(`           id: ${repo.id}`);
    console.log('');
  }
  process.exit(0);
}

async function handleAdd(repoPath) {
  // Validate repo path
  if (!existsSync(repoPath)) {
    console.error(`Error: path does not exist: ${repoPath}`);
    process.exit(1);
  }

  try {
    execSync('git rev-parse --git-dir', { cwd: repoPath, stdio: 'pipe' });
  } catch {
    console.error(`Error: ${repoPath} is not a git repository`);
    process.exit(1);
  }

  // Ensure hub is running
  await ensureHubRunning();

  try {
    const entry = await registerRepo(repoPath);
    console.log(`Registered: ${entry.name} (port: ${entry.port})`);
    console.log(`  path: ${entry.path}`);
    console.log(`  id:   ${entry.id}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

async function handleRemove(id) {
  if (!isHubRunning()) {
    console.error('Hub is not running. Start it with: hermes-monitor hub');
    process.exit(1);
  }

  const reachable = await isHubReachable();
  if (!reachable) {
    console.error('Hub is not reachable. Try restarting: hermes-monitor stop && hermes-monitor hub');
    process.exit(1);
  }

  try {
    const removed = await unregisterRepo(id);
    if (removed) {
      console.log(`Unregistered repo: ${id}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

async function handleDefault() {
  // ── Validate repo path ──
  if (!existsSync(opts.repo)) {
    console.error(`Error: repo path does not exist: ${opts.repo}`);
    process.exit(1);
  }

  try {
    execSync('git rev-parse --git-dir', { cwd: opts.repo, stdio: 'pipe' });
  } catch {
    console.error(`Error: ${opts.repo} is not a git repository`);
    process.exit(1);
  }

  // ── Warn if --port or --server-port were explicitly set (ignored in hub mode) ──
  if (opts._explicit.has('port') || opts._explicit.has('serverPort')) {
    console.error('Warning: --port and --server-port are ignored in hub mode. Ports are auto-assigned by the registry.');
  }

  // ── Ensure hub is running ──
  await ensureHubRunning();

  // ── Register repo with hub ──
  let entry;
  try {
    entry = await registerRepo(opts.repo);
  } catch (err) {
    console.error(`Error registering repo: ${err.message}`);
    process.exit(1);
  }

  // ── Check if repo server is already running or starting ──
  if ((entry.status === 'running' || entry.status === 'starting') && entry.pid) {
    let alive = false;
    try {
      process.kill(entry.pid, 0);
      alive = true;
    } catch {
      // PID is stale
    }
    if (alive) {
      if (entry.status === 'starting') {
        // Another CLI instance is currently starting this repo — wait for it
        console.log(`Repo ${entry.name} is being started by another instance. Waiting...`);
        const MAX_START_WAIT = 30000;
        const startWait = Date.now();
        let ready = false;
        while (Date.now() - startWait < MAX_START_WAIT) {
          const serverUp = await new Promise((res) => {
            const req = http.get(`http://localhost:${entry.port}/api/health`, (resp) => {
              resp.resume();
              res(resp.statusCode >= 200 && resp.statusCode < 500);
            });
            req.on('error', () => res(false));
            req.setTimeout(2000, () => { req.destroy(); res(false); });
          });
          if (serverUp) {
            ready = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        if (ready) {
          const runningClientPort = entry.port + CLIENT_PORT_OFFSET;
          console.log(`Repo ${entry.name} is now running on :${runningClientPort}`);
          if (opts.browser) {
            openBrowser(`http://localhost:${runningClientPort}`);
          }
          process.exit(0);
        }
        // Timed out waiting — kill the stale process before restarting
        console.log('Timed out waiting for repo to start. Killing stale process and restarting...');
        try { process.kill(entry.pid, 'SIGTERM'); } catch { /* ignore */ }
        try { await updateRepoStatus(entry.id, 'stopped', null); } catch { /* non-fatal */ }
      } else {
        // status === 'running' — verify HTTP server is actually responding
        const serverUp = await new Promise((res) => {
          const req = http.get(`http://localhost:${entry.port}/api/health`, (resp) => {
            resp.resume();
            res(resp.statusCode >= 200 && resp.statusCode < 500);
          });
          req.on('error', () => res(false));
          req.setTimeout(2000, () => { req.destroy(); res(false); });
        });

        if (serverUp) {
          const runningClientPort = entry.port + CLIENT_PORT_OFFSET;
          console.log(`Repo ${entry.name} is already running on :${runningClientPort}`);
          if (opts.browser) {
            openBrowser(`http://localhost:${runningClientPort}`);
          }
          process.exit(0);
        }
        // PID alive but server not responding — kill stale process before restart
        console.log(`Repo ${entry.name}: PID alive but server not responding. Killing stale process...`);
        try { process.kill(entry.pid, 'SIGTERM'); } catch { /* ignore */ }
        try { await updateRepoStatus(entry.id, 'stopped', null); } catch { /* non-fatal */ }
      }
    }
  }

  // ── Dependency check ──
  if (!existsSync(join(ROOT, 'node_modules'))) {
    console.log('Dependencies not found. Running npm install...');
    try {
      execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
    } catch {
      console.error('Failed to install dependencies.');
      process.exit(1);
    }
  }

  // ── Build client if --build and dist/ is missing ──
  if (opts.build && !existsSync(join(ROOT, 'client', 'dist', 'index.html'))) {
    console.log('Building client...');
    try {
      execSync('npm run build -w client', { cwd: ROOT, stdio: 'inherit' });
    } catch {
      console.error('Failed to build client.');
      process.exit(1);
    }
  }

  // ── Resolve local binaries ──
  const tsxBin = join(ROOT, 'node_modules', '.bin', 'tsx');
  const viteBin = join(ROOT, 'node_modules', '.bin', 'vite');

  if (!existsSync(tsxBin)) {
    console.error('Error: tsx not found. Run npm install in', ROOT);
    process.exit(1);
  }
  if (!existsSync(viteBin)) {
    console.error('Error: vite not found. Run npm install in', ROOT);
    process.exit(1);
  }

  // ── Use the port assigned by the hub registry ──
  const SERVER_PORT = entry.port;
  const CLIENT_PORT = entry.port + CLIENT_PORT_OFFSET;

  if (CLIENT_PORT > 65535) {
    console.error(`Error: computed client port ${CLIENT_PORT} exceeds 65535 (server port: ${SERVER_PORT}).`);
    console.error('Too many repos registered or port range is fragmented. Try removing unused repos with --remove.');
    process.exit(1);
  }

  const env = {
    ...process.env,
    HERMES_REPO_PATH: opts.repo,
    PORT: String(SERVER_PORT),
    VITE_SERVER_PORT: String(SERVER_PORT),
  };

  // ── Banner ──
  const mode = opts.build ? 'production' : 'development';
  console.log('');
  console.log('  hermes-monitor');
  console.log('');
  console.log(`  repo:    ${opts.repo}`);
  console.log(`  hub:     http://localhost:${HUB_PORT}`);
  console.log(`  client:  http://localhost:${CLIENT_PORT}`);
  console.log(`  server:  http://localhost:${SERVER_PORT}`);
  console.log(`  mode:    ${mode}`);

  // Non-blocking update check (prints inline if updates available)
  checkForUpdatesInBackground();

  console.log('');

  // ── Update status to starting ──
  try {
    await updateRepoStatus(entry.id, 'starting', null);
  } catch { /* non-fatal */ }

  // ── Spawn child processes ──
  const children = [];

  // Server process — tsx (no watch) for build mode, tsx watch for dev
  const serverArgs = opts.build
    ? ['src/index.ts']
    : ['watch', 'src/index.ts'];

  const serverProc = spawn(tsxBin, serverArgs, {
    cwd: join(ROOT, 'server'),
    env,
    stdio: 'inherit',
  });
  children.push(serverProc);

  // Client process — vite dev or vite preview
  const clientArgs = opts.build
    ? ['preview', '--port', String(CLIENT_PORT)]
    : ['--port', String(CLIENT_PORT)];

  const clientProc = spawn(viteBin, clientArgs, {
    cwd: join(ROOT, 'client'),
    env,
    stdio: 'inherit',
  });
  children.push(clientProc);

  // ── Poll for readiness, then update status and optionally open browser ──
  let shuttingDown = false;
  let worstExitCode = 0;
  let statusUpdated = false;

  {
    const url = `http://localhost:${CLIENT_PORT}`;
    const MAX_WAIT = 30000;
    const POLL_INTERVAL = 500;
    const startTime = Date.now();

    function checkServerReady() {
      return new Promise((resolve) => {
        const req = http.get(`http://localhost:${SERVER_PORT}/api/health`, (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
      });
    }

    function checkClientReady() {
      return new Promise((resolve) => {
        const req = http.get(`http://localhost:${CLIENT_PORT}/`, (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 500);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
      });
    }

    async function pollReady() {
      if (shuttingDown) return;
      if (Date.now() - startTime > MAX_WAIT) return;

      const [serverReady, clientReady] = await Promise.all([
        checkServerReady(),
        checkClientReady(),
      ]);

      if (serverReady && clientReady) {
        // Update status to 'running' only after health check confirms readiness
        if (!statusUpdated) {
          statusUpdated = true;
          try {
            await updateRepoStatus(entry.id, 'running', process.pid);
          } catch { /* non-fatal */ }
          // Write PID file as fallback for `hermes-monitor stop` when hub is unreachable
          writeRepoPid(entry.id, process.pid);
        }
        if (opts.browser) {
          openBrowser(url);
        }
      } else {
        const t = setTimeout(pollReady, POLL_INTERVAL);
        t.unref();
      }
    }

    const initialTimer = setTimeout(pollReady, 1000);
    initialTimer.unref();
  }

  // ── Graceful shutdown ──
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down hermes-monitor...');

    // Update hub status — use 'error' if a child exited with non-zero code
    const exitStatus = worstExitCode !== 0 ? 'error' : 'stopped';
    try {
      await updateRepoStatus(entry.id, exitStatus, null);
    } catch { /* non-fatal */ }

    // Clean up repo PID file
    removeRepoPid(entry.id);

    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }

    const forceTimer = setTimeout(() => {
      for (const child of children) {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }
      process.exit(worstExitCode);
    }, 3000);
    forceTimer.unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Track child exits
  let exitCount = 0;
  for (const child of children) {
    child.on('exit', (code) => {
      exitCount++;

      if (code != null && code !== 0 && worstExitCode === 0) {
        worstExitCode = code;
      }

      if (!shuttingDown) {
        shutdown();
        return;
      }

      if (exitCount >= children.length) {
        process.exit(worstExitCode);
      }
    });
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Ensure the hub manager is running. Starts it if needed.
 */
async function ensureHubRunning() {
  if (isHubRunning()) {
    const reachable = await isHubReachable();
    if (reachable) return;
    // Stale hub — restart
    console.log('Hub PID exists but not reachable. Restarting...');
    stopHub();
  }

  console.log('Starting hub...');
  startHub({ foreground: false, port: HUB_PORT });

  const ready = await waitForHub(HUB_PORT);
  if (!ready) {
    console.error('Error: Hub failed to start. Check ~/.hermes/hub.log for details.');
    process.exit(1);
  }
  console.log('Hub started on :' + HUB_PORT);
}

// ── Entry point ──
main().catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
