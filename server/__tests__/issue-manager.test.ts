import { describe, it, expect, afterEach, vi } from 'vitest';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';
import type { PRManager } from '../src/pr-manager.js';
import type { WorktreeManager } from '../src/worktree-manager.js';

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
    expect(mockPRManager.relaunchReview).toHaveBeenCalledWith('pr-123', undefined, undefined);
  });

  // ── Health check integration tests ──

  it('runs health check before spawning agent terminal on in_progress', () => {
    setup();

    const callOrder: string[] = [];

    const mockWorktreeManager = {
      create: vi.fn().mockImplementation(() => {
        callOrder.push('worktree.create');
        return { branch: 'issue/test-branch', path: '/tmp/test-wt', issueId: 'test' };
      }),
      healthCheck: vi.fn().mockImplementation(() => {
        callOrder.push('worktree.healthCheck');
        return { healthy: true, issues: [], fixes: [] };
      }),
      get: vi.fn(),
      remove: vi.fn(),
      getHealthCheck: vi.fn(),
    } as unknown as WorktreeManager;

    issueManager.setWorktreeManager(mockWorktreeManager);

    // Spy on terminal creation to track order
    const origCreate = terminalManager.create.bind(terminalManager);
    vi.spyOn(terminalManager, 'create').mockImplementation((opts) => {
      callOrder.push('terminal.create');
      return origCreate(opts);
    });

    const issue = issueManager.create({ title: 'Health check order test' });
    issueManager.changeStatus(issue.id, 'in_progress');

    // Verify health check was called
    expect(mockWorktreeManager.healthCheck).toHaveBeenCalledWith(issue.id);

    // Verify order: worktree.create → healthCheck → terminal.create
    expect(callOrder).toEqual(['worktree.create', 'worktree.healthCheck', 'terminal.create']);
  });

  it('health check failure does not prevent terminal spawn', () => {
    setup();

    const mockWorktreeManager = {
      create: vi.fn().mockReturnValue({
        branch: 'issue/test-branch', path: '/tmp/test-wt', issueId: 'test',
      }),
      healthCheck: vi.fn().mockReturnValue({
        healthy: false,
        issues: ['Worktree directory does not exist', 'Failed to recreate worktree'],
        fixes: [],
      }),
      get: vi.fn(),
      remove: vi.fn(),
      getHealthCheck: vi.fn(),
    } as unknown as WorktreeManager;

    issueManager.setWorktreeManager(mockWorktreeManager);

    const issue = issueManager.create({ title: 'Unhealthy workspace' });
    issueManager.changeStatus(issue.id, 'in_progress');

    // Terminal should still be spawned even if health check reports unhealthy
    expect(issue.terminalId).toBeTruthy();
    expect(terminalManager.size).toBe(1);
  });

  it('health check exception does not prevent terminal spawn', () => {
    setup();

    const mockWorktreeManager = {
      create: vi.fn().mockReturnValue({
        branch: 'issue/test-branch', path: '/tmp/test-wt', issueId: 'test',
      }),
      healthCheck: vi.fn().mockImplementation(() => {
        throw new Error('git command failed');
      }),
      get: vi.fn(),
      remove: vi.fn(),
      getHealthCheck: vi.fn(),
    } as unknown as WorktreeManager;

    issueManager.setWorktreeManager(mockWorktreeManager);

    const issue = issueManager.create({ title: 'Crash-proof health check' });
    issueManager.changeStatus(issue.id, 'in_progress');

    // Terminal should still be spawned despite health check throwing
    expect(issue.terminalId).toBeTruthy();
    expect(terminalManager.size).toBe(1);
  });

  it('health check logs fixes when present', () => {
    setup();

    const mockWorktreeManager = {
      create: vi.fn().mockReturnValue({
        branch: 'issue/test-branch', path: '/tmp/test-wt', issueId: 'test',
      }),
      healthCheck: vi.fn().mockReturnValue({
        healthy: true,
        issues: ['Wrong branch checked out: main (expected issue/test-branch)'],
        fixes: ['Checked out correct branch: issue/test-branch', 'Re-symlinked node_modules'],
      }),
      get: vi.fn(),
      remove: vi.fn(),
      getHealthCheck: vi.fn(),
    } as unknown as WorktreeManager;

    issueManager.setWorktreeManager(mockWorktreeManager);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const issue = issueManager.create({ title: 'Log fixes test' });
    issueManager.changeStatus(issue.id, 'in_progress');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[health-check] Fixed:')
    );
    consoleSpy.mockRestore();
  });

  it('updateTerminalId sets terminalId and emits event', () => {
    setup();
    const events: string[] = [];
    issueManager.onEvent((event) => events.push(event));
    const issue = issueManager.create({ title: 'Terminal sync test' });
    issueManager.updateTerminalId(issue.id, 'new-term-123');
    const updated = issueManager.get(issue.id);
    expect(updated!.terminalId).toBe('new-term-123');
    expect(events).toContain('issue:updated');
  });

  it('updateTerminalId can clear terminalId to null', () => {
    setup();
    const issue = issueManager.create({ title: 'Clear terminal test' });
    issueManager.updateTerminalId(issue.id, 'term-abc');
    expect(issueManager.get(issue.id)!.terminalId).toBe('term-abc');
    issueManager.updateTerminalId(issue.id, null);
    expect(issueManager.get(issue.id)!.terminalId).toBeNull();
  });

  it('updateTerminalId is no-op for nonexistent issue', () => {
    setup();
    const events: string[] = [];
    issueManager.onEvent((event) => events.push(event));
    issueManager.updateTerminalId('nonexistent', 'term-123');
    // Should not emit any events
    expect(events).toHaveLength(0);
  });

  it('in_progress→review sets issue.terminalId to reviewer terminal', () => {
    setup();
    const fakePr = { id: 'pr-review-term', issueId: '', reviewerTerminalId: null as string | null };
    const mockPRManager = {
      getByIssueId: vi.fn().mockReturnValue(undefined),
      create: vi.fn().mockReturnValue(fakePr),
      spawnReviewer: vi.fn().mockImplementation(() => {
        // Simulate what real spawnReviewer does: set PR terminal and call updateTerminalId
        fakePr.reviewerTerminalId = 'reviewer-term-42';
        issueManager.updateTerminalId(fakePr.issueId, 'reviewer-term-42');
      }),
      relaunchReview: vi.fn(),
      resetToOpen: vi.fn(),
    } as unknown as PRManager;

    issueManager.setPRManager(mockPRManager);
    const issue = issueManager.create({ title: 'Review terminal test' });
    fakePr.issueId = issue.id;

    issueManager.changeStatus(issue.id, 'in_progress');
    const termId = issueManager.get(issue.id)!.terminalId;
    expect(termId).toBeTruthy();

    issueManager.changeStatus(issue.id, 'review');
    const updated = issueManager.get(issue.id);
    // Issue should now point to the reviewer's terminal (set via updateTerminalId in spawnReviewer)
    expect(updated!.terminalId).toBe('reviewer-term-42');
  });

  it('review→in_progress with active reviewer kills reviewer and spawns coding terminal', () => {
    setup();

    // Create a real terminal to act as the "reviewer" terminal
    const reviewerTerminal = terminalManager.create({ title: 'Reviewer', command: 'sleep 60' });
    const reviewerTerminalId = reviewerTerminal.id;

    const fakePr = { id: 'pr-active-reviewer', issueId: '', reviewerTerminalId };
    const mockPRManager = {
      getByIssueId: vi.fn().mockReturnValue(undefined),
      create: vi.fn().mockReturnValue(fakePr),
      spawnReviewer: vi.fn().mockImplementation(() => {
        fakePr.reviewerTerminalId = reviewerTerminalId;
        issueManager.updateTerminalId(fakePr.issueId, reviewerTerminalId);
      }),
      relaunchReview: vi.fn(),
      resetToOpen: vi.fn(),
    } as unknown as PRManager;

    issueManager.setPRManager(mockPRManager);
    const issue = issueManager.create({ title: 'Active reviewer test' });
    fakePr.issueId = issue.id;

    // Move to in_progress → spawns coding terminal
    issueManager.changeStatus(issue.id, 'in_progress');
    const codingTermId = issueManager.get(issue.id)!.terminalId!;
    expect(codingTermId).toBeTruthy();

    // Move to review → kills coding terminal, spawnReviewer sets reviewer terminal
    issueManager.changeStatus(issue.id, 'review');
    expect(issueManager.get(issue.id)!.terminalId).toBe(reviewerTerminalId);

    // Now move back to in_progress WHILE reviewer terminal is still active.
    // The from=review cleanup block should kill the reviewer terminal and
    // clear issue.terminalId so a new coding terminal can be spawned.
    (mockPRManager.getByIssueId as ReturnType<typeof vi.fn>).mockReturnValue(fakePr);
    issueManager.changeStatus(issue.id, 'in_progress');

    const updated = issueManager.get(issue.id)!;
    // Should have a new coding terminal, not the reviewer terminal
    expect(updated.terminalId).toBeTruthy();
    expect(updated.terminalId).not.toBe(reviewerTerminalId);
    // Reviewer terminal should have been killed
    expect(terminalManager.get(reviewerTerminalId)).toBeUndefined();
    // resetToOpen should have been called to clear stale PR verdict
    expect(mockPRManager.resetToOpen).toHaveBeenCalledWith('pr-active-reviewer');
  });

  it('review→in_progress without active terminal still spawns coding terminal', () => {
    setup();

    // This tests the normal flow where the reviewer has already exited
    // and handleReviewerExit has cleared issue.terminalId
    const fakePr = { id: 'pr-no-reviewer', issueId: '', reviewerTerminalId: null as string | null };
    const mockPRManager = {
      getByIssueId: vi.fn().mockReturnValue(undefined),
      create: vi.fn().mockReturnValue(fakePr),
      spawnReviewer: vi.fn().mockImplementation(() => {
        fakePr.reviewerTerminalId = 'reviewer-term-done';
        issueManager.updateTerminalId(fakePr.issueId, 'reviewer-term-done');
      }),
      relaunchReview: vi.fn(),
      resetToOpen: vi.fn(),
    } as unknown as PRManager;

    issueManager.setPRManager(mockPRManager);
    const issue = issueManager.create({ title: 'Normal review exit test' });
    fakePr.issueId = issue.id;

    issueManager.changeStatus(issue.id, 'in_progress');
    issueManager.changeStatus(issue.id, 'review');

    // Simulate reviewer has exited and cleared the terminal reference
    issueManager.updateTerminalId(issue.id, null);

    // Move back to in_progress — should spawn coding terminal even though
    // issue.terminalId is already null
    (mockPRManager.getByIssueId as ReturnType<typeof vi.fn>).mockReturnValue(fakePr);
    issueManager.changeStatus(issue.id, 'in_progress');

    const updated = issueManager.get(issue.id)!;
    expect(updated.status).toBe('in_progress');
    expect(updated.terminalId).toBeTruthy();
  });

  it('in_progress→review→in_progress→review cycle (relaunchReview) updates terminalId', () => {
    setup();

    // Track terminal IDs assigned during each review cycle
    let reviewCycle = 0;
    const reviewerTerminalIds = ['reviewer-term-cycle-1', 'reviewer-term-cycle-2'];

    const fakePr = { id: 'pr-relaunch', issueId: '', reviewerTerminalId: null as string | null };
    const mockPRManager = {
      getByIssueId: vi.fn().mockReturnValue(undefined),
      create: vi.fn().mockReturnValue(fakePr),
      spawnReviewer: vi.fn().mockImplementation(() => {
        const termId = reviewerTerminalIds[reviewCycle];
        fakePr.reviewerTerminalId = termId;
        issueManager.updateTerminalId(fakePr.issueId, termId);
        reviewCycle++;
      }),
      relaunchReview: vi.fn().mockImplementation(() => {
        // Simulate what real relaunchReview does:
        // Kill old terminal, reset PR state, then call spawnReviewer (which calls updateTerminalId)
        fakePr.reviewerTerminalId = null;
        const termId = reviewerTerminalIds[reviewCycle];
        fakePr.reviewerTerminalId = termId;
        issueManager.updateTerminalId(fakePr.issueId, termId);
        reviewCycle++;
      }),
      resetToOpen: vi.fn(),
    } as unknown as PRManager;

    issueManager.setPRManager(mockPRManager);
    const issue = issueManager.create({ title: 'Relaunch cycle test' });
    fakePr.issueId = issue.id;

    // Cycle 1: in_progress → review (creates PR, spawns first reviewer)
    issueManager.changeStatus(issue.id, 'in_progress');
    issueManager.changeStatus(issue.id, 'review');
    expect(issueManager.get(issue.id)!.terminalId).toBe('reviewer-term-cycle-1');
    expect(mockPRManager.spawnReviewer).toHaveBeenCalledTimes(1);

    // Simulate reviewer has exited and cleared the terminal reference
    issueManager.updateTerminalId(issue.id, null);

    // Back to in_progress (user sends back for changes)
    (mockPRManager.getByIssueId as ReturnType<typeof vi.fn>).mockReturnValue(fakePr);
    issueManager.changeStatus(issue.id, 'in_progress');
    const codingTermId = issueManager.get(issue.id)!.terminalId!;
    expect(codingTermId).toBeTruthy();

    // Cycle 2: in_progress → review again (PR already exists, calls relaunchReview)
    issueManager.changeStatus(issue.id, 'review');
    expect(issueManager.get(issue.id)!.terminalId).toBe('reviewer-term-cycle-2');
    expect(mockPRManager.relaunchReview).toHaveBeenCalledTimes(1);
    // spawnReviewer should NOT be called again (relaunchReview handles spawning internally)
    expect(mockPRManager.spawnReviewer).toHaveBeenCalledTimes(1);
  });

  it('review→done with active reviewer kills reviewer terminal', () => {
    setup();

    const reviewerTerminal = terminalManager.create({ title: 'Reviewer', command: 'sleep 60' });
    const reviewerTerminalId = reviewerTerminal.id;

    const fakePr = { id: 'pr-review-done', issueId: '', reviewerTerminalId };
    const mockPRManager = {
      getByIssueId: vi.fn().mockReturnValue(undefined),
      create: vi.fn().mockReturnValue(fakePr),
      spawnReviewer: vi.fn().mockImplementation(() => {
        fakePr.reviewerTerminalId = reviewerTerminalId;
        issueManager.updateTerminalId(fakePr.issueId, reviewerTerminalId);
      }),
      relaunchReview: vi.fn(),
      resetToOpen: vi.fn(),
    } as unknown as PRManager;

    issueManager.setPRManager(mockPRManager);
    const issue = issueManager.create({ title: 'Review to done test' });
    fakePr.issueId = issue.id;

    issueManager.changeStatus(issue.id, 'in_progress');
    issueManager.changeStatus(issue.id, 'review');
    expect(issueManager.get(issue.id)!.terminalId).toBe(reviewerTerminalId);

    // Move directly to done — should kill the reviewer terminal
    issueManager.changeStatus(issue.id, 'done');
    const updated = issueManager.get(issue.id)!;
    expect(updated.status).toBe('done');
    expect(updated.terminalId).toBeNull();
    expect(terminalManager.get(reviewerTerminalId)).toBeUndefined();
  });
});
