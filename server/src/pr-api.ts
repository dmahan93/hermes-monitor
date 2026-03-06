import { Router, json } from 'express';
import type { PRManager } from './pr-manager.js';
import { config, updateConfig } from './config.js';

export function createPRApiRouter(prManager: PRManager): Router {
  const router = Router();
  router.use(json());

  // ── Config ──

  router.get('/config', (_req, res) => {
    res.json(config);
  });

  router.patch('/config', (req, res) => {
    const { repoPath, worktreeBase, reviewBase, targetBranch } = req.body || {};
    updateConfig({ repoPath, worktreeBase, reviewBase, targetBranch });
    res.json(config);
  });

  // ── Pull Requests ──

  router.get('/prs', (_req, res) => {
    res.json(prManager.list());
  });

  router.get('/prs/:id', (req, res) => {
    const pr = prManager.get(req.params.id);
    if (!pr) {
      res.status(404).json({ error: 'PR not found' });
      return;
    }
    res.json(pr);
  });

  // Add comment to PR
  router.post('/prs/:id/comments', (req, res) => {
    const { author, body, file, line } = req.body || {};
    if (!body || typeof body !== 'string') {
      res.status(400).json({ error: 'body is required' });
      return;
    }
    const comment = prManager.addComment(
      req.params.id,
      author || 'human',
      body,
      file,
      line
    );
    if (!comment) {
      res.status(404).json({ error: 'PR not found' });
      return;
    }
    res.status(201).json(comment);
  });

  // Set verdict on PR
  router.post('/prs/:id/verdict', (req, res) => {
    const { verdict } = req.body || {};
    if (!verdict || !['approved', 'changes_requested'].includes(verdict)) {
      res.status(400).json({ error: 'verdict must be approved or changes_requested' });
      return;
    }
    const pr = prManager.setVerdict(req.params.id, verdict);
    if (!pr) {
      res.status(404).json({ error: 'PR not found' });
      return;
    }
    res.json(pr);
  });

  // Merge PR
  router.post('/prs/:id/merge', (req, res) => {
    const pr = prManager.merge(req.params.id);
    if (!pr) {
      res.status(404).json({ error: 'PR not found or merge failed' });
      return;
    }
    res.json(pr);
  });

  return router;
}
