import { describe, it, expect, afterEach, vi } from 'vitest';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';
import type { PRManager } from '../src/pr-manager.js';

describe('IssueManager', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;

  afterEach(() => {
    issueManager?.clearResumeTimers();
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
    expect(issue.status).toBe('backlog');
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

  it('status change backlog→in_progress→todo kills terminal', () => {
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

  it('in_progress→review kills agent terminal', () => {
    setup();
    const issue = issueManager.create({ title: 'Review me' });
    issueManager.changeStatus(issue.id, 'in_progress');
    const termId = issueManager.get(issue.id)!.terminalId;
    expect(termId).toBeTruthy();

    issueManager.changeStatus(issue.id, 'review');
    const updated = issueManager.get(issue.id);
    expect(updated!.terminalId).toBeNull();
    expect(terminalManager.size).toBe(0);
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

  // ── Planning terminal tests ──

  it('startPlanning spawns terminal for backlog issue', () => {
    setup();
    const issue = issueManager.create({ title: 'Plan this' });
    expect(issue.status).toBe('backlog');
    expect(issue.terminalId).toBeNull();

    const planned = issueManager.startPlanning(issue.id);
    expect(planned).toBeDefined();
    expect(planned!.terminalId).toBeTruthy();
    expect(terminalManager.size).toBe(1);

    const terminal = terminalManager.get(planned!.terminalId!);
    expect(terminal!.title).toBe('[plan] Plan this');
  });

  it('startPlanning returns undefined for non-backlog issue', () => {
    setup();
    const issue = issueManager.create({ title: 'Not backlog' });
    issueManager.changeStatus(issue.id, 'todo');
    expect(issueManager.startPlanning(issue.id)).toBeUndefined();
  });

  it('startPlanning is idempotent', () => {
    setup();
    const issue = issueManager.create({ title: 'Idempotent' });
    const first = issueManager.startPlanning(issue.id);
    const second = issueManager.startPlanning(issue.id);
    expect(first!.terminalId).toBe(second!.terminalId);
    expect(terminalManager.size).toBe(1);
  });

  it('stopPlanning kills planning terminal', () => {
    setup();
    const issue = issueManager.create({ title: 'Stop plan' });
    issueManager.startPlanning(issue.id);
    expect(terminalManager.size).toBe(1);

    const stopped = issueManager.stopPlanning(issue.id);
    expect(stopped!.terminalId).toBeNull();
    expect(terminalManager.size).toBe(0);
  });

  it('moving backlog→todo kills planning terminal', () => {
    setup();
    const issue = issueManager.create({ title: 'Promote' });
    issueManager.startPlanning(issue.id);
    expect(terminalManager.size).toBe(1);

    issueManager.changeStatus(issue.id, 'todo');
    const updated = issueManager.get(issue.id);
    expect(updated!.status).toBe('todo');
    expect(updated!.terminalId).toBeNull();
    expect(terminalManager.size).toBe(0);
  });

  it('moving backlog→in_progress kills planning terminal and spawns agent terminal', () => {
    setup();
    const issue = issueManager.create({ title: 'Skip to WIP' });
    issueManager.startPlanning(issue.id);
    const planTermId = issueManager.get(issue.id)!.terminalId;
    expect(planTermId).toBeTruthy();

    issueManager.changeStatus(issue.id, 'in_progress');
    const updated = issueManager.get(issue.id);
    expect(updated!.status).toBe('in_progress');
    expect(updated!.terminalId).toBeTruthy();
    expect(updated!.terminalId).not.toBe(planTermId); // new terminal, not the planning one
    expect(terminalManager.size).toBe(1); // planning killed, agent spawned
  });

  // ── Auto-resume tests ──

  /** Helper: wait for a condition to become true */
  const waitFor = async (pred: () => boolean, ms = 10000) => {
    const start = Date.now();
    while (!pred() && Date.now() - start < ms) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!pred()) throw new Error('Timed out waiting for condition');
  };

  it('auto-resume: respawns terminal when agent exits naturally', async () => {
    setup();
    issueManager.setupAutoResume();
    issueManager.setResumeDelay(100); // 100ms for fast tests

    // Create issue with a command that exits immediately
    const issue = issueManager.create({
      title: 'Fast exit task',
      agent: 'custom',
      command: '/bin/true',
    });

    // Move to in_progress — spawns terminal
    issueManager.changeStatus(issue.id, 'in_progress');
    const originalTermId = issueManager.get(issue.id)!.terminalId;
    expect(originalTermId).toBeTruthy();

    // Wait for process exit + resume delay
    await waitFor(() => {
      const current = issueManager.get(issue.id)!;
      return current.terminalId !== originalTermId && current.terminalId !== null;
    }, 5000);

    const updated = issueManager.get(issue.id)!;
    expect(updated.status).toBe('in_progress');
    expect(updated.terminalId).toBeTruthy();
    expect(updated.terminalId).not.toBe(originalTermId);
  });

  it('auto-resume: does NOT resume when terminal is killed intentionally', async () => {
    setup();
    issueManager.setupAutoResume();
    issueManager.setResumeDelay(100);

    const issue = issueManager.create({
      title: 'Kill test',
      agent: 'custom',
      command: 'sleep 60',
    });

    issueManager.changeStatus(issue.id, 'in_progress');
    const termId = issueManager.get(issue.id)!.terminalId!;

    // Simulate what agent-api does on review: kill terminal, clear ref, change status.
    // Direct mutation of issue.terminalId is intentional — create() returns the internal
    // object reference, so this mirrors how agent-api clears the terminal ref before
    // changing status. If create() ever returns a copy, this pattern would need a
    // dedicated clearTerminalRef(issueId) method.
    terminalManager.kill(termId);
    issue.terminalId = null;
    issueManager.changeStatus(issue.id, 'review');

    // Wait a bit — should NOT resume
    await new Promise((r) => setTimeout(r, 500));

    const updated = issueManager.get(issue.id)!;
    expect(updated.status).toBe('review');
    // Terminal should be null (from the status change to review, which doesn't spawn one
    // since there's no PR manager)
    expect(updated.terminalId).toBeNull();
  });

  it('auto-resume: does NOT resume when status changes during delay', async () => {
    setup();
    issueManager.setupAutoResume();
    issueManager.setResumeDelay(500); // longer delay to give us time to change status

    const issue = issueManager.create({
      title: 'Status change during delay',
      agent: 'custom',
      command: '/bin/true', // exits immediately
    });

    issueManager.changeStatus(issue.id, 'in_progress');

    // Wait for the process to exit (triggers auto-resume timer)
    await new Promise((r) => setTimeout(r, 300));

    // Move to todo during the delay — should cancel the resume
    issueManager.changeStatus(issue.id, 'todo');

    // Wait past the resume delay
    await new Promise((r) => setTimeout(r, 500));

    const updated = issueManager.get(issue.id)!;
    expect(updated.status).toBe('todo');
    expect(updated.terminalId).toBeNull();
  });

  it('auto-resume: stops after MAX_RESUME_ATTEMPTS', async () => {
    setup();
    issueManager.setupAutoResume();
    issueManager.setResumeDelay(100);

    const issue = issueManager.create({
      title: 'Retry limit test',
      agent: 'custom',
      command: '/bin/true', // exits immediately every time
    });

    issueManager.changeStatus(issue.id, 'in_progress');

    // Each cycle: process exits → 100ms delay → resume → process exits again
    // Should stop after 3 resumes (MAX_RESUME_ATTEMPTS)
    // Give it enough time for all cycles
    let lastTermId = issueManager.get(issue.id)!.terminalId;

    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => {
        const current = issueManager.get(issue.id)!;
        return current.terminalId !== lastTermId && current.terminalId !== null;
      }, 5000);
      lastTermId = issueManager.get(issue.id)!.terminalId;
    }

    // After 3 resumes, the 4th exit should NOT trigger a resume
    // Wait for the current terminal to exit and the resume to NOT happen
    await new Promise((r) => setTimeout(r, 1500));

    // The issue should still be in_progress but its terminal may be exited
    const final = issueManager.get(issue.id)!;
    expect(final.status).toBe('in_progress');
    // terminalId still points to the last (exited) terminal — no new one spawned
    expect(final.terminalId).toBe(lastTermId);
  });

  it('auto-resume: resets attempt counter on status change', async () => {
    setup();
    issueManager.setupAutoResume();
    issueManager.setResumeDelay(100);

    const issue = issueManager.create({
      title: 'Reset attempts test',
      agent: 'custom',
      command: '/bin/true',
    });

    // First cycle
    issueManager.changeStatus(issue.id, 'in_progress');
    const firstTermId = issueManager.get(issue.id)!.terminalId;

    // Wait for first auto-resume
    await waitFor(() => {
      const current = issueManager.get(issue.id)!;
      return current.terminalId !== firstTermId && current.terminalId !== null;
    }, 5000);

    // Move back to todo (resets resume counter)
    issueManager.changeStatus(issue.id, 'todo');

    // Move back to in_progress (fresh start, fresh retries)
    issueManager.changeStatus(issue.id, 'in_progress');
    const newTermId = issueManager.get(issue.id)!.terminalId;
    expect(newTermId).toBeTruthy();

    // Should be able to auto-resume again (counter was reset)
    await waitFor(() => {
      const current = issueManager.get(issue.id)!;
      return current.terminalId !== newTermId && current.terminalId !== null;
    }, 5000);

    const updated = issueManager.get(issue.id)!;
    expect(updated.terminalId).toBeTruthy();
    expect(updated.terminalId).not.toBe(newTermId);
  });

  it('auto-resume: resets attempt counter after sliding window expires', async () => {
    setup();
    issueManager.setupAutoResume();
    issueManager.setResumeDelay(100);
    // Use a tiny window so we can test expiry without waiting 5 minutes
    issueManager.setResumeWindow(300);

    const issue = issueManager.create({
      title: 'Window reset test',
      agent: 'custom',
      command: '/bin/true', // exits immediately
    });

    issueManager.changeStatus(issue.id, 'in_progress');

    // Wait for all 3 resume attempts to be exhausted
    let lastTermId = issueManager.get(issue.id)!.terminalId;
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitFor(() => {
        const current = issueManager.get(issue.id)!;
        return current.terminalId !== lastTermId && current.terminalId !== null;
      }, 5000);
      lastTermId = issueManager.get(issue.id)!.terminalId;
    }

    // Max attempts reached — wait for the last terminal to exit
    await new Promise((r) => setTimeout(r, 300));
    const staleTermId = issueManager.get(issue.id)!.terminalId;

    // Now wait longer than the sliding window (300ms) so the counter resets
    await new Promise((r) => setTimeout(r, 400));

    // Manually kill the stale terminal and spawn a new one to trigger
    // another natural exit — the window should have reset the counter
    if (staleTermId) {
      // Kill the old exited terminal to clean up
      terminalManager.kill(staleTermId);
    }

    // Spawn a new terminal that will exit immediately
    const terminal = terminalManager.create({
      title: issue.title,
      command: '/bin/true',
    });
    // Update issue to point to this terminal (simulating a fresh spawn)
    // This direct mutation simulates what performResume does internally
    issue.terminalId = terminal.id;

    // Wait for the auto-resume to fire — if the window reset worked,
    // the counter is back to 0 and this exit will trigger a resume
    await waitFor(() => {
      const current = issueManager.get(issue.id)!;
      return current.terminalId !== terminal.id && current.terminalId !== null;
    }, 5000);

    const updated = issueManager.get(issue.id)!;
    expect(updated.terminalId).toBeTruthy();
    expect(updated.terminalId).not.toBe(terminal.id);
  });

  it('auto-resume: emits issue:updated event on resume', async () => {
    setup();
    issueManager.setupAutoResume();
    issueManager.setResumeDelay(100);

    const events: string[] = [];
    issueManager.onEvent((event) => events.push(event));

    const issue = issueManager.create({
      title: 'Event test',
      agent: 'custom',
      command: '/bin/true',
    });

    issueManager.changeStatus(issue.id, 'in_progress');
    const originalTermId = issueManager.get(issue.id)!.terminalId;

    // Wait for auto-resume
    await waitFor(() => {
      const current = issueManager.get(issue.id)!;
      return current.terminalId !== originalTermId && current.terminalId !== null;
    }, 5000);

    // Should have emitted: created, updated (status change), updated (auto-resume)
    expect(events).toContain('issue:updated');
    expect(events.filter((e) => e === 'issue:updated').length).toBeGreaterThanOrEqual(2);
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
    // Kill terminal so agent-api path is simulated (it kills terminal before changeStatus).
    // Direct mutation of terminalId is intentional — see comment in "does NOT resume" test.
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
    expect(mockPRManager.relaunchReview).toHaveBeenCalledWith('pr-123', undefined);
  });
});
