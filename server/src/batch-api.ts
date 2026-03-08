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
   *
   * Note: PRs are merged sequentially. Each successful merge changes the git
   * state on the target branch, so later PRs may conflict even if they'd merge
   * cleanly individually. Conflict handling (spawning fixers) covers this case.
   */
  router.post('/merge-approved', (_req, res) => {
    const merged: Array<{ id: string; title: string; status: string }> = [];
    const conflicts: Array<{ id: string; title: string }> = [];
    const errors: Array<{ id: string; title: string; error: string }> = [];

    const approvedPrs = prManager.list().filter(
      (pr) => pr.verdict === 'approved' && pr.status !== 'merged'
    );

    for (const pr of approvedPrs) {
      try {
        const result = prManager.merge(pr.id);
        if (result.error) {
          const isConflict = result.error.toLowerCase().includes('conflict');
          if (isConflict) {
            // Spawn a fixer automatically
            try {
              prManager.fixConflicts(pr.id);
            } catch (fixErr: any) {
              console.error(`[batch] Failed to spawn conflict fixer for "${pr.title}":`, fixErr.message);
            }
            conflicts.push({ id: pr.id, title: pr.title });
          } else {
            errors.push({ id: pr.id, title: pr.title, error: result.error });
          }
        } else if (result.pr) {
          // Move the linked issue to done
          try {
            issueManager.changeStatus(result.pr.issueId, 'done');
          } catch (statusErr: any) {
            console.error(`[batch] Merged PR "${pr.title}" but failed to move issue to done:`, statusErr.message);
          }
          merged.push({ id: pr.id, title: pr.title, status: result.pr.status });
        }
      } catch (err: any) {
        errors.push({ id: pr.id, title: pr.title, error: err.message || 'Unknown error' });
      }
    }

    res.json({ merged, conflicts, errors });
  });

  /**
   * POST /batch/restart-crashed
   * Restarts crashed agents — issues in `todo` status that have a non-null
   * `branch`, indicating they were previously started but crashed back to todo.
   * Fresh todo issues (never started, branch=null) are NOT affected.
   * Moves matching issues to `in_progress` which spawns a new agent terminal.
   */
  router.post('/restart-crashed', (_req, res) => {
    const restarted: Array<{ id: string; title: string }> = [];
    const errors: Array<{ id: string; title: string; error: string }> = [];

    const crashedIssues = issueManager.list().filter(
      (issue) => issue.status === 'todo' && issue.branch !== null
    );

    for (const issue of crashedIssues) {
      try {
        issueManager.changeStatus(issue.id, 'in_progress');
        restarted.push({ id: issue.id, title: issue.title });
      } catch (err: any) {
        console.error(`[batch] Failed to restart issue "${issue.title}":`, err.message);
        errors.push({ id: issue.id, title: issue.title, error: err.message });
      }
    }

    res.json({ restarted, errors });
  });

  /**
   * POST /batch/relaunch-reviewers
   * Finds all PRs in 'reviewing' status with no live reviewer terminal.
   * Relaunches their reviews.
   */
  router.post('/relaunch-reviewers', (_req, res) => {
    const relaunched: Array<{ prId: string; title: string }> = [];
    const errors: Array<{ prId: string; title: string; error: string }> = [];

    const reviewingPrs = prManager.list().filter(
      (pr) => pr.status === 'reviewing'
    );

    for (const pr of reviewingPrs) {
      // Check if the reviewer terminal is dead (null or not in terminal manager)
      const hasLiveReviewer = pr.reviewerTerminalId !== null &&
        terminalManager.get(pr.reviewerTerminalId) !== undefined;

      if (!hasLiveReviewer) {
        try {
          const updated = prManager.relaunchReview(pr.id);
          if (updated) {
            relaunched.push({ prId: pr.id, title: pr.title });
          }
        } catch (err: any) {
          console.error(`[batch] Failed to relaunch review for "${pr.title}":`, err.message);
          errors.push({ prId: pr.id, title: pr.title, error: err.message });
        }
      }
    }

    res.json({ relaunched, errors });
  });

  /**
   * POST /batch/send-back-rejected
   * For all PRs with verdict=changes_requested (excluding merged/closed),
   * moves their linked issue back to in_progress and resets the PR to
   * open/pending so it can go through review again.
   */
  router.post('/send-back-rejected', (_req, res) => {
    const sentBack: Array<{ issueId: string; title: string }> = [];

    const rejectedPrs = prManager.list().filter(
      (pr) => pr.verdict === 'changes_requested' && pr.status !== 'merged' && pr.status !== 'closed'
    );

    for (const pr of rejectedPrs) {
      const issue = issueManager.get(pr.issueId);
      if (!issue) continue;

      // Only move back issues that are currently in review
      // (don't touch issues that are already in_progress or done)
      if (issue.status === 'review') {
        try {
          issueManager.changeStatus(issue.id, 'in_progress');
          // Reset PR to open/pending so the dashboard reflects the send-back
          prManager.resetToOpen(pr.id);
          sentBack.push({ issueId: issue.id, title: issue.title });
        } catch (err: any) {
          console.error(`[batch] Failed to send back issue "${issue.title}":`, err.message);
        }
      }
    }

    res.json({ sentBack });
  });

  /**
   * POST /batch/close-stale-prs
   * Closes all PRs that are open/approved but whose linked issue is already done.
   * These are orphaned PRs from manual merges or deleted issues.
   */
  router.post('/close-stale-prs', (_req, res) => {
    const closed: Array<{ id: string; title: string }> = [];
    const errors: Array<{ id: string; title: string; error: string }> = [];

    const openPrs = prManager.list().filter(
      (pr) => pr.status !== 'merged' && pr.status !== 'closed'
    );

    for (const pr of openPrs) {
      const issue = issueManager.get(pr.issueId);
      // Close if issue is done or doesn't exist anymore (orphaned)
      const isStale = !issue || issue.status === 'done';
      if (!isStale) continue;

      try {
        const result = prManager.close(pr.id);
        if (result) {
          closed.push({ id: pr.id, title: pr.title });
        } else {
          errors.push({ id: pr.id, title: pr.title, error: 'Failed to close' });
        }
      } catch (err: any) {
        errors.push({ id: pr.id, title: pr.title, error: err.message || 'Unknown error' });
      }
    }

    res.json({ closed, errors });
  });

  /**
   * GET /batch/status
   * Returns a comprehensive manager dashboard in one call.
   */
  router.get('/status', (_req, res) => {
    const issues = issueManager.list();
    const prs = prManager.list();

    // Single-pass grouping of issues by status
    const grouped: Record<string, typeof issues> = {};
    for (const issue of issues) {
      (grouped[issue.status] ??= []).push(issue);
    }

    const doneIssues = grouped['done'] ?? [];
    const inProgressIssues = grouped['in_progress'] ?? [];
    const reviewIssues = grouped['review'] ?? [];
    const todoIssues = grouped['todo'] ?? [];

    const done = doneIssues.length;
    const active = inProgressIssues.length;

    const inProgress = inProgressIssues
      .map((i) => ({ id: i.id, title: i.title, agent: i.agent }));

    const review = reviewIssues
      .map((i) => ({ id: i.id, title: i.title }));

    const todo = todoIssues
      .map((i) => ({ id: i.id, title: i.title }));

    const approvedPrs = prs
      .filter((pr) => pr.verdict === 'approved' && pr.status !== 'merged')
      .map((pr) => ({ id: pr.id, title: pr.title, issueId: pr.issueId }));

    const changesRequested = prs
      .filter((pr) => pr.verdict === 'changes_requested' && pr.status !== 'merged' && pr.status !== 'closed')
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
