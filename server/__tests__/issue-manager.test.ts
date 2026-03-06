import { describe, it, expect, afterEach, vi } from 'vitest';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';
import type { PRManager } from '../src/pr-manager.js';

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
    expect(issue.agent).toBe('hermes');
    expect(issue.command).toContain('hermes');
    expect(issue.terminalId).toBeNull();
    expect(issue.branch).toBeNull();
    expect(issue.createdAt).toBeGreaterThan(0);
  });

  it('creates issue with custom agent', () => {
    setup();
    const issue = issueManager.create({
      title: 'Add feature',
      description: 'Implement the thing',
      agent: 'claude',
      branch: 'feat/thing',
    });
    expect(issue.agent).toBe('claude');
    expect(issue.command).toContain('claude');
    expect(issue.description).toBe('Implement the thing');
    expect(issue.branch).toBe('feat/thing');
  });

  it('creates issue with custom command override', () => {
    setup();
    const issue = issueManager.create({
      title: 'Custom task',
      agent: 'custom',
      command: 'my-agent --task "{{title}}"',
    });
    expect(issue.agent).toBe('custom');
    expect(issue.command).toBe('my-agent --task "{{title}}"');
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
      agent: 'custom',
      command: '/bin/echo "{{title}} - {{branch}}"',
      branch: 'fix/login',
    });

    const interpolated = issueManager.interpolateCommand(issue.command, issue);
    expect(interpolated).toBe('/bin/echo "Fix login - fix/login"');
  });

  it('command template escapes single quotes in values', () => {
    setup();
    const issue = issueManager.create({
      title: "Don't break things",
      description: "It's broken",
      agent: 'custom',
      command: "echo '{{title}}: {{description}}'",
    });

    const interpolated = issueManager.interpolateCommand(issue.command, issue);
    // Single quotes in values get escaped as '\'' (end quote, escaped quote, start quote)
    expect(interpolated).toContain("Don'\\''t");
    expect(interpolated).toContain("It'\\''s");
    // Result should be valid bash: echo 'Don'\''t break things: It'\''s broken'
    expect(interpolated).toBe("echo 'Don'\\''t break things: It'\\''s broken'");
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

  it('review→in_progress→review relaunches review on existing PR', () => {
    setup();

    const fakePr = { id: 'pr-123', issueId: '' };
    const mockPRManager = {
      getByIssueId: vi.fn(),
      create: vi.fn().mockReturnValue(fakePr),
      spawnReviewer: vi.fn(),
      relaunchReview: vi.fn(),
      resetToOpen: vi.fn(),
    } as unknown as PRManager;

    issueManager.setPRManager(mockPRManager);

    const issue = issueManager.create({ title: 'Review cycle test' });
    fakePr.issueId = issue.id;

    // First cycle: todo → in_progress → review (creates PR + spawns reviewer)
    issueManager.changeStatus(issue.id, 'in_progress');
    // Kill terminal so ticket-api path is simulated (it kills terminal before changeStatus)
    const termId = issueManager.get(issue.id)!.terminalId;
    if (termId) terminalManager.kill(termId);
    issueManager.get(issue.id)!.terminalId = null;

    // First time going to review — no existing PR
    (mockPRManager.getByIssueId as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    issueManager.changeStatus(issue.id, 'review');

    expect(mockPRManager.create).toHaveBeenCalledTimes(1);
    expect(mockPRManager.spawnReviewer).toHaveBeenCalledWith('pr-123');
    expect(mockPRManager.relaunchReview).not.toHaveBeenCalled();

    // Second cycle: review → in_progress (resets PR) → review (relaunches review)
    (mockPRManager.getByIssueId as ReturnType<typeof vi.fn>).mockReturnValue(fakePr);
    issueManager.changeStatus(issue.id, 'in_progress');
    // Moving back to in_progress should reset the PR's verdict/status
    expect(mockPRManager.resetToOpen).toHaveBeenCalledWith('pr-123');
    const termId2 = issueManager.get(issue.id)!.terminalId;
    if (termId2) terminalManager.kill(termId2);
    issueManager.get(issue.id)!.terminalId = null;

    // Second time going to review — PR already exists
    (mockPRManager.getByIssueId as ReturnType<typeof vi.fn>).mockReturnValue(fakePr);
    issueManager.changeStatus(issue.id, 'review');

    // Should NOT create a new PR, should relaunch review instead
    expect(mockPRManager.create).toHaveBeenCalledTimes(1); // still 1
    expect(mockPRManager.relaunchReview).toHaveBeenCalledWith('pr-123');
  });
});
