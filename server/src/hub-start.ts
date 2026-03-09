/**
 * @module hub-start
 * CLI entry point for the hub manager server.
 *
 * Separates server startup from the hub-server module so that importing
 * hub-server.ts for testing doesn't trigger side effects (listening, PID
 * files, signal handlers).
 *
 * Started by the CLI via: tsx server/src/hub-start.ts
 */
import { join } from 'path';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { createHubApp } from './hub-server.js';
import { DEFAULT_HUB_PORT } from './constants.js';

const HUB_PORT = parseInt(process.env.HUB_PORT || String(DEFAULT_HUB_PORT), 10);
const HERMES_DIR = join(homedir(), '.hermes');
const PID_FILE = join(HERMES_DIR, 'hub.pid');

const { server, registry } = createHubApp();

// ── Cleanup on shutdown ──
function shutdown() {
  console.log('\nShutting down Hermes Hub...');
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
  registry.close();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Start ──
server.listen(HUB_PORT, '127.0.0.1', () => {
  // Write PID file only after the port is confirmed bound.
  // This prevents leaving a stale PID file if the port is already in use.
  mkdirSync(HERMES_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
  console.log(`Hermes Hub listening on :${HUB_PORT}`);
  console.log(`PID: ${process.pid}`);
});
