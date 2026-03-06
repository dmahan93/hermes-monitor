import { Router, json } from 'express';
import type { IssueManager } from './issue-manager.js';
import type { PRManager } from './pr-manager.js';
import type { TerminalManager } from './terminal-manager.js';
import type { WorktreeManager } from './worktree-manager.js';
import { config } from './config.js';

interface TicketGuidelines {
  screenshots: string;
}

interface TicketInfoResponse {
  id: string;
  title: string;
  description: string;
  branch: string | undefined;
  worktreePath: string | null;
  repoPath: string;
  targetBranch: string;
  previousReviews: Array<{
    author: string;
    verdict: string | null;
    body: string;
    createdAt: number;
  }>;
  reviewUrl: string;
  guidelines: TicketGuidelines;
}

/**
 * Agent-facing API — these endpoints are called BY the agent during task execution.
 * GET  /ticket/:id/info   — agent gets its task context
 * POST /ticket/:id/review — agent signals it's done, moves issue to review
 */
export function createTicketApiRouter(
  issueManager: IssueManager,
  prManager: PRManager,
  terminalManager: TerminalManager,
  worktreeManager: WorktreeManager,
): Router {
  const router = Router();
  router.use(json());

  // Agent calls this to get task details, worktree path, previous reviews
  router.get('/ticket/:id/info', (req, res) => {
    const issue = issueManager.get(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const worktree = worktreeManager.get(issue.id);
    const existingPr = prManager.getByIssueId(issue.id);
    const previousReviews = existingPr
      ? existingPr.comments.map((c) => ({
          author: c.author,
          verdict: existingPr.verdict,
          body: c.body,
          createdAt: c.createdAt,
        }))
      : [];

    const port = process.env.PORT || '4000';
    const baseUrl = `http://localhost:${port}`;

    const response: TicketInfoResponse = {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      branch: issue.branch,
      worktreePath: worktree?.path || null,
      repoPath: config.repoPath,
      targetBranch: config.targetBranch,
      previousReviews,
      reviewUrl: `${baseUrl}/ticket/${issue.id}/review`,
      guidelines: {
        screenshots: 'If your changes modify UI components (.tsx, .css, .html files), include before/after screenshots in the PR description using markdown image syntax: ![description](url). The PR view renders these inline. Screenshots are required for UI changes and will be checked during review.',
      },
    };
    res.json(response);
  });

  // Agent calls this when done — kills terminal, moves issue to review
  router.post('/ticket/:id/review', (req, res) => {
    const issue = issueManager.get(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    if (issue.status !== 'in_progress') {
      res.status(400).json({ error: `Issue is ${issue.status}, not in_progress` });
      return;
    }

    // Kill the agent's terminal BEFORE moving to review
    if (issue.terminalId) {
      terminalManager.kill(issue.terminalId);
      issue.terminalId = null;
    }

    // Move to review — triggers PR creation + reviewer spawn via handleTransition
    const updated = issueManager.changeStatus(issue.id, 'review');
    if (!updated) {
      res.status(500).json({ error: 'Failed to change status' });
      return;
    }

    res.json({
      ok: true,
      status: 'review',
      message: 'Issue moved to review. PR created and adversarial reviewer spawned.',
    });
  });

  return router;
}
