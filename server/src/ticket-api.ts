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
import type { WorktreeManager } from './worktree-manager.js';
import { config } from './config.js';
import { ALLOWED_EXTENSIONS, getUploadedScreenshots, UI_EXTENSIONS } from './screenshot-utils.js';

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

interface TicketGuidelines {
  screenshots: string;
  requireScreenshotsForUiChanges: boolean;
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
  screenshotUploadUrl: string;
  screenshotUploadInstructions: string;
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

    const baseUrl = `http://localhost:${PORT}`;

    const screenshotUploadUrl = `${baseUrl}/ticket/${issue.id}/screenshots`;
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

    const response: TicketInfoResponse = {
      id: issue.id,
      title: issue.title,
      description: issue.description,
      branch: issue.branch ?? undefined,
      worktreePath: worktree?.path || null,
      repoPath: config.repoPath,
      targetBranch: config.targetBranch,
      previousReviews,
      reviewUrl: `${baseUrl}/ticket/${issue.id}/review`,
      screenshotUploadUrl,
      screenshotUploadInstructions,
      guidelines: {
        screenshots: config.requireScreenshotsForUiChanges
          ? 'Screenshots are REQUIRED when your changes modify UI files (.tsx, .jsx, .css, .scss, .less, .html, .vue, .svelte). Upload before/after screenshots using the screenshotUploadUrl BEFORE calling /review. If you did not make visual changes, bypass with: POST /ticket/:id/review?no_ui_changes=true or send {"noUiChanges": true} in the request body.'
          : 'If your changes modify UI components (.tsx, .css, .html files), upload before/after screenshots using the screenshotUploadUrl and include the returned markdown in your PR description.',
        requireScreenshotsForUiChanges: config.requireScreenshotsForUiChanges,
      },
    };
    res.json(response);
  });

  // Agent uploads a screenshot for its ticket
  router.post('/ticket/:id/screenshots', raw({ type: 'image/*', limit: '10mb' }), (req, res) => {
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
  router.get('/ticket/:id/screenshots', (req, res) => {
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

    // Capture submitter notes/details for the reviewer
    const details = req.body?.details;
    if (details && typeof details === 'string') {
      issueManager.update(issue.id, { submitterNotes: details });
    }

    // Check screenshot requirement for UI changes
    if (config.requireScreenshotsForUiChanges) {
      const noUiChanges = req.query.no_ui_changes === 'true'
        || req.body?.noUiChanges === true
        || req.body?.noUiChanges === 'true';

      if (!noUiChanges) {
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
            res.status(400).json({
              error: 'Screenshots required for UI changes',
              message: [
                'Your changes include UI files but no screenshots were uploaded.',
                '',
                'UI files changed:',
                ...uiFiles.map((f) => `  - ${f}`),
                '',
                'To fix: upload screenshots using the screenshotUploadUrl from /ticket/:id/info',
                '',
                'To bypass (if no visual changes): resubmit with ?no_ui_changes=true',
                '  curl -s -X POST http://localhost:' + PORT + '/ticket/' + issue.id + '/review?no_ui_changes=true',
                '',
                'Or send JSON body: { "noUiChanges": true }',
              ].join('\n'),
              uiFilesChanged: uiFiles,
            });
            return;
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
    });
  });

  return router;
}
