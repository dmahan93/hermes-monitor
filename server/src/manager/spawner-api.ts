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
import { type Spawner, SpawnerError } from './spawner.js';

/** Map SpawnerError codes to HTTP status codes. */
const ERROR_STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_RUNNING: 409,
  SPAWN_IN_PROGRESS: 409,
  INTERNAL: 500,
};

/** Classify an error and send the appropriate HTTP response. */
function sendError(res: any, err: any): void {
  if (err instanceof SpawnerError) {
    const status = ERROR_STATUS_MAP[err.code] || 500;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  res.status(500).json({ error: err.message || 'Internal error' });
}

export function createSpawnerApiRouter(spawner: Spawner): Router {
  const router = Router();
  router.use(json());

  /** POST /hub/repos/:id/start — start a hermes-monitor instance for a repo */
  router.post('/hub/repos/:id/start', async (req, res) => {
    try {
      const entry = await spawner.spawnInstance(req.params.id);
      res.json(entry);
    } catch (err: any) {
      sendError(res, err);
    }
  });

  /** POST /hub/repos/:id/stop — stop a running instance */
  router.post('/hub/repos/:id/stop', async (req, res) => {
    try {
      const entry = await spawner.stopInstance(req.params.id);
      res.json(entry);
    } catch (err: any) {
      sendError(res, err);
    }
  });

  /** POST /hub/repos/:id/restart — restart an instance */
  router.post('/hub/repos/:id/restart', async (req, res) => {
    try {
      const entry = await spawner.restartInstance(req.params.id);
      res.json(entry);
    } catch (err: any) {
      sendError(res, err);
    }
  });

  return router;
}
