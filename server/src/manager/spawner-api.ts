/**
 * @module spawner-api
 * REST API for managing hermes-monitor instance lifecycle.
 *
 * Endpoints (mounted under /api):
 *   POST /hub/repos/:id/start   — start an instance
 *   POST /hub/repos/:id/stop    — stop an instance
 *   POST /hub/repos/:id/restart — restart an instance
 */
import { Router, json } from 'express';
import type { Spawner } from './spawner.js';

export function createSpawnerApiRouter(spawner: Spawner): Router {
  const router = Router();
  router.use(json());

  /** POST /hub/repos/:id/start — start a hermes-monitor instance for a repo */
  router.post('/hub/repos/:id/start', async (req, res) => {
    try {
      const entry = await spawner.spawnInstance(req.params.id);
      res.json(entry);
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err.message?.includes('already running')) {
        res.status(409).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err.message || 'Failed to start instance' });
    }
  });

  /** POST /hub/repos/:id/stop — stop a running instance */
  router.post('/hub/repos/:id/stop', async (req, res) => {
    try {
      const entry = await spawner.stopInstance(req.params.id);
      res.json(entry);
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err.message || 'Failed to stop instance' });
    }
  });

  /** POST /hub/repos/:id/restart — restart an instance */
  router.post('/hub/repos/:id/restart', async (req, res) => {
    try {
      const entry = await spawner.restartInstance(req.params.id);
      res.json(entry);
    } catch (err: any) {
      if (err.message?.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err.message || 'Failed to restart instance' });
    }
  });

  return router;
}
