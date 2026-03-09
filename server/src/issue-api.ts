/**
 * @module issue-api
 * UI-facing REST API for issue CRUD and status changes.
 * Exposes endpoints to create, list, update, delete, and reorder issues,
 * as well as trigger status transitions (e.g., start, review, done).
 */
import { Router, json } from 'express';
import { execSync } from 'child_process';
import type { IssueManager, IssueStatus } from './issue-manager.js';
import { AGENT_PRESETS, type AgentPreset } from './agents.js';
import { getDiagnostics, readDiagnosticFile } from './diagnostics.js';
import { config } from './config.js';
import { playStatusAlert } from './audible-alerts.js';
import type { ModelInfo } from '@hermes-monitor/shared/types';

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

/** Static list of known reviewer models. Exported for validation + tests. */
export const AVAILABLE_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet', provider: 'anthropic' },
  { id: 'anthropic/claude-opus-4', name: 'Claude Opus', provider: 'anthropic' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'openai/gpt-4.1', name: 'GPT-4.1', provider: 'openai' },
  { id: 'openai/o3', name: 'o3', provider: 'openai' },
  { id: 'nousresearch/hermes-3-llama-3.1-405b', name: 'Hermes 3 405B', provider: 'nousresearch' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', provider: 'deepseek' },
  { id: 'qwen/qwen-3-235b', name: 'Qwen 3 235B', provider: 'qwen' },
];

/** Set of valid reviewer model IDs for fast lookup. */
const VALID_MODEL_IDS = new Set(AVAILABLE_MODELS.map((m) => m.id));

/**
 * Validate a reviewerModel value from a request body.
 * Returns null if valid, or an error message string if invalid.
 */
function validateReviewerModel(reviewerModel: unknown): string | null {
  if (reviewerModel === undefined || reviewerModel === null || reviewerModel === '') return null;
  if (typeof reviewerModel !== 'string') return 'reviewerModel must be a string';
  if (reviewerModel.length > 100) return 'reviewerModel exceeds maximum length (100)';
  if (!VALID_MODEL_IDS.has(reviewerModel)) {
    return `reviewerModel must be one of: ${AVAILABLE_MODELS.map((m) => m.id).join(', ')}`;
  }
  return null;
}

export function createIssueApiRouter(manager: IssueManager): Router {
  const router = Router();
  router.use(json());

  // List available agent presets
  router.get('/agents', (_req, res) => {
    res.json(agentPresetsWithStatus);
  });

  // List available reviewer models
  router.get('/models', (_req, res) => {
    res.json(AVAILABLE_MODELS);
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
    const { title, description, agent, command, branch, parentId, reviewerModel } = req.body || {};
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const modelError = validateReviewerModel(reviewerModel);
    if (modelError) {
      res.status(400).json({ error: modelError });
      return;
    }
    try {
      const issue = manager.create({ title, description, agent, command, branch, parentId, reviewerModel });
      res.status(201).json(issue);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update issue fields
  router.patch('/issues/:id', (req, res) => {
    const { title, description, command, branch, reviewerModel } = req.body || {};
    const modelError = validateReviewerModel(reviewerModel);
    if (modelError) {
      res.status(400).json({ error: modelError });
      return;
    }
    const issue = manager.update(req.params.id, { title, description, command, branch, reviewerModel });
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
      // Capture old status before transition for audible alert
      const existing = manager.get(req.params.id);
      const oldStatus = existing?.status;

      const issue = manager.changeStatus(req.params.id, status);
      if (!issue) {
        res.status(404).json({ error: 'Issue not found' });
        return;
      }

      // Play audible alert if enabled and status actually changed
      if (oldStatus && oldStatus !== status) {
        playStatusAlert(oldStatus, status);
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
    const { title, description, agent, command, branch, reviewerModel } = req.body || {};
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const modelError = validateReviewerModel(reviewerModel);
    if (modelError) {
      res.status(400).json({ error: modelError });
      return;
    }
    try {
      const issue = manager.create({
        title,
        description,
        agent,
        command,
        branch,
        reviewerModel,
        parentId: req.params.id,
      });
      res.status(201).json(issue);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // List diagnostic files for an issue
  router.get('/issues/:id/diagnostics', (req, res) => {
    const issue = manager.get(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const entries = getDiagnostics(issue.id, config.diagnosticsBase);
    res.json({
      issueId: issue.id,
      diagnostics: entries.map((e) => ({
        exitCode: e.exitCode,
        logFile: e.logFile,
        timestamp: e.timestamp,
        content: readDiagnosticFile(e.logFile),
      })),
    });
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
