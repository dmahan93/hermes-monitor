import { Router, json } from 'express';
import { readdirSync } from 'fs';
import { join, extname } from 'path';
import type { PRManager } from './pr-manager.js';
import type { IssueManager } from './issue-manager.js';
import { config, updateConfig } from './config.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export function createPRApiRouter(prManager: PRManager, issueManager?: IssueManager): Router {
  const router = Router();
  router.use(json());

  // ── Config ──

  router.get('/config', (_req, res) => {
    res.json(config);
  });

  router.patch('/config', (req, res) => {
    const { repoPath, worktreeBase, reviewBase, targetBranch, requireScreenshotsForUiChanges } = req.body || {};
    updateConfig({ repoPath, worktreeBase, reviewBase, targetBranch, requireScreenshotsForUiChanges });
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

  // Relaunch review — kill existing reviewer, re-spawn a new one
  router.post('/prs/:id/relaunch-review', (req, res) => {
    const pr = prManager.get(req.params.id);
    if (!pr) {
      res.status(404).json({ error: 'PR not found' });
      return;
    }
    if (pr.status === 'merged' || pr.status === 'closed') {
      res.status(400).json({ error: `Cannot relaunch review on a ${pr.status} PR` });
      return;
    }
    const updated = prManager.relaunchReview(req.params.id);
    if (!updated) {
      res.status(500).json({ error: 'Failed to relaunch review' });
      return;
    }
    res.json(updated);
  });

  // List screenshots associated with a PR (via its linked issue)
  router.get('/prs/:id/screenshots', (req, res) => {
    const pr = prManager.get(req.params.id);
    if (!pr) {
      res.status(404).json({ error: 'PR not found' });
      return;
    }

    const screenshotDir = join(config.screenshotBase, pr.issueId);
    let files: string[] = [];
    try {
      files = readdirSync(screenshotDir).filter((f) => {
        const ext = extname(f).toLowerCase();
        return IMAGE_EXTENSIONS.has(ext);
      });
    } catch {
      // Directory doesn't exist — no screenshots
    }

    const screenshots = files.map((f) => ({
      filename: f,
      url: `/screenshots/${pr.issueId}/${f}`,
    }));

    res.json({ screenshots });
  });

  // Check if merge would have conflicts (dry run, async to not block event loop)
  router.get('/prs/:id/merge-check', async (req, res) => {
    const pr = prManager.get(req.params.id);
    if (!pr) {
      res.status(404).json({ error: 'PR not found' });
      return;
    }
    if (pr.status === 'merged') {
      res.json({ canMerge: true, merged: true });
      return;
    }
    try {
      const result = await prManager.checkMerge(req.params.id);
      res.json(result);
    } catch (err: any) {
      res.json({ canMerge: false, hasConflicts: false, error: err.message });
    }
  });

  // Fix merge conflicts — spawns an agent to resolve them
  router.post('/prs/:id/fix-conflicts', (req, res) => {
    const pr = prManager.get(req.params.id);
    if (!pr) {
      res.status(404).json({ error: 'PR not found' });
      return;
    }
    const result = prManager.fixConflicts(req.params.id);
    if (result.error) {
      res.status(500).json({ error: result.error });
      return;
    }
    res.json(result.pr);
  });

  // Merge PR — also moves the issue to DONE
  router.post('/prs/:id/merge', (req, res) => {
    const prBefore = prManager.get(req.params.id);
    if (!prBefore) {
      res.status(404).json({ error: 'PR not found' });
      return;
    }
    const result = prManager.merge(req.params.id);
    if (result.error || !result.pr) {
      res.status(500).json({ error: result.error || 'Merge failed' });
      return;
    }
    // Move the linked issue to DONE
    if (issueManager) {
      issueManager.changeStatus(result.pr.issueId, 'done');
    }
    res.json(result.pr);
  });

  return router;
}
