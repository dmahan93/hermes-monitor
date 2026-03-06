import { Router, json } from 'express';
import type { TerminalManager } from './terminal-manager.js';

export function createApiRouter(manager: TerminalManager): Router {
  const router = Router();
  router.use(json());

  // List all terminals
  router.get('/terminals', (_req, res) => {
    res.json(manager.list());
  });

  // Create a new terminal
  router.post('/terminals', (req, res) => {
    const { title, command, cwd, cols, rows } = req.body || {};
    const terminal = manager.create({ title, command, cwd, cols, rows });
    res.status(201).json(terminal);
  });

  // Delete a terminal
  router.delete('/terminals/:id', (req, res) => {
    const killed = manager.kill(req.params.id);
    if (!killed) {
      res.status(404).json({ error: 'Terminal not found' });
      return;
    }
    res.json({ ok: true });
  });

  // Resize a terminal
  router.post('/terminals/:id/resize', (req, res) => {
    const { cols, rows } = req.body || {};
    if (typeof cols !== 'number' || typeof rows !== 'number' || cols < 1 || rows < 1) {
      res.status(400).json({ error: 'cols and rows must be positive numbers' });
      return;
    }
    const resized = manager.resize(req.params.id, cols, rows);
    if (!resized) {
      res.status(404).json({ error: 'Terminal not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
