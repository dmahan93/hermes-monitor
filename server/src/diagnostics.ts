/**
 * @module diagnostics
 * Saves terminal output on exit for post-mortem analysis.
 *
 * When an agent terminal exits (crash, retry exhaustion, or normal exit),
 * the last N lines of scrollback are persisted to a diagnostic log file.
 * This allows agents on rework (or humans) to see what happened in previous
 * attempts without having watched the terminal live.
 *
 * Storage: /tmp/hermes-diagnostics/<issue-id>/<timestamp>-exit.log
 * (base path configurable via HERMES_DIAGNOSTICS_BASE env var)
 */

import { mkdirSync, writeFileSync, readdirSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';

const MAX_DIAGNOSTIC_FILES = 5;
const SCROLLBACK_LINES = 100;

export interface DiagnosticEntry {
  exitCode: number;
  logFile: string;
  timestamp: number;
}

export interface SaveDiagnosticsOptions {
  issueId: string;
  issueTitle: string;
  branch: string | null;
  exitCode: number;
  scrollback: string;
  diagnosticsBase: string;
}

/**
 * Strip ANSI escape sequences from terminal output for readable log files.
 */
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\r/g, '');
}

/**
 * Save a diagnostic log file for an agent terminal exit.
 *
 * Creates a readable text file with headers and the last N lines of
 * terminal output. Automatically cleans up old files to stay within
 * the retention limit.
 *
 * @returns The path to the saved diagnostic file
 */
export function saveDiagnostics(options: SaveDiagnosticsOptions): string {
  const { issueId, issueTitle, branch, exitCode, scrollback, diagnosticsBase } = options;
  const timestamp = Date.now();

  // Ensure diagnostics directory exists
  const issueDir = join(diagnosticsBase, issueId);
  mkdirSync(issueDir, { recursive: true });

  // Extract last N lines from scrollback
  const cleanScrollback = stripAnsi(scrollback);
  const allLines = cleanScrollback.split('\n');
  const lastLines = allLines.slice(-SCROLLBACK_LINES);

  // Build readable log file
  const logContent = [
    '═══════════════════════════════════════════════════════════',
    '  AGENT TERMINAL EXIT DIAGNOSTIC',
    '═══════════════════════════════════════════════════════════',
    '',
    `  Issue:     ${issueTitle}`,
    `  Issue ID:  ${issueId}`,
    `  Branch:    ${branch || '(none)'}`,
    `  Exit Code: ${exitCode}`,
    `  Timestamp: ${new Date(timestamp).toISOString()}`,
    '',
    '═══════════════════════════════════════════════════════════',
    `  LAST ${lastLines.length} LINES OF TERMINAL OUTPUT`,
    '═══════════════════════════════════════════════════════════',
    '',
    ...lastLines,
    '',
    '═══════════════════════════════════════════════════════════',
    `  END OF DIAGNOSTIC — ${new Date(timestamp).toISOString()}`,
    '═══════════════════════════════════════════════════════════',
    '',
  ].join('\n');

  // Write log file
  const filename = `${timestamp}-exit.log`;
  const logPath = join(issueDir, filename);
  writeFileSync(logPath, logContent, 'utf-8');

  // Cleanup: keep only last MAX_DIAGNOSTIC_FILES
  cleanupDiagnostics(issueDir);

  return logPath;
}

/**
 * List diagnostic entries for an issue, sorted newest first.
 */
export function getDiagnostics(issueId: string, diagnosticsBase: string): DiagnosticEntry[] {
  const issueDir = join(diagnosticsBase, issueId);

  let files: string[];
  try {
    files = readdirSync(issueDir).filter((f) => f.endsWith('-exit.log'));
  } catch {
    return []; // Directory doesn't exist — no diagnostics
  }

  const entries: DiagnosticEntry[] = files
    .map((f) => {
      const match = f.match(/^(\d+)-exit\.log$/);
      if (!match) return null;
      const timestamp = parseInt(match[1], 10);
      return {
        exitCode: parseExitCodeFromFile(join(issueDir, f)),
        logFile: join(issueDir, f),
        timestamp,
      };
    })
    .filter((e): e is DiagnosticEntry => e !== null)
    .sort((a, b) => b.timestamp - a.timestamp); // newest first

  return entries;
}

/**
 * Read the full content of a diagnostic log file.
 */
export function readDiagnosticFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Parse exit code from a diagnostic log file.
 * Reads the header section to extract the exit code value.
 */
function parseExitCodeFromFile(filePath: string): number {
  try {
    // Only read first 500 bytes — exit code is in the header
    const content = readFileSync(filePath, 'utf-8').slice(0, 500);
    const match = content.match(/Exit Code:\s*(-?\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  } catch {
    return -1;
  }
}

/**
 * Remove old diagnostic files, keeping only the most recent ones.
 */
function cleanupDiagnostics(issueDir: string): void {
  let files: string[];
  try {
    files = readdirSync(issueDir)
      .filter((f) => f.endsWith('-exit.log'))
      .sort(); // Filenames are timestamp-based, so lexicographic sort = chronological
  } catch {
    return;
  }

  // Remove oldest files beyond the limit
  while (files.length > MAX_DIAGNOSTIC_FILES) {
    const oldest = files.shift()!;
    try {
      unlinkSync(join(issueDir, oldest));
    } catch {
      // Best effort — skip if file is already gone
    }
  }
}
