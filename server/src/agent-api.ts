/**
 * @module ticket-api
 * Agent-facing REST API — called BY agents during task execution.
 * Exposes endpoints for agents to retrieve task info, submit work for review,
 * upload screenshots, and query their assigned issue/PR context.
 */
import { Router, json, raw } from 'express';
import { mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { IssueManager } from './issue-manager.js';
import type { PRManager } from './pr-manager.js';
import type { TerminalManager } from './terminal-manager.js';
import type { WorktreeManager, HealthCheckResult } from './worktree-manager.js';
import { config } from './config.js';
import { ALLOWED_EXTENSIONS, getUploadedScreenshots, UI_EXTENSIONS } from './screenshot-utils.js';
import { analyzeUiDiff } from './ui-change-analyzer.js';

/** File extensions that indicate UI changes requiring screenshots (derived from screenshot-utils) */
const UI_FILE_EXTENSIONS = new Set(UI_EXTENSIONS);

/** Server port — single source of truth for URL construction in this module */
const PORT = process.env.PORT || '4000';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

interface AgentGuidelines {
  screenshots: string;
  requireScreenshotsForUiChanges: boolean;
}

interface AgentInfoResponse {
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
  screenshotUploadUrl: string;
  screenshotUploadInstructions: string;
  guidelines: AgentGuidelines;
  workspaceHealth: HealthCheckResult | null;
}

/**
 * Record a screenshot bypass reason on the issue.
 * Single source of truth — the reason is stored as a structured field
 * and flows to the PR via issue-manager → pr-manager.
 */
function recordBypass(issueManager: IssueManager, issueId: string, reason: string): void {
  issueManager.update(issueId, { screenshotBypassReason: reason });
}

/**
 * Agent-facing API — these endpoints are called BY the agent during task execution.
 * GET  /:id/info   — agent gets its task context
 * POST /:id/review — agent signals it's done, moves issue to review
 *
 * Mounted at /agent in index.ts, so full paths are /agent/:id/info, /agent/:id/review, etc.
 */
export function createAgentApiRouter(
  issueManager: IssueManager,
  prManager: PRManager,
  terminalManager: TerminalManager,
  worktreeManager: WorktreeManager,
): Router {
  const router = Router();
  router.use(json());

  // Agent calls this to get task details, worktree path, previous reviews
  router.get('/:id/info', (req, res) => {
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

    const baseUrl = `http://localhost:${PORT}`;

    const screenshotUploadUrl = `${baseUrl}/agent/${issue.id}/screenshots`;
    const screenshotUploadInstructions = [
      'To upload a screenshot, POST the image file to the upload URL:',
      '',
      `  curl -X POST --data-binary @screenshot.png \\`,
      `    -H 'Content-Type: image/png' \\`,
      `    '${screenshotUploadUrl}?filename=my-screenshot.png&description=Before+changes'`,
      '',
      'The response includes a markdown snippet you can paste into your PR description.',
      'To list existing screenshots: GET ' + screenshotUploadUrl,
    ].join('\n');

    const response: AgentInfoResponse = {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      branch: issue.branch ?? undefined,
      worktreePath: worktree?.path || null,
      repoPath: config.repoPath,
      targetBranch: config.targetBranch,
      previousReviews,
      reviewUrl: `${baseUrl}/agent/${issue.id}/review`,
      screenshotUploadUrl,
      screenshotUploadInstructions,
      guidelines: {
        screenshots: config.requireScreenshotsForUiChanges
          ? 'Screenshots are REQUIRED when your changes modify UI files (.tsx, .jsx, .css, .scss, .less, .html, .vue, .svelte). Upload before/after screenshots using the screenshotUploadUrl BEFORE calling /review. Non-visual changes (comments, whitespace, imports, file renames) are auto-detected and bypass the requirement. If you did not make visual changes, bypass with: POST /agent/:id/review?no_ui_changes=true or send {"noUiChanges": true} in the request body. You can optionally include a reason: {"noUiChanges": true, "reason": "CSS class rename only"}.'
          : 'If your changes modify UI components (.tsx, .css, .html files), upload before/after screenshots using the screenshotUploadUrl and include the returned markdown in your PR description.',
        requireScreenshotsForUiChanges: config.requireScreenshotsForUiChanges,
      },
      workspaceHealth: worktreeManager.getHealthCheck(issue.id) || null,
    };
    res.json(response);
  });

  // Agent uploads a screenshot for its issue
  router.post('/:id/screenshots', raw({ type: 'image/*', limit: '10mb' }), (req, res) => {
    const issue = issueManager.get(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({
        error: 'No image data received. Send the image as the raw request body with Content-Type: image/*',
        example: "curl -X POST --data-binary @screenshot.png -H 'Content-Type: image/png' '<url>?filename=name.png'",
      });
      return;
    }

    // Determine file extension from Content-Type or filename query param
    const contentType = req.headers['content-type'] || '';
    const queryFilename = req.query.filename as string | undefined;
    const description = (req.query.description as string | undefined) || '';

    let ext = MIME_TO_EXT[contentType];
    if (!ext && queryFilename) {
      ext = extname(queryFilename).toLowerCase();
    }
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({
        error: `Unsupported image type. Content-Type: ${contentType}. Allowed: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`,
      });
      return;
    }

    // Build filename: use provided name (sanitized) or generate one
    const id = uuidv4().slice(0, 8);
    let basename: string;
    if (queryFilename) {
      // Sanitize: strip extension, keep only safe chars
      const rawName = queryFilename.replace(extname(queryFilename), '').replace(/[^a-zA-Z0-9_-]/g, '_');
      basename = `${rawName}-${id}${ext}`;
    } else {
      basename = `screenshot-${id}${ext}`;
    }

    // Save to disk
    const screenshotDir = join(config.screenshotBase, issue.id);
    mkdirSync(screenshotDir, { recursive: true });
    const filePath = join(screenshotDir, basename);
    writeFileSync(filePath, req.body);

    const url = `/screenshots/${issue.id}/${basename}`;
    const fullUrl = `http://localhost:${PORT}${url}`;
    const alt = description || basename;
    const markdown = `![${alt}](${fullUrl})`;

    res.status(201).json({ url, fullUrl, markdown, filename: basename });
  });

  // Agent lists its uploaded screenshots
  router.get('/:id/screenshots', (req, res) => {
    const issue = issueManager.get(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    const files = getUploadedScreenshots(issue.id);

    const screenshots = files.map((f) => ({
      filename: f,
      url: `/screenshots/${issue.id}/${f}`,
      fullUrl: `http://localhost:${PORT}/screenshots/${issue.id}/${f}`,
      markdown: `![${f}](http://localhost:${PORT}/screenshots/${issue.id}/${f})`,
    }));

    res.json({ screenshots });
  });

  // Agent calls this when done — kills terminal, moves issue to review
  // Accepts optional { details: "..." } in the request body for submitter notes
  router.post('/:id/review', (req, res) => {
    const issue = issueManager.get(req.params.id);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }

    if (issue.status !== 'in_progress') {
      res.status(400).json({ error: `Issue is ${issue.status}, not in_progress` });
      return;
    }

    // Capture submitter notes/details for the reviewer
    const details = req.body?.details;
    if (details && typeof details === 'string') {
      issueManager.update(issue.id, { submitterNotes: details });
    }

    // Track screenshot bypass info for the response
    let screenshotBypass: { bypassed: boolean; reason?: string } = { bypassed: false };

    // Check screenshot requirement for UI changes
    if (config.requireScreenshotsForUiChanges) {
      // Manual bypass: agent explicitly says no UI changes
      const noUiChanges = req.query.no_ui_changes === 'true'
        || req.body?.noUiChanges === true
        || req.body?.noUiChanges === 'true';

      // Optional reason for the bypass (shown to reviewer)
      const bypassReason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;

      if (noUiChanges) {
        // Agent self-certified: log the reason if provided
        const reason = bypassReason || 'agent self-certified no visual changes';
        screenshotBypass = { bypassed: true, reason };
        recordBypass(issueManager, issue.id, reason);
      } else {
        // Check if changed files include UI files
        const changedFiles = worktreeManager.getChangedFiles(issue.id);
        const uiFiles = changedFiles.filter((f) => {
          const ext = extname(f).toLowerCase();
          return UI_FILE_EXTENSIONS.has(ext);
        });

        if (uiFiles.length > 0) {
          // Check if screenshots have been uploaded
          const hasScreenshots = getUploadedScreenshots(issue.id).length > 0;

          if (!hasScreenshots) {
            // Auto-detect: analyze the diff to see if changes are non-visual
            // Only auto-bypass if we successfully obtained a diff; undefined means
            // we couldn't get the diff (no worktree, git error) — be conservative.
            const uiDiff = worktreeManager.getDiffForFiles(issue.id, uiFiles);
            const analysis = uiDiff !== undefined
              ? analyzeUiDiff(uiDiff)
              : { allNonVisual: false, reason: 'could not analyze diff' };

            if (analysis.allNonVisual) {
              // Auto-bypass: all UI changes are non-visual (comments, whitespace, imports, renames)
              screenshotBypass = { bypassed: true, reason: analysis.reason };
              recordBypass(issueManager, issue.id, analysis.reason);
            } else {
              // Visual changes detected — screenshots required
              res.status(400).json({
                error: 'Screenshots required for UI changes',
                message: [
                  'Your changes include UI files but no screenshots were uploaded.',
                  '',
                  'UI files changed:',
                  ...uiFiles.map((f) => `  - ${f}`),
                  '',
                  'To fix: upload screenshots using the screenshotUploadUrl from /agent/:id/info',
                  '',
                  'To bypass (if no visual changes): resubmit with ?no_ui_changes=true',
                  '  curl -s -X POST http://localhost:' + PORT + '/agent/' + issue.id + '/review?no_ui_changes=true',
                  '',
                  'Or send JSON body: { "noUiChanges": true, "reason": "explain why no visual change" }',
                ].join('\n'),
                uiFilesChanged: uiFiles,
              });
              return;
            }
          }
        }
      }
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
      submitterNotes: issue.submitterNotes || null,
      ...(screenshotBypass.bypassed ? { screenshotBypass } : {}),
    });
  });

  return router;
}
