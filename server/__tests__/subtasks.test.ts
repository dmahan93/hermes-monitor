import { describe, it, expect, afterEach, vi } from 'vitest';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';

describe('Subtasks', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;

  afterEach(() => {
    terminalManager?.killAll();
  });

  function setup() {
    terminalManager = new TerminalManager();
    issueManager = new IssueManager(terminalManager);
  }

  // ── Creating subtasks ──

  it('creates a subtask linked to parent', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent issue' });
    const sub = issueManager.create({ title: 'Subtask 1', parentId: parent.id });

    expect(sub.parentId).toBe(parent.id);
    expect(sub.title).toBe('Subtask 1');
    expect(sub.status).toBe('backlog');
  });

  it('throws when creating subtask with nonexistent parent', () => {
    setup();
    expect(() => {
      issueManager.create({ title: 'Orphan', parentId: 'nonexistent-id' });
    }).toThrow('Parent issue nonexistent-id not found');
  });

  it('creates a subtask with all options', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent' });
    const sub = issueManager.create({
      title: 'Subtask with desc',
      description: 'Sub description',
      agent: 'claude',
      parentId: parent.id,
    });

    expect(sub.parentId).toBe(parent.id);
    expect(sub.description).toBe('Sub description');
    expect(sub.agent).toBe('claude');
  });

  it('parentId is null for regular issues', () => {
    setup();
    const issue = issueManager.create({ title: 'Regular issue' });
    expect(issue.parentId).toBeNull();
  });

  // ── Querying subtasks ──

  it('getSubtasks returns subtasks of a parent', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent' });
    issueManager.create({ title: 'Sub 1', parentId: parent.id });
    issueManager.create({ title: 'Sub 2', parentId: parent.id });
    issueManager.create({ title: 'Unrelated' });

    const subtasks = issueManager.getSubtasks(parent.id);
    expect(subtasks).toHaveLength(2);
    expect(subtasks.map((s) => s.title).sort()).toEqual(['Sub 1', 'Sub 2']);
  });

  it('getSubtasks returns empty array when no subtasks', () => {
    setup();
    const parent = issueManager.create({ title: 'No subs' });
    expect(issueManager.getSubtasks(parent.id)).toHaveLength(0);
  });

  it('getParent returns parent issue', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent' });
    const sub = issueManager.create({ title: 'Sub', parentId: parent.id });

    const retrieved = issueManager.getParent(sub.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(parent.id);
    expect(retrieved!.title).toBe('Parent');
  });

  it('getParent returns undefined for root issues', () => {
    setup();
    const issue = issueManager.create({ title: 'Root' });
    expect(issueManager.getParent(issue.id)).toBeUndefined();
  });

  it('getParent returns undefined for nonexistent issue', () => {
    setup();
    expect(issueManager.getParent('nope')).toBeUndefined();
  });

  // ── Subtask lifecycle ──

  it('subtasks have independent status', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent' });
    const sub1 = issueManager.create({ title: 'Sub 1', parentId: parent.id });
    const sub2 = issueManager.create({ title: 'Sub 2', parentId: parent.id });

    issueManager.changeStatus(sub1.id, 'in_progress');
    issueManager.changeStatus(sub2.id, 'done');

    expect(issueManager.get(sub1.id)!.status).toBe('in_progress');
    expect(issueManager.get(sub2.id)!.status).toBe('done');
    expect(issueManager.get(parent.id)!.status).toBe('backlog'); // parent unchanged
  });

  it('subtask gets own terminal when moved to in_progress', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent' });
    const sub = issueManager.create({ title: 'Sub', parentId: parent.id });

    issueManager.changeStatus(sub.id, 'in_progress');
    expect(issueManager.get(sub.id)!.terminalId).toBeTruthy();
    expect(terminalManager.size).toBe(1);
  });

  // ── Cascade delete ──

  it('deleting parent cascades to subtasks', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent' });
    const sub1 = issueManager.create({ title: 'Sub 1', parentId: parent.id });
    const sub2 = issueManager.create({ title: 'Sub 2', parentId: parent.id });
    expect(issueManager.size).toBe(3);

    issueManager.delete(parent.id);
    expect(issueManager.size).toBe(0);
    expect(issueManager.get(sub1.id)).toBeUndefined();
    expect(issueManager.get(sub2.id)).toBeUndefined();
  });

  it('cascade delete kills subtask terminals', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent' });
    const sub = issueManager.create({ title: 'Sub', parentId: parent.id });
    issueManager.changeStatus(sub.id, 'in_progress');
    expect(terminalManager.size).toBe(1);

    issueManager.delete(parent.id);
    expect(terminalManager.size).toBe(0);
  });

  it('deleting subtask does not delete parent', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent' });
    const sub = issueManager.create({ title: 'Sub', parentId: parent.id });

    issueManager.delete(sub.id);
    expect(issueManager.size).toBe(1);
    expect(issueManager.get(parent.id)).toBeDefined();
    expect(issueManager.getSubtasks(parent.id)).toHaveLength(0);
  });

  // ── Events ──

  it('emits events for subtask operations', () => {
    setup();
    const events: Array<{ event: string; issueId: string }> = [];
    issueManager.onEvent((event, issue) => events.push({ event, issueId: issue.id }));

    const parent = issueManager.create({ title: 'Parent' });
    const sub = issueManager.create({ title: 'Sub', parentId: parent.id });
    issueManager.changeStatus(sub.id, 'in_progress');
    issueManager.delete(sub.id);

    expect(events.map((e) => e.event)).toEqual([
      'issue:created',   // parent
      'issue:created',   // subtask
      'issue:updated',   // subtask status change
      'issue:deleted',   // subtask delete
    ]);

    // Verify the subtask events reference the correct issue
    expect(events[1].issueId).toBe(sub.id);
    expect(events[2].issueId).toBe(sub.id);
    expect(events[3].issueId).toBe(sub.id);
  });

  it('cascade delete emits events for each subtask', () => {
    setup();
    const events: Array<{ event: string; issueId: string }> = [];

    const parent = issueManager.create({ title: 'Parent' });
    const sub1 = issueManager.create({ title: 'Sub 1', parentId: parent.id });
    const sub2 = issueManager.create({ title: 'Sub 2', parentId: parent.id });

    // Start recording after creation
    issueManager.onEvent((event, issue) => events.push({ event, issueId: issue.id }));

    issueManager.delete(parent.id);

    // Should get delete events for both subtasks + parent
    const deleteEvents = events.filter((e) => e.event === 'issue:deleted');
    expect(deleteEvents).toHaveLength(3); // sub1, sub2, parent
    expect(deleteEvents.map((e) => e.issueId)).toContain(sub1.id);
    expect(deleteEvents.map((e) => e.issueId)).toContain(sub2.id);
    expect(deleteEvents.map((e) => e.issueId)).toContain(parent.id);
  });

  // ── list() includes subtasks ──

  it('list returns both parent and subtask issues', () => {
    setup();
    const parent = issueManager.create({ title: 'Parent' });
    issueManager.create({ title: 'Sub', parentId: parent.id });

    const all = issueManager.list();
    expect(all).toHaveLength(2);
    expect(all.some((i) => i.parentId === parent.id)).toBe(true);
    expect(all.some((i) => i.parentId === null)).toBe(true);
  });
});
