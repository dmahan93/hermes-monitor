/**
 * @module registry-api
 * REST API for the repo registry. Provides CRUD endpoints for managing
 * registered repos at /api/hub/repos.
 *
 * Endpoints:
 *   GET    /hub/repos      — list all repos with status
 *   POST   /hub/repos      — register { path, name? }
 *   GET    /hub/repos/:id  — get repo details
 *   DELETE /hub/repos/:id  — unregister
 */
import { Router, json } from 'express';
import type { Registry } from './registry.js';

export function createRegistryApiRouter(registry: Registry): Router {
  const router = Router();
  router.use(json());

  /** GET /hub/repos — list all registered repos */
  router.get('/hub/repos', (_req, res) => {
    const repos = registry.list();
    res.json(repos);
  });

  /** POST /hub/repos — register a new repo */
  router.post('/hub/repos', (req, res) => {
    const { path, name } = req.body || {};

    const trimmedPath = typeof path === 'string' ? path.trim() : '';
    if (!trimmedPath) {
      res.status(400).json({ error: 'path is required and must be a non-empty string' });
      return;
    }

    if (!trimmedPath.startsWith('/')) {
      res.status(400).json({ error: 'path must be absolute' });
      return;
    }

    try {
      const entry = registry.register(trimmedPath, name?.trim() || undefined);
      res.status(201).json(entry);
    } catch (err: any) {
      // Duplicate path → 409 Conflict
      if (err.message?.includes('already registered')) {
        res.status(409).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err.message || 'Failed to register repo' });
    }
  });

  /** GET /hub/repos/:id — get a single repo */
  router.get('/hub/repos/:id', (req, res) => {
    const entry = registry.get(req.params.id);
    if (!entry) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    res.json(entry);
  });

  /** DELETE /hub/repos/:id — unregister a repo */
  router.delete('/hub/repos/:id', (req, res) => {
    const removed = registry.unregister(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
