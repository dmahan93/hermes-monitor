#!/usr/bin/env node

'use strict';

const { spawn, execSync } = require('child_process');
const { existsSync } = require('fs');
const { resolve, join } = require('path');

// Resolve hermes-monitor root directory (one level up from bin/)
const ROOT = resolve(__dirname, '..');

// ────────────────────────────────────────────────────────────
// Argument parsing
// ────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opts = {
  port: 3000,
  repo: process.cwd(),
  browser: true,
  build: false,
  help: false,
};

function requireArg(flag, i) {
  if (i >= argv.length || argv[i].startsWith('--')) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(1);
  }
  return argv[i];
}

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  switch (arg) {
    case '--port':
    case '-p':
      opts.port = parseInt(requireArg(arg, ++i), 10);
      if (isNaN(opts.port) || opts.port < 1 || opts.port > 65535) {
        console.error('Error: --port must be a valid port number (1-65535)');
        process.exit(1);
      }
      break;
    case '--repo':
    case '-r':
      opts.repo = resolve(requireArg(arg, ++i));
      break;
    case '--no-browser':
      opts.browser = false;
      break;
    case '--build':
      opts.build = true;
      break;
    case '--help':
    case '-h':
      opts.help = true;
      break;
    default:
      console.error(`Unknown option: ${arg}`);
      console.error("Run 'hermes-monitor --help' for usage");
      process.exit(1);
  }
}

if (opts.help) {
  const help = `
hermes-monitor — start the Hermes Monitor dashboard

Usage:
  hermes-monitor [options]

Options:
  --port, -p <port>   Client port (default: 3000)
  --repo, -r <path>   Target git repo (default: current directory)
  --no-browser        Don't auto-open browser
  --build             Serve pre-built client (faster startup, no HMR)
  --help, -h          Show this help

Examples:
  hermes-monitor                          # start in current repo
  hermes-monitor --repo ~/projects/myapp  # explicit repo
  hermes-monitor --port 5000              # custom port
  hermes-monitor --build --no-browser     # production mode, no browser
`;
  console.log(help.trimEnd());
  process.exit(0);
}

// ────────────────────────────────────────────────────────────
// Validate repo path
// ────────────────────────────────────────────────────────────
if (!existsSync(opts.repo)) {
  console.error(`Error: repo path does not exist: ${opts.repo}`);
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
// Environment — server always on :4000, client port configurable
// ────────────────────────────────────────────────────────────
const SERVER_PORT = 4000;
const env = {
  ...process.env,
  HERMES_REPO_PATH: opts.repo,
  PORT: String(SERVER_PORT),
};

// ────────────────────────────────────────────────────────────
// Banner
// ────────────────────────────────────────────────────────────
const mode = opts.build ? 'production' : 'development';
console.log('');
console.log('  hermes-monitor');
console.log('');
console.log(`  repo:    ${opts.repo}`);
console.log(`  client:  http://localhost:${opts.port}`);
console.log(`  server:  http://localhost:${SERVER_PORT}`);
console.log(`  mode:    ${mode}`);
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
  ? ['preview', '--port', String(opts.port)]
  : ['--port', String(opts.port)];

const clientProc = spawn(viteBin, clientArgs, {
  cwd: join(ROOT, 'client'),
  env,
  stdio: 'inherit',
});
children.push(clientProc);

// ────────────────────────────────────────────────────────────
// Auto-open browser after a short delay
// ────────────────────────────────────────────────────────────
if (opts.browser) {
  const url = `http://localhost:${opts.port}`;
  const timer = setTimeout(() => {
    try {
      const { platform } = process;
      if (platform === 'darwin') {
        spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
      } else if (platform === 'win32') {
        spawn('cmd', ['/c', 'start', url], { stdio: 'ignore', detached: true }).unref();
      } else {
        // Linux — try xdg-open, fall back silently
        spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
      }
    } catch {
      // Silently ignore if browser can't be opened
    }
  }, 3000);
  timer.unref();
}

// ────────────────────────────────────────────────────────────
// Graceful shutdown — kill server + client on SIGINT/SIGTERM
// ────────────────────────────────────────────────────────────
let shuttingDown = false;

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
    process.exit(0);
  }, 3000);
  forceTimer.unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Exit when all children have exited
let exitCount = 0;
for (const child of children) {
  child.on('exit', (code) => {
    exitCount++;
    if (exitCount >= children.length) {
      process.exit(code || 0);
    }
  });
}
