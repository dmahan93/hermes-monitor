import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../src/store.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Store', () => {
  let store: Store;
  let dbPath: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'hermes-test-'));
    dbPath = join(dir, 'test.db');
    store = new Store(dbPath);
  });

  afterEach(() => {
    store.close();
  });

  // ── Issue CRUD ──

  it('saves and loads an issue', () => {
    const issue = {
      id: 'test-1', title: 'Test', description: 'desc', status: 'todo' as const,
      agent: 'hermes', command: 'echo hi', terminalId: null, branch: null,
      parentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.saveIssue(issue);
    const loaded = store.loadIssues();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('test-1');
    expect(loaded[0].title).toBe('Test');
    expect(loaded[0].agent).toBe('hermes');
  });

  it('updates an existing issue', () => {
    const issue = {
      id: 'test-1', title: 'Old', description: '', status: 'todo' as const,
      agent: 'hermes', command: '', terminalId: null, branch: null,
      parentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.saveIssue(issue);
    issue.title = 'New';
    issue.status = 'in_progress';
    store.saveIssue(issue);
    const loaded = store.loadIssues();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe('New');
    expect(loaded[0].status).toBe('in_progress');
  });

  it('deletes an issue', () => {
    store.saveIssue({
      id: 'del-1', title: 'Delete me', description: '', status: 'todo',
      agent: 'hermes', command: '', terminalId: null, branch: null,
      parentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    expect(store.loadIssues()).toHaveLength(1);
    store.deleteIssue('del-1');
    expect(store.loadIssues()).toHaveLength(0);
  });

  it('resets in_progress issues to todo', () => {
    store.saveIssue({
      id: 'ip-1', title: 'WIP', description: '', status: 'in_progress',
      agent: 'hermes', command: '', terminalId: 'term-1', branch: 'b',
      parentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    store.saveIssue({
      id: 'rv-1', title: 'Reviewing', description: '', status: 'review',
      agent: 'hermes', command: '', terminalId: null, branch: 'b2',
      parentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    const result = store.resetStaleTerminals();
    expect(result).toEqual({ inProgress: 1, backlog: 0 });
    const issues = store.loadIssues();
    const wip = issues.find((i) => i.id === 'ip-1')!;
    expect(wip.status).toBe('todo');
    expect(wip.terminalId).toBeNull();
    const review = issues.find((i) => i.id === 'rv-1')!;
    expect(review.status).toBe('review'); // not reset
  });

  it('resetStaleTerminals clears backlog planning terminals', () => {
    store.saveIssue({
      id: 'bl-1', title: 'Planning', description: '', status: 'backlog',
      agent: 'hermes', command: '', terminalId: 'plan-term-1', branch: null,
      parentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    store.saveIssue({
      id: 'bl-2', title: 'No terminal', description: '', status: 'backlog',
      agent: 'hermes', command: '', terminalId: null, branch: null,
      parentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    store.resetStaleTerminals();
    const issues = store.loadIssues();
    const planned = issues.find((i) => i.id === 'bl-1')!;
    expect(planned.status).toBe('backlog'); // stays backlog
    expect(planned.terminalId).toBeNull(); // terminal ref cleared
    const noPlan = issues.find((i) => i.id === 'bl-2')!;
    expect(noPlan.terminalId).toBeNull(); // unchanged
  });

  it('saves and loads issue with parentId', () => {
    store.saveIssue({
      id: 'parent-1', title: 'Parent', description: '', status: 'todo',
      agent: 'hermes', command: '', terminalId: null, branch: null,
      parentId: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    store.saveIssue({
      id: 'sub-1', title: 'Subtask', description: 'child', status: 'backlog',
      agent: 'hermes', command: '', terminalId: null, branch: null,
      parentId: 'parent-1',
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    const loaded = store.loadIssues();
    expect(loaded).toHaveLength(2);
    const parent = loaded.find((i) => i.id === 'parent-1')!;
    expect(parent.parentId).toBeNull();
    const sub = loaded.find((i) => i.id === 'sub-1')!;
    expect(sub.parentId).toBe('parent-1');
  });

  it('parentId defaults to null when not set', () => {
    store.saveIssue({
      id: 'no-parent', title: 'No parent', description: '', status: 'todo',
      agent: 'hermes', command: '', terminalId: null, branch: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    } as any);
    const loaded = store.loadIssues();
    expect(loaded[0].parentId).toBeNull();
  });

  // ── PR CRUD ──

  it('saves and loads a PR with comments', () => {
    const pr = {
      id: 'pr-1', issueId: 'issue-1', title: 'Fix bug', description: '',
      submitterNotes: '',
      sourceBranch: 'issue/fix', targetBranch: 'main', repoPath: '/tmp',
      status: 'open' as const, diff: '+hello', changedFiles: ['a.ts'],
      verdict: 'pending' as const, reviewerTerminalId: null,
      comments: [{
        id: 'c-1', prId: 'pr-1', author: 'hermes-reviewer',
        body: 'Looks bad', createdAt: Date.now(),
      }],
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.savePR(pr);
    const loaded = store.loadPRs();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sourceBranch).toBe('issue/fix');
    expect(loaded[0].changedFiles).toEqual(['a.ts']);
    expect(loaded[0].comments).toHaveLength(1);
    expect(loaded[0].comments[0].body).toBe('Looks bad');
  });

  it('saves and loads submitterNotes on a PR', () => {
    const pr = {
      id: 'pr-notes', issueId: 'issue-notes', title: 'With notes', description: '',
      submitterNotes: 'I refactored auth and added edge case tests.',
      sourceBranch: 'issue/notes', targetBranch: 'main', repoPath: '/tmp',
      status: 'open' as const, diff: '', changedFiles: ['auth.ts'],
      verdict: 'pending' as const, reviewerTerminalId: null,
      comments: [],
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.savePR(pr);
    const loaded = store.loadPRs();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].submitterNotes).toBe('I refactored auth and added edge case tests.');
  });

  it('defaults submitterNotes to empty string when not set', () => {
    const pr = {
      id: 'pr-no-notes', issueId: 'issue-nn', title: 'No notes', description: '',
      submitterNotes: '',
      sourceBranch: 'issue/nn', targetBranch: 'main', repoPath: '/tmp',
      status: 'open' as const, diff: '', changedFiles: [],
      verdict: 'pending' as const, reviewerTerminalId: null,
      comments: [],
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.savePR(pr);
    const loaded = store.loadPRs();
    expect(loaded[0].submitterNotes).toBe('');
  });

  it('updates PR comments on re-save', () => {
    const pr = {
      id: 'pr-2', issueId: 'i-2', title: 'PR', description: '',
      submitterNotes: '',
      sourceBranch: 'b', targetBranch: 'main', repoPath: '/tmp',
      status: 'open' as const, diff: '', changedFiles: [],
      verdict: 'pending' as const, reviewerTerminalId: null,
      comments: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.savePR(pr);
    pr.comments.push({ id: 'c-new', prId: 'pr-2', author: 'human', body: 'LGTM', createdAt: Date.now() });
    pr.status = 'approved' as any;
    store.savePR(pr);
    const loaded = store.loadPRs();
    expect(loaded[0].comments).toHaveLength(1);
    expect(loaded[0].status).toBe('approved');
  });

  it('deletes a PR and its comments', () => {
    store.savePR({
      id: 'pr-del', issueId: 'i', title: 'Del', description: '',
      submitterNotes: '',
      sourceBranch: 'b', targetBranch: 'main', repoPath: '/tmp',
      status: 'open' as const, diff: '', changedFiles: [],
      verdict: 'pending' as const, reviewerTerminalId: null,
      comments: [{ id: 'c-x', prId: 'pr-del', author: 'bot', body: 'x', createdAt: Date.now() }],
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    store.deletePR('pr-del');
    expect(store.loadPRs()).toHaveLength(0);
  });

  // ── Persistence ──

  it('data survives close and reopen', () => {
    store.saveIssue({
      id: 'persist-1', title: 'Survives', description: '', status: 'todo',
      agent: 'claude', command: '', terminalId: null, branch: null,
      parentId: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    store.close();

    // Reopen
    const store2 = new Store(dbPath);
    const issues = store2.loadIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Survives');
    expect(issues[0].agent).toBe('claude');
    store2.close();

    // Reassign so afterEach doesn't double-close
    store = new Store(dbPath);
  });
});
