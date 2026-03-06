import { describe, it, expect, afterEach } from 'vitest';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';

describe('IssueManager', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;

  afterEach(() => {
    terminalManager?.killAll();
  });

  function setup() {
    terminalManager = new TerminalManager();
    issueManager = new IssueManager(terminalManager);
  }

  it('creates issue with defaults', () => {
    setup();
    const issue = issueManager.create({ title: 'Fix bug' });
    expect(issue.id).toBeTruthy();
    expect(issue.title).toBe('Fix bug');
    expect(issue.description).toBe('');
    expect(issue.status).toBe('todo');
    expect(issue.terminalId).toBeNull();
    expect(issue.branch).toBeNull();
    expect(issue.createdAt).toBeGreaterThan(0);
  });

  it('creates issue with custom fields', () => {
    setup();
    const issue = issueManager.create({
      title: 'Add feature',
      description: 'Implement the thing',
      command: 'echo "{{title}}"',
      branch: 'feat/thing',
    });
    expect(issue.description).toBe('Implement the thing');
    expect(issue.command).toBe('echo "{{title}}"');
    expect(issue.branch).toBe('feat/thing');
  });

  it('lists all issues', () => {
    setup();
    issueManager.create({ title: 'A' });
    issueManager.create({ title: 'B' });
    issueManager.create({ title: 'C' });
    expect(issueManager.list()).toHaveLength(3);
  });

  it('gets issue by id', () => {
    setup();
    const issue = issueManager.create({ title: 'Find me' });
    const found = issueManager.get(issue.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('Find me');
  });

  it('returns undefined for nonexistent issue', () => {
    setup();
    expect(issueManager.get('nope')).toBeUndefined();
  });

  it('updates issue fields', () => {
    setup();
    const issue = issueManager.create({ title: 'Old title' });
    const updated = issueManager.update(issue.id, {
      title: 'New title',
      description: 'Updated desc',
    });
    expect(updated!.title).toBe('New title');
    expect(updated!.description).toBe('Updated desc');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(issue.createdAt);
  });

  it('deletes issue', () => {
    setup();
    const issue = issueManager.create({ title: 'Delete me' });
    expect(issueManager.size).toBe(1);
    const deleted = issueManager.delete(issue.id);
    expect(deleted).toBe(true);
    expect(issueManager.size).toBe(0);
  });

  it('status change to in_progress spawns terminal', () => {
    setup();
    const issue = issueManager.create({ title: 'Agent task' });
    expect(issue.terminalId).toBeNull();
    expect(terminalManager.size).toBe(0);

    const updated = issueManager.changeStatus(issue.id, 'in_progress');
    expect(updated!.status).toBe('in_progress');
    expect(updated!.terminalId).toBeTruthy();
    expect(terminalManager.size).toBe(1);

    // Terminal should have the issue title
    const terminal = terminalManager.get(updated!.terminalId!);
    expect(terminal!.title).toBe('Agent task');
  });

  it('status change to done kills terminal', () => {
    setup();
    const issue = issueManager.create({ title: 'Task' });
    issueManager.changeStatus(issue.id, 'in_progress');
    expect(terminalManager.size).toBe(1);

    issueManager.changeStatus(issue.id, 'done');
    const updated = issueManager.get(issue.id);
    expect(updated!.terminalId).toBeNull();
    expect(terminalManager.size).toBe(0);
  });

  it('status change todo→in_progress→todo kills terminal', () => {
    setup();
    const issue = issueManager.create({ title: 'Bounce' });
    issueManager.changeStatus(issue.id, 'in_progress');
    expect(terminalManager.size).toBe(1);

    issueManager.changeStatus(issue.id, 'todo');
    const updated = issueManager.get(issue.id);
    expect(updated!.status).toBe('todo');
    expect(updated!.terminalId).toBeNull();
    expect(terminalManager.size).toBe(0);
  });

  it('in_progress→review keeps terminal alive', () => {
    setup();
    const issue = issueManager.create({ title: 'Review me' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const termId = issueManager.get(issue.id)!.terminalId;
    expect(termId).toBeTruthy();

    issueManager.changeStatus(issue.id, 'review');
    const updated = issueManager.get(issue.id);
    expect(updated!.terminalId).toBe(termId);
    expect(terminalManager.size).toBe(1);
  });

  it('command template variables are interpolated', () => {
    setup();
    const issue = issueManager.create({
      title: 'Fix login',
      description: 'The login page is broken',
      command: '/bin/echo "{{title}} - {{branch}}"',
      branch: 'fix/login',
    });

    const interpolated = issueManager.interpolateCommand(issue.command, issue);
    expect(interpolated).toBe('/bin/echo "Fix login - fix/login"');
  });

  it('deleting issue with active terminal kills it', () => {
    setup();
    const issue = issueManager.create({ title: 'Delete with term' });
    issueManager.changeStatus(issue.id, 'in_progress');
    expect(terminalManager.size).toBe(1);

    issueManager.delete(issue.id);
    expect(terminalManager.size).toBe(0);
  });

  it('emits events on create/update/delete', () => {
    setup();
    const events: string[] = [];
    issueManager.onEvent((event) => events.push(event));

    const issue = issueManager.create({ title: 'Event test' });
    issueManager.update(issue.id, { title: 'Updated' });
    issueManager.changeStatus(issue.id, 'in_progress');
    issueManager.delete(issue.id);

    expect(events).toEqual([
      'issue:created',
      'issue:updated',
      'issue:updated', // status change emits updated
      'issue:deleted',
    ]);
  });
});
