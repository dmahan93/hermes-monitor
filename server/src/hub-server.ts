/**
 * @module hub-server
 * Hub manager server — lightweight entry point for multi-repo mode.
 *
 * Responsibilities:
 *   - Registry API at /api/hub/repos (CRUD for registered repos)
 *   - Health check at /api/health
 *   - Landing page listing registered repos
 *
 * Each per-repo instance runs its own server+client process on its assigned
 * port. The hub is a coordination point — it tracks repos, assigns ports,
 * and provides a landing page with links to each repo's dashboard.
 *
 * This module exports a factory function `createHubApp()` so the app can be
 * tested without side effects. The CLI entry point is hub-start.ts.
 */
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { readdir, stat, access } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';
import { Registry } from './manager/registry.js';
import { createRegistryApiRouter } from './manager/registry-api.js';
import { CLIENT_PORT_OFFSET } from './constants.js';

// ── Types ──
interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

/** Maximum number of entries returned by the browse API */
const BROWSE_ENTRY_LIMIT = 200;

// ── Helpers ──
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/**
 * Create the hub Express app, HTTP server, and registry.
 * Does NOT start listening — call server.listen() yourself.
 */
export function createHubApp(dbPath?: string): {
  app: express.Express;
  server: Server;
  registry: Registry;
} {
  const registry = new Registry(dbPath);
  const app = express();
  const server = createServer(app);

  // ── JSON body parsing ──
  app.use(express.json());

  // ── Health check ──
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'hermes-hub' });
  });

  // ── Directory browse API ──
  // NOTE: The hub binds to 127.0.0.1, so filesystem browsing is local-user-only,
  // equivalent to the user running `ls` themselves.
  app.get('/api/hub/browse', async (req, res) => {
    const rawPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    const browsePath = rawPath || homedir();
    const resolved = resolve(browsePath);

    // Validate path exists and is a directory
    try {
      const st = await stat(resolved);
      if (!st.isDirectory()) {
        res.status(400).json({ error: 'Path is not a directory' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Path does not exist or is not accessible' });
      return;
    }

    // Read directory entries, filtering to subdirectories only
    const entries: DirEntry[] = [];
    try {
      const items = await readdir(resolved, { withFileTypes: true });
      for (const item of items) {
        // Skip hidden directories (starting with .)
        if (item.name.startsWith('.')) continue;
        try {
          const fullPath = join(resolved, item.name);
          // Follow symlinks: if the dirent says directory OR if it's a symlink
          // that resolves to a directory
          let isDir = item.isDirectory();
          if (!isDir && item.isSymbolicLink()) {
            try {
              isDir = (await stat(fullPath)).isDirectory();
            } catch {
              // Broken symlink — skip
              continue;
            }
          }
          if (!isDir) continue;
          let isGitRepo = false;
          try { await access(join(fullPath, '.git')); isGitRepo = true; } catch { /* not a git repo */ }
          entries.push({ name: item.name, path: fullPath, isGitRepo });
        } catch {
          // Permission denied on individual entry — skip
        }
      }
    } catch {
      res.status(403).json({ error: 'Cannot read directory' });
      return;
    }

    // Sort: git repos first, then alphabetically
    entries.sort((a, b) => {
      if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    // Cap results to avoid huge payloads on directories with thousands of subdirectories
    const truncated = entries.length > BROWSE_ENTRY_LIMIT;
    const limitedEntries = truncated ? entries.slice(0, BROWSE_ENTRY_LIMIT) : entries;

    const parent = resolved === '/' ? null : dirname(resolved);
    res.json({
      path: resolved,
      parent,
      entries: limitedEntries,
      ...(truncated ? { truncated: true, totalEntries: entries.length } : {}),
    });
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
          const repoUrl = `http://localhost:${clientPort}/${encodeURIComponent(r.id)}`;
          const link = r.status === 'running'
            ? `<a href="${repoUrl}" class="repo-link">Open Dashboard →</a>`
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
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return { app, server, registry };
}
