/**
 * @module batch-api
 * Batch operations API for manager efficiency. Enables a manager agent
 * (or the ManagerView UI) to perform bulk operations in a single call
 * instead of making individual API calls for each action.
 */
import { Router, json } from 'express';
import type { PRManager } from './pr-manager.js';
import type { IssueManager } from './issue-manager.js';
import type { TerminalManager } from './terminal-manager.js';
import { enrichPRWithScreenshots } from './screenshot-utils.js';

export function createBatchApiRouter(
  prManager: PRManager,
  issueManager: IssueManager,
  terminalManager: TerminalManager,
): Router {
  const router = Router();
  router.use(json());

  /**
   * POST /batch/merge-approved
   * Merges all PRs with verdict=approved and status!=merged.
   * Handles conflicts by spawning fixers automatically.
   */
  router.post('/merge-approved', (_req, res) => {
    const merged: Array<{ id: string; title: string; status: string }> = [];
    const conflicts: Array<{ id: string; title: string }> = [];
    const errors: Array<{ id: string; title: string; error: string }> = [];

    const approvedPrs = prManager.list().filter(
      (pr) => pr.verdict === 'approved' && pr.status !== 'merged'
    );

    for (const pr of approvedPrs) {
      const result = prManager.merge(pr.id);
      if (result.error) {
        const isConflict = result.error.toLowerCase().includes('conflict');
        if (isConflict) {
          // Spawn a fixer automatically
          prManager.fixConflicts(pr.id);
          conflicts.push({ id: pr.id, title: pr.title });
        } else {
          errors.push({ id: pr.id, title: pr.title, error: result.error });
        }
      } else if (result.pr) {
        // Move the linked issue to done
        issueManager.changeStatus(result.pr.issueId, 'done');
        merged.push({ id: pr.id, title: pr.title, status: result.pr.status });
      }
    }

    res.json({ merged, conflicts, errors });
  });

  /**
   * POST /batch/restart-crashed
   * Restarts all issues with status=todo (crashed agents).
   * Moves them to in_progress which spawns a new agent terminal.
   */
  router.post('/restart-crashed', (_req, res) => {
    const restarted: Array<{ id: string; title: string }> = [];

    const todoIssues = issueManager.list().filter(
      (issue) => issue.status === 'todo'
    );

    for (const issue of todoIssues) {
      try {
        issueManager.changeStatus(issue.id, 'in_progress');
        restarted.push({ id: issue.id, title: issue.title });
      } catch (err: any) {
        // Skip issues that can't be started (shouldn't happen for todo→in_progress)
        console.error(`[batch] Failed to restart issue "${issue.title}":`, err.message);
      }
    }

    res.json({ restarted });
  });

  /**
   * POST /batch/relaunch-reviewers
   * Finds all PRs in 'reviewing' status with no live reviewer terminal.
   * Relaunches their reviews.
   */
  router.post('/relaunch-reviewers', (_req, res) => {
    const relaunched: Array<{ prId: string; title: string }> = [];

    const reviewingPrs = prManager.list().filter(
      (pr) => pr.status === 'reviewing'
    );

    for (const pr of reviewingPrs) {
      // Check if the reviewer terminal is dead (null or not in terminal manager)
      const hasLiveReviewer = pr.reviewerTerminalId !== null &&
        terminalManager.get(pr.reviewerTerminalId) !== undefined;

      if (!hasLiveReviewer) {
        const updated = prManager.relaunchReview(pr.id);
        if (updated) {
          relaunched.push({ prId: pr.id, title: pr.title });
        }
      }
    }

    res.json({ relaunched });
  });

  /**
   * POST /batch/send-back-rejected
   * For all PRs with verdict=changes_requested, moves their linked
   * issue back to in_progress.
   */
  router.post('/send-back-rejected', (_req, res) => {
    const sentBack: Array<{ issueId: string; title: string }> = [];

    const rejectedPrs = prManager.list().filter(
      (pr) => pr.verdict === 'changes_requested'
    );

    for (const pr of rejectedPrs) {
      const issue = issueManager.get(pr.issueId);
      if (!issue) continue;

      // Only move back issues that are currently in review or changes_requested status
      // (don't touch issues that are already in_progress or done)
      if (issue.status === 'review') {
        try {
          issueManager.changeStatus(issue.id, 'in_progress');
          sentBack.push({ issueId: issue.id, title: issue.title });
        } catch (err: any) {
          console.error(`[batch] Failed to send back issue "${issue.title}":`, err.message);
        }
      }
    }

    res.json({ sentBack });
  });

  /**
   * GET /batch/status
   * Returns a comprehensive manager dashboard in one call.
   */
  router.get('/status', (_req, res) => {
    const issues = issueManager.list();
    const prs = prManager.list();

    const done = issues.filter((i) => i.status === 'done').length;
    const active = issues.filter((i) => i.status === 'in_progress').length;

    const inProgress = issues
      .filter((i) => i.status === 'in_progress')
      .map((i) => ({ id: i.id, title: i.title, agent: i.agent }));

    const review = issues
      .filter((i) => i.status === 'review')
      .map((i) => ({ id: i.id, title: i.title }));

    const todo = issues
      .filter((i) => i.status === 'todo')
      .map((i) => ({ id: i.id, title: i.title }));

    const approvedPrs = prs
      .filter((pr) => pr.verdict === 'approved' && pr.status !== 'merged')
      .map((pr) => ({ id: pr.id, title: pr.title, issueId: pr.issueId }));

    const changesRequested = prs
      .filter((pr) => pr.verdict === 'changes_requested')
      .map((pr) => ({ id: pr.id, title: pr.title, issueId: pr.issueId }));

    // Find reviewing PRs with dead reviewer terminals
    const deadReviewers = prs
      .filter((pr) => {
        if (pr.status !== 'reviewing') return false;
        const hasLiveReviewer = pr.reviewerTerminalId !== null &&
          terminalManager.get(pr.reviewerTerminalId) !== undefined;
        return !hasLiveReviewer;
      })
      .map((pr) => ({ id: pr.id, title: pr.title, issueId: pr.issueId }));

    const terminalCount = terminalManager.size;

    res.json({
      done,
      active,
      inProgress,
      review,
      todo,
      approvedPrs,
      changesRequested,
      deadReviewers,
      terminalCount,
    });
  });

  return router;
}
