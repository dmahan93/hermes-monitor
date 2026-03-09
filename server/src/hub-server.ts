/**
 * @module hub-server
 * Hub manager server — lightweight entry point for multi-repo mode.
 *
 * Responsibilities:
 *   - Registry API at /api/hub/repos (CRUD for registered repos)
 *   - Health check at /api/health
 *   - Landing page listing registered repos
 *   - PID file management (~/.hermes/hub.pid)
 *
 * Each per-repo instance runs its own server+client process on its assigned
 * port. The hub is a coordination point — it tracks repos, assigns ports,
 * and provides a landing page with links to each repo's dashboard.
 *
 * Started by the CLI via: tsx server/src/hub-server.ts
 */
import express from 'express';
import { createServer } from 'http';
import { join } from 'path';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { Registry } from './manager/registry.js';
import { createRegistryApiRouter } from './manager/registry-api.js';

const HUB_PORT = parseInt(process.env.HUB_PORT || '3000', 10);
const HERMES_DIR = join(homedir(), '.hermes');
const PID_FILE = join(HERMES_DIR, 'hub.pid');

/**
 * Client port offset — the Vite dev server (or vite preview) runs on
 * SERVER_PORT + CLIENT_PORT_OFFSET. The canonical value lives in
 * bin/lib/hub.js (exported as CLIENT_PORT_OFFSET). Keep in sync.
 */
const CLIENT_PORT_OFFSET = 1000;

const registry = new Registry();
const app = express();
const server = createServer(app);

// ── JSON body parsing ──
app.use(express.json());

// ── Health check ──
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'hermes-hub' });
});

// ── Registry API (CRUD for repos) ──
app.use('/api', createRegistryApiRouter(registry));

// ── Landing page (HTML) ──
app.get('/', (_req, res) => {
  const repos = registry.list();
  const repoCards = repos.length === 0
    ? '<p class="empty">No repositories registered. Run <code>hermes-monitor</code> in a git repo to add one.</p>'
    : repos.map((r) => {
        const statusClass = r.status === 'running' ? 'running' : 'stopped';
        const statusDot = r.status === 'running' ? '●' : '○';
        const clientPort = r.port + CLIENT_PORT_OFFSET;
        const link = r.status === 'running'
          ? `<a href="http://localhost:${clientPort}" class="repo-link">Open Dashboard →</a>`
          : '<span class="repo-offline">Not running</span>';
        return `
          <div class="repo-card ${statusClass}">
            <div class="repo-header">
              <span class="repo-status">${statusDot}</span>
              <span class="repo-name">${escapeHtml(r.name)}</span>
            </div>
            <div class="repo-path">${escapeHtml(r.path)}</div>
            <div class="repo-footer">
              <span class="repo-port">:${clientPort}</span>
              ${link}
            </div>
          </div>
        `;
      }).join('');

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hermes Monitor Hub</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #0a0a0a; color: #e0e0e0; min-height: 100vh;
      display: flex; flex-direction: column; align-items: center;
      padding: 3rem 1rem;
    }
    h1 { font-size: 1.8rem; color: #00d4ff; margin-bottom: 0.5rem; letter-spacing: 0.1em; }
    .subtitle { color: #666; margin-bottom: 2rem; }
    .repos { display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 600px; }
    .repo-card {
      background: #141414; border: 1px solid #222; border-radius: 8px;
      padding: 1rem 1.25rem; transition: border-color 0.2s;
    }
    .repo-card:hover { border-color: #333; }
    .repo-card.running { border-left: 3px solid #00d4ff; }
    .repo-card.stopped { border-left: 3px solid #444; }
    .repo-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
    .repo-status { font-size: 0.8rem; }
    .running .repo-status { color: #00d4ff; }
    .stopped .repo-status { color: #444; }
    .repo-name { font-weight: 600; font-size: 1.1rem; }
    .repo-path { color: #666; font-size: 0.85rem; font-family: monospace; margin-bottom: 0.6rem; }
    .repo-footer { display: flex; justify-content: space-between; align-items: center; }
    .repo-port { color: #555; font-family: monospace; font-size: 0.85rem; }
    .repo-link {
      color: #00d4ff; text-decoration: none; font-size: 0.9rem;
      padding: 0.3rem 0.8rem; border: 1px solid #00d4ff33; border-radius: 4px;
      transition: background 0.2s;
    }
    .repo-link:hover { background: #00d4ff11; }
    .repo-offline { color: #555; font-size: 0.85rem; }
    .empty { color: #555; text-align: center; padding: 2rem; }
    code { background: #1a1a1a; padding: 0.2rem 0.5rem; border-radius: 3px; color: #00d4ff; }
    .footer { margin-top: 3rem; color: #333; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>⎇ HERMES MONITOR</h1>
  <p class="subtitle">Multi-Repo Hub</p>
  <div class="repos">${repoCards}</div>
  <p class="footer">hermes-monitor hub • ${repos.length} repo${repos.length === 1 ? '' : 's'} registered</p>
</body>
</html>`);
});

// ── 404 fallback ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

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

// ── Helpers ──
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

export { app, server, registry };
