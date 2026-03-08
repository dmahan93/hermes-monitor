#!/usr/bin/env node

'use strict';

const { spawn, execSync } = require('child_process');
const { existsSync } = require('fs');
const { resolve, join } = require('path');
const http = require('http');
const { parseArgs, ParseError, HELP_TEXT } = require('./lib/parse-args');
const { showVersion, performUpdate, checkForUpdatesInBackground } = require('./lib/updater');

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
  process.exit(0);
}

// ────────────────────────────────────────────────────────────
// Validate repo path
// ────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────
// Dependency check
// ────────────────────────────────────────────────────────────
if (!existsSync(join(ROOT, 'node_modules'))) {
  console.log('Dependencies not found. Running npm install...');
  try {
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error('Failed to install dependencies.');
    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────
// Build client if --build and dist/ is missing
// ────────────────────────────────────────────────────────────
if (opts.build && !existsSync(join(ROOT, 'client', 'dist', 'index.html'))) {
  console.log('Building client...');
  try {
    execSync('npm run build -w client', { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error('Failed to build client.');
    process.exit(1);
  }
}

// ────────────────────────────────────────────────────────────
// Resolve local binaries
// ────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────
// Environment
// ────────────────────────────────────────────────────────────
const SERVER_PORT = opts.serverPort;
const CLIENT_PORT = opts.port;
const env = {
  ...process.env,
  HERMES_REPO_PATH: opts.repo,
  PORT: String(SERVER_PORT),
  VITE_SERVER_PORT: String(SERVER_PORT),
};

// ────────────────────────────────────────────────────────────
// Banner
// ────────────────────────────────────────────────────────────
const mode = opts.build ? 'production' : 'development';
console.log('');
console.log('  hermes-monitor');
console.log('');
console.log(`  repo:    ${opts.repo}`);
console.log(`  client:  http://localhost:${CLIENT_PORT}`);
console.log(`  server:  http://localhost:${SERVER_PORT}`);
console.log(`  mode:    ${mode}`);

// Non-blocking update check (prints inline if updates available)
checkForUpdatesInBackground();

console.log('');

// ────────────────────────────────────────────────────────────
// Spawn child processes
// ────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────
// Graceful shutdown — kill server + client on SIGINT/SIGTERM
// ────────────────────────────────────────────────────────────
let shuttingDown = false;
let worstExitCode = 0;

// ────────────────────────────────────────────────────────────
// Auto-open browser when both server and client are ready
// ────────────────────────────────────────────────────────────
if (opts.browser) {
  const url = `http://localhost:${CLIENT_PORT}`;
  const MAX_WAIT = 30000; // 30s max
  const POLL_INTERVAL = 500; // check every 500ms
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
    if (Date.now() - startTime > MAX_WAIT) return; // give up silently

    // Check both server and client ports are responding
    const [serverReady, clientReady] = await Promise.all([
      checkServerReady(),
      checkClientReady(),
    ]);

    if (serverReady && clientReady) {
      openBrowser(url);
    } else {
      const t = setTimeout(pollReady, POLL_INTERVAL);
      t.unref();
    }
  }

  function openBrowser(targetUrl) {
    try {
      const { platform } = process;
      if (platform === 'darwin') {
        spawn('open', [targetUrl], { stdio: 'ignore', detached: true }).unref();
      } else if (platform === 'win32') {
        spawn('cmd', ['/c', 'start', targetUrl], { stdio: 'ignore', detached: true }).unref();
      } else {
        // Linux — try xdg-open, fall back silently
        spawn('xdg-open', [targetUrl], { stdio: 'ignore', detached: true }).unref();
      }
    } catch {
      // Silently ignore if browser can't be opened
    }
  }

  // Start polling after a brief initial delay for processes to begin starting
  const initialTimer = setTimeout(pollReady, 1000);
  initialTimer.unref();
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down hermes-monitor...');

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  // Force-kill after 3 seconds if processes haven't exited
  const forceTimer = setTimeout(() => {
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already dead
      }
    }
    process.exit(worstExitCode);
  }, 3000);
  forceTimer.unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Track child exits — if one crashes unexpectedly, shut down the other
let exitCount = 0;
for (const child of children) {
  child.on('exit', (code, signal) => {
    exitCount++;

    // Track the worst (first non-zero) exit code
    if (code != null && code !== 0 && worstExitCode === 0) {
      worstExitCode = code;
    }

    // If a child exits unexpectedly (not during shutdown), tear down everything.
    // This handles both crashes (code !== 0) and clean exits (code === 0)
    // to prevent orphaned processes.
    if (!shuttingDown) {
      shutdown();
      return;
    }

    // All children done — exit with the worst code
    if (exitCount >= children.length) {
      process.exit(worstExitCode);
    }
  });
}
