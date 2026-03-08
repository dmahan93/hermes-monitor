import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveDiagnostics, getDiagnostics, readDiagnosticFile } from '../src/diagnostics.js';

// Use a unique temp dir for each test run
let diagnosticsBase: string;

beforeEach(() => {
  diagnosticsBase = join(tmpdir(), `hermes-diag-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(diagnosticsBase, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(diagnosticsBase, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

describe('saveDiagnostics', () => {
  it('creates a diagnostic log file', () => {
    const logPath = saveDiagnostics({
      issueId: 'issue-123',
      issueTitle: 'Fix the widget',
      branch: 'issue/issue-123-fix-the-widget',
      exitCode: 1,
      scrollback: 'line 1\nline 2\nline 3\n',
      diagnosticsBase,
    });

    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('AGENT TERMINAL EXIT DIAGNOSTIC');
    expect(content).toContain('Fix the widget');
    expect(content).toContain('issue-123');
    expect(content).toContain('issue/issue-123-fix-the-widget');
    expect(content).toContain('Exit Code: 1');
    expect(content).toContain('line 1');
    expect(content).toContain('line 2');
    expect(content).toContain('line 3');
  });

  it('creates directory structure automatically', () => {
    const logPath = saveDiagnostics({
      issueId: 'new-issue',
      issueTitle: 'Brand new',
      branch: null,
      exitCode: 0,
      scrollback: 'output',
      diagnosticsBase,
    });

    expect(existsSync(logPath)).toBe(true);
    expect(logPath).toContain('new-issue');
  });

  it('handles null branch gracefully', () => {
    const logPath = saveDiagnostics({
      issueId: 'no-branch',
      issueTitle: 'No branch issue',
      branch: null,
      exitCode: 0,
      scrollback: '',
      diagnosticsBase,
    });

    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('Branch:    (none)');
  });

  it('handles empty scrollback', () => {
    const logPath = saveDiagnostics({
      issueId: 'empty-scroll',
      issueTitle: 'Empty',
      branch: null,
      exitCode: 137,
      scrollback: '',
      diagnosticsBase,
    });

    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('Exit Code: 137');
    expect(content).toContain('LAST');
  });

  it('strips ANSI escape codes from scrollback', () => {
    const ansiOutput = '\x1b[1m\x1b[31mError:\x1b[0m Something went wrong\n\x1b[32mHint:\x1b[0m Try again';
    const logPath = saveDiagnostics({
      issueId: 'ansi-test',
      issueTitle: 'ANSI test',
      branch: null,
      exitCode: 1,
      scrollback: ansiOutput,
      diagnosticsBase,
    });

    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('Error: Something went wrong');
    expect(content).toContain('Hint: Try again');
    // Should not contain raw ANSI sequences
    expect(content).not.toContain('\x1b[');
  });

  it('limits scrollback to last 100 lines', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
    const logPath = saveDiagnostics({
      issueId: 'long-scroll',
      issueTitle: 'Long scrollback',
      branch: null,
      exitCode: 0,
      scrollback: lines,
      diagnosticsBase,
    });

    const content = readFileSync(logPath, 'utf-8');
    // Should contain last 100 lines (101-200)
    expect(content).toContain('line 200');
    expect(content).toContain('line 101');
    // Should NOT contain early lines
    expect(content).not.toContain('line 1\n');
    expect(content).not.toContain('line 50\n');
  });

  it('keeps only 5 diagnostic files per issue', () => {
    const issueId = 'cleanup-test';

    // Create 7 diagnostic files
    for (let i = 0; i < 7; i++) {
      saveDiagnostics({
        issueId,
        issueTitle: `Attempt ${i + 1}`,
        branch: null,
        exitCode: i,
        scrollback: `output ${i + 1}`,
        diagnosticsBase,
      });
      // Small delay to ensure unique timestamps
      const start = Date.now();
      while (Date.now() === start) { /* spin */ }
    }

    const issueDir = join(diagnosticsBase, issueId);
    const files = readdirSync(issueDir).filter((f) => f.endsWith('-exit.log'));
    expect(files).toHaveLength(5);

    // The remaining files should be the 5 newest
    const sorted = files.sort();
    const lastContent = readFileSync(join(issueDir, sorted[sorted.length - 1]), 'utf-8');
    expect(lastContent).toContain('output 7');
  });

  it('uses timestamp in filename', () => {
    const before = Date.now();
    const logPath = saveDiagnostics({
      issueId: 'ts-test',
      issueTitle: 'Timestamp',
      branch: null,
      exitCode: 0,
      scrollback: '',
      diagnosticsBase,
    });
    const after = Date.now();

    const filename = logPath.split('/').pop()!;
    const match = filename.match(/^(\d+)-exit\.log$/);
    expect(match).not.toBeNull();
    const ts = parseInt(match![1], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe('getDiagnostics', () => {
  it('returns empty array when no diagnostics exist', () => {
    const entries = getDiagnostics('nonexistent-issue', diagnosticsBase);
    expect(entries).toEqual([]);
  });

  it('returns entries sorted newest first', () => {
    // Create a few diagnostic files
    saveDiagnostics({
      issueId: 'sort-test',
      issueTitle: 'First',
      branch: null,
      exitCode: 1,
      scrollback: 'first',
      diagnosticsBase,
    });
    // Ensure different timestamps
    const start = Date.now();
    while (Date.now() === start) { /* spin */ }

    saveDiagnostics({
      issueId: 'sort-test',
      issueTitle: 'Second',
      branch: null,
      exitCode: 2,
      scrollback: 'second',
      diagnosticsBase,
    });

    const entries = getDiagnostics('sort-test', diagnosticsBase);
    expect(entries).toHaveLength(2);
    // Newest first
    expect(entries[0].timestamp).toBeGreaterThan(entries[1].timestamp);
    expect(entries[0].exitCode).toBe(2);
    expect(entries[1].exitCode).toBe(1);
  });

  it('parses exit codes from log files', () => {
    saveDiagnostics({
      issueId: 'exitcode-test',
      issueTitle: 'Exit code check',
      branch: null,
      exitCode: 42,
      scrollback: '',
      diagnosticsBase,
    });

    const entries = getDiagnostics('exitcode-test', diagnosticsBase);
    expect(entries).toHaveLength(1);
    expect(entries[0].exitCode).toBe(42);
  });

  it('includes logFile path in entries', () => {
    saveDiagnostics({
      issueId: 'path-test',
      issueTitle: 'Path check',
      branch: null,
      exitCode: 0,
      scrollback: '',
      diagnosticsBase,
    });

    const entries = getDiagnostics('path-test', diagnosticsBase);
    expect(entries).toHaveLength(1);
    expect(entries[0].logFile).toContain('path-test');
    expect(entries[0].logFile).toContain('-exit.log');
    expect(existsSync(entries[0].logFile)).toBe(true);
  });

  it('ignores non-diagnostic files in directory', () => {
    saveDiagnostics({
      issueId: 'ignore-test',
      issueTitle: 'Ignore',
      branch: null,
      exitCode: 0,
      scrollback: '',
      diagnosticsBase,
    });

    // Drop a random file in the directory
    writeFileSync(join(diagnosticsBase, 'ignore-test', 'random.txt'), 'junk');

    const entries = getDiagnostics('ignore-test', diagnosticsBase);
    expect(entries).toHaveLength(1);
  });
});

describe('readDiagnosticFile', () => {
  it('reads content of a diagnostic file', () => {
    const logPath = saveDiagnostics({
      issueId: 'read-test',
      issueTitle: 'Read me',
      branch: 'feat/read',
      exitCode: 1,
      scrollback: 'hello from the terminal',
      diagnosticsBase,
    });

    const content = readDiagnosticFile(logPath);
    expect(content).not.toBeNull();
    expect(content).toContain('Read me');
    expect(content).toContain('hello from the terminal');
  });

  it('returns null for nonexistent file', () => {
    const content = readDiagnosticFile('/tmp/does-not-exist-12345.log');
    expect(content).toBeNull();
  });
});
