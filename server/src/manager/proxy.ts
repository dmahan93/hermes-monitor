/**
 * @module manager/proxy
 * Lightweight manager/proxy server that routes requests to per-repo
 * hermes-monitor instances. Each repo gets a URL prefix (/{repoId}/*)
 * that proxies to the repo's dedicated instance.
 *
 * The manager also exposes its own API under /api/hub/* for the repo
 * registry and a landing page at /.
 */
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

export interface RepoInstance {
  port: number;
  name: string;
  path: string;
}

// ---------------------------------------------------------------------------
// In-memory registry: repoId → instance info
// ---------------------------------------------------------------------------
const registry = new Map<string, RepoInstance>();
const proxyCache = new Map<string, RequestHandler>();

export function registerRepo(repoId: string, instance: RepoInstance): void {
  registry.set(repoId, instance);
  proxyCache.set(
    repoId,
    createProxyMiddleware({
      target: `http://localhost:${instance.port}`,
      changeOrigin: true,
      // Silence proxy errors (target down, etc.) — caller gets 502
      on: {
        error(_err, _req, res) {
          const r = res as Response;
          if (!r.headersSent) {
            r.status(502).json({ error: 'Upstream instance unavailable' });
          }
        },
      },
    }),
  );
}

export function unregisterRepo(repoId: string): boolean {
  proxyCache.delete(repoId);
  return registry.delete(repoId);
}

export function getRepo(repoId: string): RepoInstance | undefined {
  return registry.get(repoId);
}

export function listRepos(): Array<{ repoId: string } & RepoInstance> {
  return Array.from(registry.entries()).map(([repoId, inst]) => ({
    repoId,
    ...inst,
  }));
}

export function clearRegistry(): void {
  registry.clear();
  proxyCache.clear();
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
export function createManagerProxy(): express.Express {
  const app = express();

  // Landing page
  app.get('/', (_req: Request, res: Response) => {
    res.json({ service: 'hermes-monitor-manager', repos: listRepos() });
  });

  // ---- Hub API: repo registry ------------------------------------------
  app.get('/api/hub/repos', (_req: Request, res: Response) => {
    res.json({ repos: listRepos() });
  });

  app.get('/api/hub/repos/:repoId', (req: Request, res: Response) => {
    const repoId = req.params.repoId as string;
    const instance = registry.get(repoId);
    if (!instance) {
      res.status(404).json({ error: `Repo not found: ${repoId}` });
      return;
    }
    res.json({ repoId, ...instance });
  });

  // ---- Proxy: /{repoId}/* → localhost:{port}/* -------------------------
  // Express app.use('/:repoId') strips the matched segment from req.url,
  // so the proxy forwards the remainder directly to the target instance.
  app.use('/:repoId', (req: Request, res: Response, next: NextFunction) => {
    const repoId = req.params.repoId as string;

    // Don't intercept the hub API namespace
    if (repoId === 'api') {
      next();
      return;
    }

    const proxy = proxyCache.get(repoId);
    if (!proxy) {
      next(); // unknown repoId — fall through to 404
      return;
    }

    proxy(req, res, next);
  });

  // ---- 404 fallback ----------------------------------------------------
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
