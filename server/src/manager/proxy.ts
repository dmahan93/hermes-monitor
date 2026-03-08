/**
 * @module manager/proxy
 * Lightweight manager/proxy that routes /{repoId}/* requests to per-repo
 * hermes-monitor instances. Exposes /api/hub/* for the repo registry.
 */
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Server, IncomingMessage } from 'http';
import type { Duplex } from 'stream';

export interface RepoInstance {
  port: number;
  name: string;
  path: string;
}

// Validation
const VALID_REPO_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RESERVED_IDS = new Set(['api', 'static', 'health', 'ws']);

// In-memory registry: repoId → instance info
const registry = new Map<string, RepoInstance>();
const proxyCache = new Map<string, ReturnType<typeof createProxyMiddleware>>();

/**
 * Write an HTTP error response to a raw socket during WS upgrade, then destroy.
 * This gives WebSocket clients a proper error instead of a silent disconnection.
 */
function rejectUpgrade(socket: Duplex, statusCode: number, reason: string): void {
  if (socket.writable) {
    const body = JSON.stringify({ error: reason });
    socket.end(
      `HTTP/1.1 ${statusCode} ${reason}\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      `Connection: close\r\n` +
      `\r\n` +
      body,
    );
  } else {
    socket.destroy();
  }
}

function createRepoProxy(port: number) {
  return createProxyMiddleware({
    target: `http://localhost:${port}`,
    changeOrigin: true,
    on: {
      error(_err, _req, res) {
        // res is http.ServerResponse (HTTP) or net.Socket (WebSocket upgrade)
        if ('writeHead' in res && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Upstream instance unavailable' }));
        } else if ('destroy' in res) {
          rejectUpgrade(res as Duplex, 502, 'Upstream instance unavailable');
        }
      },
    },
  });
}

export function registerRepo(repoId: string, instance: RepoInstance): void {
  if (!VALID_REPO_ID.test(repoId)) throw new Error(`Invalid repoId: ${repoId}`);
  if (RESERVED_IDS.has(repoId)) throw new Error(`Reserved repoId: ${repoId}`);
  if (!Number.isInteger(instance.port) || instance.port < 1 || instance.port > 65535) {
    throw new Error(`Invalid port: ${instance.port}`);
  }
  registry.set(repoId, instance);
  proxyCache.set(repoId, createRepoProxy(instance.port));
}

export function unregisterRepo(repoId: string): boolean {
  proxyCache.delete(repoId);
  return registry.delete(repoId);
}

export function getRepo(repoId: string): RepoInstance | undefined {
  return registry.get(repoId);
}

export function listRepos(): Array<{ repoId: string } & RepoInstance> {
  return Array.from(registry.entries()).map(([repoId, inst]) => ({ repoId, ...inst }));
}

/** Public-safe repo list — no internal port/path exposure. */
function listReposPublic(): Array<{ repoId: string; name: string }> {
  return Array.from(registry.entries()).map(([repoId, inst]) => ({ repoId, name: inst.name }));
}

export function clearRegistry(): void {
  registry.clear();
  proxyCache.clear();
}

/**
 * WebSocket upgrade handler — attach to the HTTP server after creation.
 * Parses /{repoId}/... from the URL and delegates to the correct proxy.
 * Sends proper HTTP error responses instead of silently destroying sockets.
 */
export function setupWebSocketProxy(server: Server): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || '';
    const match = url.match(/^\/([^/]+)(\/.*)?$/);
    if (!match) {
      rejectUpgrade(socket, 400, 'Invalid WebSocket path');
      return;
    }
    const repoId = match[1];
    if (RESERVED_IDS.has(repoId)) {
      rejectUpgrade(socket, 400, 'Reserved path');
      return;
    }
    const proxy = proxyCache.get(repoId);
    if (!proxy?.upgrade) {
      rejectUpgrade(socket, 404, 'Repo not found');
      return;
    }
    // Strip /{repoId} prefix so the target sees the original path
    req.url = match[2] || '/';
    proxy.upgrade(req, socket, head);
  });
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
export function createManagerProxy(): express.Express {
  const app = express();

  // Landing page — public-safe info only (no internal ports/paths)
  app.get('/', (_req: Request, res: Response) => {
    res.json({ service: 'hermes-monitor-manager', repos: listReposPublic() });
  });

  // Hub API: repo registry
  app.get('/api/hub/repos', (_req: Request, res: Response) => {
    res.json({ repos: listReposPublic() });
  });

  app.get('/api/hub/repos/:repoId', (req: Request, res: Response) => {
    const repoId = req.params.repoId as string;
    const instance = registry.get(repoId);
    if (!instance) {
      res.status(404).json({ error: `Repo not found: ${repoId}` });
      return;
    }
    res.json({ repoId, name: instance.name });
  });

  // Proxy: /{repoId}/* → localhost:{port}/*
  // Express mount behavior strips the matched prefix from req.url,
  // so the target instance receives the remainder path directly.
  app.use('/:repoId', (req: Request, res: Response, next: NextFunction) => {
    const repoId = req.params.repoId as string;
    if (repoId === 'api') { next(); return; }
    const proxy = proxyCache.get(repoId);
    if (!proxy) { next(); return; }
    proxy(req, res, next);
  });

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
