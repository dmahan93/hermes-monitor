import { Router, json } from 'express';
import type { IssueManager, IssueStatus } from './issue-manager.js';

const VALID_STATUSES: IssueStatus[] = ['todo', 'in_progress', 'review', 'done'];

export function createIssueApiRouter(manager: IssueManager): Router {
  const router = Router();
  router.use(json());

  // List all issues
  router.get('/issues', (_req, res) => {
    res.json(manager.list());
  });

  // Get single issue
  router.get('/issues/:id', (req, res) => {
    const issue = manager.get(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    res.json(issue);
  });

  // Create issue
  router.post('/issues', (req, res) => {
    const { title, description, command, branch } = req.body || {};
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const issue = manager.create({ title, description, command, branch });
    res.status(201).json(issue);
  });

  // Update issue fields
  router.patch('/issues/:id', (req, res) => {
    const { title, description, command, branch } = req.body || {};
    const issue = manager.update(req.params.id, { title, description, command, branch });
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    res.json(issue);
  });

  // Change issue status (this triggers terminal spawn/kill)
  router.patch('/issues/:id/status', (req, res) => {
    const { status } = req.body || {};
    if (!status || !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }
    const issue = manager.changeStatus(req.params.id, status);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    res.json(issue);
  });

  // Delete issue
  router.delete('/issues/:id', (req, res) => {
    const deleted = manager.delete(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
