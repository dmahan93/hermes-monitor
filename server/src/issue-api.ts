import { Router, json } from 'express';
import { execSync } from 'child_process';
import type { IssueManager, IssueStatus } from './issue-manager.js';
import { AGENT_PRESETS, type AgentPreset } from './agents.js';

const VALID_STATUSES: IssueStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];

function checkInstalled(cmd: string): boolean {
  try {
    execSync(`which ${cmd} 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Cache agent install status (check once at startup)
const agentPresetsWithStatus: AgentPreset[] = AGENT_PRESETS.map((p) => {
  if (p.id === 'shell' || p.id === 'custom') return { ...p, installed: true };
  const bin = p.command.split(' ')[0] || p.id;
  return { ...p, installed: checkInstalled(bin) };
});

export function createIssueApiRouter(manager: IssueManager): Router {
  const router = Router();
  router.use(json());

  // List available agent presets
  router.get('/agents', (_req, res) => {
    res.json(agentPresetsWithStatus);
  });

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
    const { title, description, agent, command, branch, parentId } = req.body || {};
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    try {
      const issue = manager.create({ title, description, agent, command, branch, parentId });
      res.status(201).json(issue);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
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
    try {
      const issue = manager.changeStatus(req.params.id, status);
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }
      res.json(issue);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Start planning terminal for a backlog issue
  router.post('/issues/:id/plan', (req, res) => {
    const existing = manager.get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    const issue = manager.startPlanning(req.params.id);
    if (!issue) {
      res.status(400).json({ error: 'Issue is not in backlog status' });
      return;
    }
    res.json(issue);
  });

  // Stop planning terminal for a backlog issue
  router.delete('/issues/:id/plan', (req, res) => {
    const existing = manager.get(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    const issue = manager.stopPlanning(req.params.id);
    if (!issue) {
      res.status(400).json({ error: 'Issue is not in backlog status' });
      return;
    }
    res.json(issue);
  });

  // List subtasks of an issue
  router.get('/issues/:id/subtasks', (req, res) => {
    const parent = manager.get(req.params.id);
    if (!parent) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    res.json(manager.getSubtasks(req.params.id));
  });

  // Create a subtask under an issue
  router.post('/issues/:id/subtasks', (req, res) => {
    const parent = manager.get(req.params.id);
    if (!parent) {
      res.status(404).json({ error: 'Parent issue not found' });
      return;
    }
    const { title, description, agent, command, branch } = req.body || {};
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    try {
      const issue = manager.create({
        title,
        description,
        agent,
        command,
        branch,
        parentId: req.params.id,
      });
      res.status(201).json(issue);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
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
