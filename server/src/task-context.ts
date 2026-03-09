/**
 * @module task-context
 * Generates and writes task context files into agent worktrees.
 *
 * Instead of agents having to curl the hermes-monitor API to learn about
 * their task, this module pre-populates the worktree with all the context
 * they need:
 *
 * - **TASK.md** — complete task description, rework feedback, guidelines,
 *   helper commands. The single source of truth.
 * - **Agent-native context files** — AGENTS.md (Hermes/Codex/Gemini) or
 *   CLAUDE.md (Claude Code) that reference TASK.md and are auto-loaded
 *   by the respective agents.
 * - **Helper scripts** — `.hermes-monitor/submit.sh`, `progress.sh`,
 *   `upload-screenshot.sh` that wrap common API calls.
 */

import { mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import type { Issue } from '@hermes-monitor/shared/types';
import type { PRManager } from './pr-manager.js';
import type { WorktreeManager } from './worktree-manager.js';
import { config } from './config.js';
import { getDiagnostics } from './diagnostics.js';
import { UI_EXTENSIONS } from './screenshot-utils.js';
import { extractActionItems } from './review-utils.js';

/** Server port — use config.serverPort as the single source of truth */

export interface TaskContextOptions {
  issue: Issue;
  /** Worktree path — required for writeTaskContext, optional for generateTaskMd */
  worktreePath?: string;
  prManager?: PRManager | null;
  worktreeManager?: WorktreeManager | null;
  /** Override port for testing */
  port?: string;
}



/**
 * Generate the TASK.md content for an issue.
 * Contains everything the agent needs to know about its task.
 */
export function generateTaskMd(options: TaskContextOptions): string {
  const { issue, worktreePath, prManager, worktreeManager } = options;
  const port = options.port || config.serverPort;
  const baseUrl = `http://localhost:${port}`;

  const existingPr = prManager?.getByIssueId(issue.id);
  const isRework = !!existingPr;

  // Safely get changed files — may fail if worktree doesn't exist yet
  let changedFiles: string[] = [];
  try {
    changedFiles = worktreeManager?.getChangedFiles(issue.id) ?? [];
  } catch {
    // Worktree may not be fully initialized yet — skip changed files section
  }

  // Build rework feedback — check comment body for CHANGES_REQUESTED rather than
  // the PR verdict field, because resetToOpen() clears the verdict to 'pending'
  // before writeTaskContext runs. This ensures rework feedback always appears.
  let reworkSection = '';
  if (existingPr) {
    // Find reviewer comments whose body contains a CHANGES_REQUESTED verdict
    const changesRequestedComments = existingPr.comments
      .filter((c) => /VERDICT:\s*CHANGES_REQUESTED/i.test(c.body))
      .sort((a, b) => b.createdAt - a.createdAt);
    if (changesRequestedComments.length > 0) {
      const latest = changesRequestedComments[0];
      const actionItems = extractActionItems(latest.body);
      reworkSection = [
        '',
        '## ⚠ REWORK REQUIRED',
        '',
        'The reviewer requested changes. Address the feedback below before resubmitting.',
        '',
        '### Latest Review Feedback',
        '',
        latest.body,
        '',
        ...(actionItems.length > 0 ? [
          '### Action Items',
          '',
          ...actionItems.map((item) => `- [ ] ${item}`),
          '',
        ] : []),
      ].join('\n');
    }
  }

  // Build previous reviews section
  let reviewsSection = '';
  if (existingPr && existingPr.comments.length > 0) {
    const reviews = existingPr.comments
      .map((c) => {
        const verdictMatch = c.body.match(/VERDICT:\s*(APPROVED|CHANGES_REQUESTED)/i);
        return {
          author: c.author,
          verdict: verdictMatch ? verdictMatch[1].toLowerCase() : null,
          body: c.body,
          createdAt: c.createdAt,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    reviewsSection = [
      '',
      '## Previous Reviews',
      '',
      ...reviews.map((r) => [
        `### Review by ${r.author} (${r.verdict || 'no verdict'}) — ${new Date(r.createdAt).toISOString()}`,
        '',
        r.body,
        '',
      ].join('\n')),
    ].join('\n');
  }

  // Build previous attempts section
  const previousAttempts = getDiagnostics(issue.id, config.diagnosticsBase);
  let attemptsSection = '';
  if (previousAttempts.length > 0) {
    attemptsSection = [
      '',
      '## Previous Attempts',
      '',
      'The agent has crashed or been restarted before. Diagnostic logs:',
      '',
      ...previousAttempts.map((a) =>
        `- Exit code ${a.exitCode} at ${new Date(a.timestamp).toISOString()} — log: ${a.logFile}`
      ),
      '',
    ].join('\n');
  }

  // Build changed files section
  let changedFilesSection = '';
  if (changedFiles.length > 0) {
    changedFilesSection = [
      '',
      '## Already Changed Files',
      '',
      'These files have been modified in previous work on this branch:',
      '',
      ...changedFiles.map((f) => `- ${f}`),
      '',
    ].join('\n');
  }

  // Screenshot guidelines
  const screenshotGuidelines = config.requireScreenshotsForUiChanges
    ? [
      '### Screenshot Requirements',
      '',
      'Screenshots are **required** when your changes modify UI files',
      `(${UI_EXTENSIONS.join(', ')}).`,
      '',
      'Upload before/after screenshots before submitting for review:',
      '```bash',
      `./.hermes-monitor/upload-screenshot.sh screenshot.png "Description"`,
      '```',
      '',
      'If your changes are non-visual (comments, whitespace, imports, renames),',
      'you can bypass the requirement when submitting:',
      '```bash',
      `./.hermes-monitor/submit.sh --no-ui-changes "CSS class rename only"`,
      '```',
      '',
    ].join('\n')
    : '';

  // Attempt number
  const attempt = existingPr
    ? existingPr.comments.filter((c) =>
        /VERDICT:\s*(APPROVED|CHANGES_REQUESTED)/i.test(c.body)
      ).length + 1
    : 1;

  const taskMd = [
    '# Task',
    '',
    `**Title:** ${issue.title}`,
    `**ID:** ${issue.id}`,
    `**Branch:** ${issue.branch || 'unknown'}`,
    `**Attempt:** ${attempt}`,
    isRework ? '**Status:** REWORK (addressing reviewer feedback)' : '**Status:** New task',
    '',
    '## Description',
    '',
    issue.description || '(No description provided)',
    '',
    reworkSection,
    '## Instructions',
    '',
    '1. You are already in the correct git worktree on the correct branch.',
    '2. Read this file to understand your task.',
    '3. Implement the changes, write tests, and verify they pass.',
    '4. Stage and commit your changes: `git add -A && git commit -m "your message"`',
    '5. Submit for review:',
    '   ```bash',
    '   ./.hermes-monitor/submit.sh',
    '   ```',
    '   Or with details:',
    '   ```bash',
    '   ./.hermes-monitor/submit.sh --details "Summary of what I did"',
    '   ```',
    '',
    '## Reporting Progress',
    '',
    'Optionally report progress during execution:',
    '```bash',
    './.hermes-monitor/progress.sh "Running tests"',
    '```',
    '',
    screenshotGuidelines,
    changedFilesSection,
    reviewsSection,
    attemptsSection,
    '## API Reference',
    '',
    'If you prefer using curl directly instead of the helper scripts:',
    '',
    '| Action | Command |',
    '|--------|---------|',
    `| Get task info | \`curl -s ${baseUrl}/agent/${issue.id}/info\` |`,
    `| Submit for review | \`curl -s -X POST ${baseUrl}/agent/${issue.id}/review\` |`,
    `| Report progress | \`curl -s -X POST ${baseUrl}/agent/${issue.id}/progress -H Content-Type:application/json -d '{"message":"..."}'\` |`,
    `| Upload screenshot | \`curl -X POST --data-binary @file.png -H 'Content-Type: image/png' '${baseUrl}/agent/${issue.id}/screenshots?filename=name.png'\` |`,
    '',
  ].join('\n');

  return taskMd;
}

/**
 * Generate agent-native context file content.
 * Used for AGENTS.md (Hermes, Codex, Gemini) and CLAUDE.md (Claude Code).
 * These files are auto-loaded by agents and tell them to read TASK.md.
 */
function generateAgentContextMd(heading: string): string {
  return [
    `# ${heading}`,
    '',
    '## Current Task',
    '',
    'Read `TASK.md` in this directory for your complete task description,',
    'requirements, and submission instructions.',
    '',
    '## Workflow',
    '',
    '1. Read TASK.md for task details and any rework feedback.',
    '2. Implement the changes.',
    '3. Run tests to verify.',
    '4. Commit your changes: `git add -A && git commit -m "description"`',
    '5. Submit: `./.hermes-monitor/submit.sh`',
    '',
    '## Helper Scripts',
    '',
    '- `./.hermes-monitor/submit.sh` — submit for review',
    '- `./.hermes-monitor/progress.sh "message"` — report progress',
    '- `./.hermes-monitor/upload-screenshot.sh file.png "description"` — upload screenshot',
    '',
    '## Important Notes',
    '',
    '- Do NOT stop after summarization steps — continue working.',
    '- Complete the full task before submitting.',
    '- If tests fail, fix them before submitting.',
    '',
  ].join('\n');
}

/**
 * Generate AGENTS.md content (for Hermes, Codex, Gemini).
 */
export function generateAgentsMd(): string {
  return generateAgentContextMd('Project Agent Instructions');
}

/**
 * Generate CLAUDE.md content (for Claude Code).
 */
export function generateClaudeMd(): string {
  return generateAgentContextMd('Project Instructions');
}

/**
 * Generate the submit helper script.
 */
export function generateSubmitScript(issueId: string, port?: string): string {
  const p = port || config.serverPort;
  return [
    '#!/bin/bash',
    '# Submit this task for review.',
    '# Usage:',
    '#   ./.hermes-monitor/submit.sh',
    '#   ./.hermes-monitor/submit.sh --details "Summary of changes"',
    '#   ./.hermes-monitor/submit.sh --no-ui-changes "Reason for bypass"',
    '',
    'command -v jq >/dev/null 2>&1 || { echo "Error: jq is required but not installed. Install with: apt install jq / brew install jq"; exit 1; }',
    '',
    `BASE_URL="http://localhost:${p}/agent/${issueId}"`,
    '',
    'DETAILS=""',
    'NO_UI_CHANGES=""',
    'REASON=""',
    '',
    'while [[ $# -gt 0 ]]; do',
    '  case "$1" in',
    '    --details)',
    '      DETAILS="$2"',
    '      shift 2',
    '      ;;',
    '    --no-ui-changes)',
    '      NO_UI_CHANGES="true"',
    '      # Only consume next arg as reason if it doesn\'t start with --',
    '      if [[ -n "${2:-}" && "${2}" != --* ]]; then',
    '        REASON="$2"',
    '        shift',
    '      fi',
    '      shift',
    '      ;;',
    '    *)',
    '      echo "Unknown option: $1"',
    '      exit 1',
    '      ;;',
    '  esac',
    'done',
    '',
    '# Build JSON body using jq for safe escaping',
    'BODY="{}"',
    'if [[ -n "$DETAILS" ]]; then',
    '  BODY=$(echo "$BODY" | jq --arg details "$DETAILS" \'. + {details: $details}\')',
    'fi',
    'if [[ -n "$NO_UI_CHANGES" ]]; then',
    '  BODY=$(echo "$BODY" | jq \'. + {noUiChanges: true}\')',
    '  if [[ -n "$REASON" ]]; then',
    '    BODY=$(echo "$BODY" | jq --arg reason "$REASON" \'. + {reason: $reason}\')',
    '  fi',
    'fi',
    '',
    'echo "Submitting for review..."',
    'RESPONSE=$(curl -s -X POST "$BASE_URL/review" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d "$BODY")',
    '',
    'echo "$RESPONSE"',
    '',
    '# Check for errors',
    'if echo "$RESPONSE" | grep -q \'\"error\"\'; then',
    '  echo ""',
    '  echo "❌ Submission failed. See error above."',
    '  exit 1',
    'fi',
    '',
    'echo ""',
    'echo "✓ Submitted for review."',
    '',
  ].join('\n');
}

/**
 * Generate the progress helper script.
 */
export function generateProgressScript(issueId: string, port?: string): string {
  const p = port || config.serverPort;
  return [
    '#!/bin/bash',
    '# Report progress on this task.',
    '# Usage: ./.hermes-monitor/progress.sh "Running tests"',
    '# Usage: ./.hermes-monitor/progress.sh "Building" 50',
    '',
    'command -v jq >/dev/null 2>&1 || { echo "Error: jq is required but not installed. Install with: apt install jq / brew install jq"; exit 1; }',
    '',
    'MESSAGE="${1:?Usage: progress.sh \\"message\\" [percent]}"',
    'PERCENT="${2:-}"',
    '',
    `BASE_URL="http://localhost:${p}/agent/${issueId}"`,
    '',
    '# Build JSON body using jq for safe escaping',
    'BODY=$(jq -n --arg message "$MESSAGE" \'{message: $message}\')',
    'if [[ -n "$PERCENT" ]]; then',
    '  BODY=$(echo "$BODY" | jq --argjson percent "$PERCENT" \'. + {percent: $percent}\')',
    'fi',
    '',
    'curl -s -X POST "$BASE_URL/progress" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d "$BODY" > /dev/null',
    '',
  ].join('\n');
}

/**
 * Generate the screenshot upload helper script.
 */
export function generateUploadScreenshotScript(issueId: string, port?: string): string {
  const p = port || config.serverPort;
  return [
    '#!/bin/bash',
    '# Upload a screenshot for this task.',
    '# Usage: ./.hermes-monitor/upload-screenshot.sh screenshot.png "Description"',
    '',
    'command -v jq >/dev/null 2>&1 || { echo "Error: jq is required but not installed. Install with: apt install jq / brew install jq"; exit 1; }',
    '',
    'FILE="${1:?Usage: upload-screenshot.sh <file> [description]}"',
    'DESCRIPTION="${2:-}"',
    '',
    'if [[ ! -f "$FILE" ]]; then',
    '  echo "Error: File not found: $FILE"',
    '  exit 1',
    'fi',
    '',
    '# Detect content type from extension',
    'EXT="${FILE##*.}"',
    'case "$EXT" in',
    '  png) CT="image/png" ;;',
    '  jpg|jpeg) CT="image/jpeg" ;;',
    '  gif) CT="image/gif" ;;',
    '  webp) CT="image/webp" ;;',
    '  svg) CT="image/svg+xml" ;;',
    '  *) echo "Error: Unsupported image type: .$EXT"; exit 1 ;;',
    'esac',
    '',
    'FILENAME=$(basename "$FILE")',
    'QUERY="filename=$FILENAME"',
    '# Use jq for proper URL encoding (handles &, ?, #, = and all special chars)',
    '[[ -n "$DESCRIPTION" ]] && QUERY="$QUERY&description=$(printf \'%s\' "$DESCRIPTION" | jq -sRr @uri)"',
    '',
    `BASE_URL="http://localhost:${p}/agent/${issueId}"`,
    '',
    'RESPONSE=$(curl -s -X POST --data-binary "@$FILE" \\',
    '  -H "Content-Type: $CT" \\',
    '  "$BASE_URL/screenshots?$QUERY")',
    '',
    'echo "$RESPONSE"',
    '',
    '# Extract markdown snippet using jq for reliable JSON parsing',
    'MARKDOWN=$(echo "$RESPONSE" | jq -r \'.markdown // empty\')',
    'if [[ -n "$MARKDOWN" ]]; then',
    '  echo ""',
    '  echo "Markdown to include in PR description:"',
    '  echo "$MARKDOWN"',
    'fi',
    '',
  ].join('\n');
}

/**
 * Determine which agent-native context file to write based on the agent type.
 */
function getAgentContextFile(agentId: string): { filename: string; generator: () => string } | null {
  switch (agentId) {
    case 'hermes':
    case 'codex':
    case 'gemini':
      return { filename: 'AGENTS.md', generator: generateAgentsMd };
    case 'claude':
      return { filename: 'CLAUDE.md', generator: generateClaudeMd };
    default:
      // For aider, shell, custom — no auto-loaded context file
      return null;
  }
}

/** Files that should be excluded from git in target repos */
const GENERATED_EXCLUDES = [
  '# hermes-monitor generated context files (do not commit)',
  'TASK.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.hermes-monitor/',
];

/**
 * Write entries to .git/info/exclude for the worktree to prevent
 * generated context files from being staged by `git add -A`.
 *
 * Uses the per-worktree exclude file, which is invisible to the repo
 * and doesn't conflict with the user's .gitignore.
 */
function writeGitExclude(worktreePath: string): void {
  try {
    // git rev-parse --git-dir gives the worktree-specific git dir
    const gitDir = execSync('git rev-parse --git-dir', {
      cwd: worktreePath,
      stdio: 'pipe',
    }).toString().trim();

    const resolvedGitDir = resolve(worktreePath, gitDir);
    const infoDir = join(resolvedGitDir, 'info');
    mkdirSync(infoDir, { recursive: true });

    const excludePath = join(infoDir, 'exclude');

    // Read existing content (if any) and only add entries that aren't already present
    let existing = '';
    if (existsSync(excludePath)) {
      existing = readFileSync(excludePath, 'utf-8');
    }

    const linesToAdd = GENERATED_EXCLUDES.filter((line) => !existing.includes(line));
    if (linesToAdd.length > 0) {
      const suffix = existing.endsWith('\n') || existing === '' ? '' : '\n';
      writeFileSync(excludePath, existing + suffix + linesToAdd.join('\n') + '\n', 'utf-8');
    }
  } catch {
    // Non-fatal — the context files will still work, they just might
    // be staged by git add -A. The .gitignore in hermes-monitor's own
    // repo still protects the common case.
  }
}

/**
 * Write all task context files into a worktree.
 *
 * Called by IssueManager when transitioning an issue to in_progress.
 * Creates:
 * - TASK.md — complete task context
 * - AGENTS.md or CLAUDE.md — agent-native context file (auto-loaded)
 * - .hermes-monitor/submit.sh — submit helper
 * - .hermes-monitor/progress.sh — progress helper
 * - .hermes-monitor/upload-screenshot.sh — screenshot helper
 *
 * Files are written atomically. Existing files are overwritten (they may
 * be stale from a previous attempt).
 */
export function writeTaskContext(options: TaskContextOptions & { worktreePath: string }): void {
  const { issue, worktreePath } = options;
  const port = options.port || config.serverPort;

  // Bail early if the worktree directory doesn't exist (shouldn't happen
  // in production, but can occur in tests with mock worktree managers)
  if (!existsSync(worktreePath)) {
    return;
  }

  // Write TASK.md
  const taskMd = generateTaskMd(options);
  writeFileSync(join(worktreePath, 'TASK.md'), taskMd, 'utf-8');

  // Write agent-native context file
  const agentCtx = getAgentContextFile(issue.agent);
  if (agentCtx) {
    const content = agentCtx.generator();
    const targetPath = join(worktreePath, agentCtx.filename);
    // Don't overwrite if the file exists in the repo already (user's own context)
    if (!existsSync(targetPath)) {
      writeFileSync(targetPath, content, 'utf-8');
    }
  }

  // Write helper scripts
  const scriptsDir = join(worktreePath, '.hermes-monitor');
  mkdirSync(scriptsDir, { recursive: true });

  const scripts = [
    { name: 'submit.sh', content: generateSubmitScript(issue.id, port) },
    { name: 'progress.sh', content: generateProgressScript(issue.id, port) },
    { name: 'upload-screenshot.sh', content: generateUploadScreenshotScript(issue.id, port) },
  ];

  for (const script of scripts) {
    const scriptPath = join(scriptsDir, script.name);
    writeFileSync(scriptPath, script.content, 'utf-8');
    chmodSync(scriptPath, 0o755);
  }

  // Inject entries into .git/info/exclude to prevent context files from
  // being committed into target repos. This is invisible to the repo
  // (not committed) and doesn't conflict with the user's .gitignore.
  writeGitExclude(worktreePath);
}

/**
 * Update TASK.md in an existing worktree (e.g., after rework).
 * Re-generates the file with fresh review feedback and status.
 *
 * Note: writeTaskContext already handles the rework case (since rework
 * goes through `to === 'in_progress'`), so this function is available
 * for callers that only need to regenerate TASK.md without touching
 * helper scripts or agent context files.
 */
export function updateTaskContext(options: TaskContextOptions & { worktreePath: string }): void {
  const { worktreePath } = options;
  const taskMd = generateTaskMd(options);
  writeFileSync(join(worktreePath, 'TASK.md'), taskMd, 'utf-8');
}
