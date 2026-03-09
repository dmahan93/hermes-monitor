import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, existsSync, rmSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateTaskMd,
  generateAgentsMd,
  generateClaudeMd,
  generateSubmitScript,
  generateProgressScript,
  generateUploadScreenshotScript,
  writeTaskContext,
  updateTaskContext,
} from '../src/task-context.js';
import type { Issue } from '@hermes-monitor/shared/types';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'test-issue-123',
    title: 'Fix the widget',
    description: 'The widget is broken, please fix it.',
    status: 'in_progress',
    agent: 'hermes',
    command: '',
    terminalId: null,
    branch: 'issue/test-issue-fix-the-widget',
    parentId: null,
    reviewerModel: null,
    progressMessage: null,
    progressPercent: null,
    progressUpdatedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeMockPRManager(overrides: any = {}) {
  return {
    getByIssueId: vi.fn().mockReturnValue(overrides.pr ?? undefined),
    ...overrides,
  };
}

function makeMockWorktreeManager(overrides: any = {}) {
  return {
    getChangedFiles: vi.fn().mockReturnValue(overrides.changedFiles ?? []),
    ...overrides,
  };
}

describe('Task Context — TASK.md Generation', () => {
  const tmpDir = join(tmpdir(), 'task-ctx-test-' + process.pid);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates TASK.md with title, description, and branch', () => {
    const issue = makeIssue();
    const md = generateTaskMd({
      issue,
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(md).toContain('**Title:** Fix the widget');
    expect(md).toContain('**ID:** test-issue-123');
    expect(md).toContain('**Branch:** issue/test-issue-fix-the-widget');
    expect(md).toContain('The widget is broken, please fix it.');
  });

  it('includes instructions section', () => {
    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(md).toContain('## Instructions');
    expect(md).toContain('./.hermes-monitor/submit.sh');
    expect(md).toContain('git add -A && git commit');
  });

  it('includes API reference section', () => {
    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(md).toContain('## API Reference');
    expect(md).toContain('curl -s http://localhost:4000/agent/test-issue-123/info');
    expect(md).toContain('curl -s -X POST http://localhost:4000/agent/test-issue-123/review');
  });

  it('shows status as new task when no PR exists', () => {
    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      prManager: makeMockPRManager() as any,
      port: '4000',
    });

    expect(md).toContain('**Status:** New task');
    expect(md).not.toContain('REWORK');
  });

  it('shows rework status and feedback when PR has changes_requested', () => {
    const pr = {
      id: 'pr-1',
      issueId: 'test-issue-123',
      verdict: 'changes_requested',
      comments: [
        {
          id: 'c1',
          prId: 'pr-1',
          author: 'hermes-reviewer',
          body: 'VERDICT: CHANGES_REQUESTED\n\n- Fix the type error on line 42\n- Add unit tests for the edge case',
          file: null,
          line: null,
          createdAt: Date.now(),
        },
      ],
    };

    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      prManager: makeMockPRManager({ pr }) as any,
      port: '4000',
    });

    expect(md).toContain('REWORK REQUIRED');
    expect(md).toContain('Fix the type error on line 42');
    expect(md).toContain('Add unit tests for the edge case');
    expect(md).toContain('**Status:** REWORK');
  });

  it('includes action items from review feedback', () => {
    const pr = {
      id: 'pr-1',
      issueId: 'test-issue-123',
      verdict: 'changes_requested',
      comments: [
        {
          id: 'c1',
          prId: 'pr-1',
          author: 'hermes-reviewer',
          body: 'VERDICT: CHANGES_REQUESTED\n\n- Fix the type error on line 42\n- Add unit tests for the edge case\n* Update documentation',
          file: null,
          line: null,
          createdAt: Date.now(),
        },
      ],
    };

    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      prManager: makeMockPRManager({ pr }) as any,
      port: '4000',
    });

    expect(md).toContain('### Action Items');
    expect(md).toContain('- [ ] Fix the type error on line 42');
    expect(md).toContain('- [ ] Add unit tests for the edge case');
    expect(md).toContain('- [ ] Update documentation');
  });

  it('includes changed files section when files have been modified', () => {
    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      worktreeManager: makeMockWorktreeManager({ changedFiles: ['src/widget.ts', 'tests/widget.test.ts'] }) as any,
      port: '4000',
    });

    expect(md).toContain('## Already Changed Files');
    expect(md).toContain('- src/widget.ts');
    expect(md).toContain('- tests/widget.test.ts');
  });

  it('omits changed files section when no files changed', () => {
    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      worktreeManager: makeMockWorktreeManager({ changedFiles: [] }) as any,
      port: '4000',
    });

    expect(md).not.toContain('## Already Changed Files');
  });

  it('shows attempt number based on verdict comments', () => {
    const pr = {
      id: 'pr-1',
      issueId: 'test-issue-123',
      verdict: 'changes_requested',
      comments: [
        {
          id: 'c1', prId: 'pr-1', author: 'hermes-reviewer',
          body: 'VERDICT: CHANGES_REQUESTED\nFix stuff',
          file: null, line: null, createdAt: 1000,
        },
        {
          id: 'c2', prId: 'pr-1', author: 'hermes-reviewer',
          body: 'VERDICT: CHANGES_REQUESTED\nStill broken',
          file: null, line: null, createdAt: 2000,
        },
      ],
    };

    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      prManager: makeMockPRManager({ pr }) as any,
      port: '4000',
    });

    expect(md).toContain('**Attempt:** 3');
  });

  it('uses custom port in URLs', () => {
    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      port: '9999',
    });

    expect(md).toContain('http://localhost:9999/agent/test-issue-123');
  });

  it('handles issue with no description', () => {
    const md = generateTaskMd({
      issue: makeIssue({ description: '' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(md).toContain('(No description provided)');
  });

  it('includes previous reviews section when reviews exist', () => {
    const pr = {
      id: 'pr-1',
      issueId: 'test-issue-123',
      verdict: 'approved',
      comments: [
        {
          id: 'c1', prId: 'pr-1', author: 'hermes-reviewer',
          body: 'VERDICT: APPROVED\nLooks great!',
          file: null, line: null, createdAt: 1000,
        },
      ],
    };

    const md = generateTaskMd({
      issue: makeIssue(),
      worktreePath: tmpDir,
      prManager: makeMockPRManager({ pr }) as any,
      port: '4000',
    });

    expect(md).toContain('## Previous Reviews');
    expect(md).toContain('Looks great!');
  });
});

describe('Task Context — Agent-Native Context Files', () => {
  it('generates AGENTS.md referencing TASK.md', () => {
    const content = generateAgentsMd({
      issue: makeIssue(),
      worktreePath: '/tmp/test',
    });

    expect(content).toContain('TASK.md');
    expect(content).toContain('./.hermes-monitor/submit.sh');
    expect(content).toContain('./.hermes-monitor/progress.sh');
    expect(content).toContain('Do NOT stop after summarization');
  });

  it('generates CLAUDE.md referencing TASK.md', () => {
    const content = generateClaudeMd({
      issue: makeIssue({ agent: 'claude' }),
      worktreePath: '/tmp/test',
    });

    expect(content).toContain('TASK.md');
    expect(content).toContain('./.hermes-monitor/submit.sh');
    expect(content).toContain('Do NOT stop after summarization');
  });
});

describe('Task Context — Helper Scripts', () => {
  it('generates submit script with correct URL', () => {
    const script = generateSubmitScript('my-issue-id', '4000');

    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('http://localhost:4000/agent/my-issue-id');
    expect(script).toContain('/review');
    expect(script).toContain('--details');
    expect(script).toContain('--no-ui-changes');
  });

  it('generates progress script with correct URL', () => {
    const script = generateProgressScript('my-issue-id', '4000');

    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('http://localhost:4000/agent/my-issue-id');
    expect(script).toContain('/progress');
  });

  it('generates upload-screenshot script with correct URL', () => {
    const script = generateUploadScreenshotScript('my-issue-id', '4000');

    expect(script).toContain('#!/bin/bash');
    expect(script).toContain('http://localhost:4000/agent/my-issue-id');
    expect(script).toContain('/screenshots');
    expect(script).toContain('Content-Type');
  });

  it('uses custom port in helper scripts', () => {
    expect(generateSubmitScript('id', '5555')).toContain('localhost:5555');
    expect(generateProgressScript('id', '5555')).toContain('localhost:5555');
    expect(generateUploadScreenshotScript('id', '5555')).toContain('localhost:5555');
  });
});

describe('Task Context — writeTaskContext', () => {
  const tmpDir = join(tmpdir(), 'task-ctx-write-test-' + process.pid);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes TASK.md to worktree', () => {
    writeTaskContext({
      issue: makeIssue(),
      worktreePath: tmpDir,
      port: '4000',
    });

    const taskMd = readFileSync(join(tmpDir, 'TASK.md'), 'utf-8');
    expect(taskMd).toContain('# Task');
    expect(taskMd).toContain('Fix the widget');
  });

  it('writes AGENTS.md for hermes agent', () => {
    writeTaskContext({
      issue: makeIssue({ agent: 'hermes' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(true);
    const content = readFileSync(join(tmpDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('TASK.md');
  });

  it('writes AGENTS.md for codex agent', () => {
    writeTaskContext({
      issue: makeIssue({ agent: 'codex' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(true);
  });

  it('writes AGENTS.md for gemini agent', () => {
    writeTaskContext({
      issue: makeIssue({ agent: 'gemini' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(true);
  });

  it('writes CLAUDE.md for claude agent', () => {
    writeTaskContext({
      issue: makeIssue({ agent: 'claude' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(false);
  });

  it('does not write agent context file for shell agent', () => {
    writeTaskContext({
      issue: makeIssue({ agent: 'shell' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(false);
  });

  it('does not write agent context file for aider agent', () => {
    writeTaskContext({
      issue: makeIssue({ agent: 'aider' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(false);
  });

  it('does not overwrite existing AGENTS.md', () => {
    const existingContent = '# My existing AGENTS.md\nCustom rules here.';
    writeFileSync(join(tmpDir, 'AGENTS.md'), existingContent, 'utf-8');

    writeTaskContext({
      issue: makeIssue({ agent: 'hermes' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    const content = readFileSync(join(tmpDir, 'AGENTS.md'), 'utf-8');
    expect(content).toBe(existingContent);
  });

  it('does not overwrite existing CLAUDE.md', () => {
    const existingContent = '# My project Claude instructions';
    writeFileSync(join(tmpDir, 'CLAUDE.md'), existingContent, 'utf-8');

    writeTaskContext({
      issue: makeIssue({ agent: 'claude' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    const content = readFileSync(join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toBe(existingContent);
  });

  it('writes executable helper scripts', () => {
    writeTaskContext({
      issue: makeIssue(),
      worktreePath: tmpDir,
      port: '4000',
    });

    const scriptsDir = join(tmpDir, '.hermes-monitor');
    expect(existsSync(join(scriptsDir, 'submit.sh'))).toBe(true);
    expect(existsSync(join(scriptsDir, 'progress.sh'))).toBe(true);
    expect(existsSync(join(scriptsDir, 'upload-screenshot.sh'))).toBe(true);

    // Check executable permissions (owner execute bit)
    const submitStat = statSync(join(scriptsDir, 'submit.sh'));
    expect(submitStat.mode & 0o100).toBeTruthy();
  });

  it('helper scripts contain correct issue ID', () => {
    writeTaskContext({
      issue: makeIssue({ id: 'unique-id-42' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    const submit = readFileSync(join(tmpDir, '.hermes-monitor/submit.sh'), 'utf-8');
    expect(submit).toContain('unique-id-42');

    const progress = readFileSync(join(tmpDir, '.hermes-monitor/progress.sh'), 'utf-8');
    expect(progress).toContain('unique-id-42');

    const upload = readFileSync(join(tmpDir, '.hermes-monitor/upload-screenshot.sh'), 'utf-8');
    expect(upload).toContain('unique-id-42');
  });
});

describe('Task Context — updateTaskContext', () => {
  const tmpDir = join(tmpdir(), 'task-ctx-update-test-' + process.pid);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('overwrites TASK.md with fresh content', () => {
    // Write initial
    writeTaskContext({
      issue: makeIssue({ description: 'Initial description' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    let taskMd = readFileSync(join(tmpDir, 'TASK.md'), 'utf-8');
    expect(taskMd).toContain('Initial description');

    // Update with new description
    updateTaskContext({
      issue: makeIssue({ description: 'Updated description after rework' }),
      worktreePath: tmpDir,
      port: '4000',
    });

    taskMd = readFileSync(join(tmpDir, 'TASK.md'), 'utf-8');
    expect(taskMd).toContain('Updated description after rework');
    expect(taskMd).not.toContain('Initial description');
  });

  it('includes rework feedback after review cycle', () => {
    const pr = {
      id: 'pr-1',
      issueId: 'test-issue-123',
      verdict: 'changes_requested',
      comments: [
        {
          id: 'c1', prId: 'pr-1', author: 'hermes-reviewer',
          body: 'VERDICT: CHANGES_REQUESTED\n\n- Fix the null check on line 15',
          file: null, line: null, createdAt: Date.now(),
        },
      ],
    };

    updateTaskContext({
      issue: makeIssue(),
      worktreePath: tmpDir,
      prManager: makeMockPRManager({ pr }) as any,
      port: '4000',
    });

    const taskMd = readFileSync(join(tmpDir, 'TASK.md'), 'utf-8');
    expect(taskMd).toContain('REWORK REQUIRED');
    expect(taskMd).toContain('Fix the null check on line 15');
  });
});
