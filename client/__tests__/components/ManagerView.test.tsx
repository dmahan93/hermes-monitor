import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ManagerView } from '../../src/components/ManagerView';
import type { Issue, PullRequest, AgentPreset, IssueStatus, PRStatus, Verdict, ServerMessage } from '../../src/types';

// Mock TerminalView to avoid xterm dependency in tests
vi.mock('../../src/components/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid="terminal-view" data-terminal-id={terminalId}>
      Mock Terminal: {terminalId}
    </div>
  ),
}));

// ── Factories ──

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    title: overrides.title || 'Test Issue',
    description: '',
    status: 'in_progress' as IssueStatus,
    agent: 'hermes',
    command: '',
    terminalId: overrides.terminalId ?? 'term-1',
    branch: 'feature-1',
    parentId: null,
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000,
    ...overrides,
  };
}

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    issueId: overrides.issueId || 'issue-1',
    title: overrides.title || 'Test PR',
    description: '',
    submitterNotes: '',
    sourceBranch: 'feature',
    targetBranch: 'main',
    repoPath: '/repo',
    status: 'open' as PRStatus,
    diff: '',
    changedFiles: ['file.ts'],
    verdict: 'pending' as Verdict,
    reviewerTerminalId: null,
    comments: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

const AGENTS: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚡', command: '', planningCommand: '', description: '' },
  { id: 'claude', name: 'Claude', icon: '🤖', command: '', planningCommand: '', description: '' },
];

function defaultProps() {
  return {
    issues: [] as Issue[],
    prs: [] as PullRequest[],
    agents: AGENTS,
    onStatusChange: vi.fn().mockResolvedValue(null),
    onMerge: vi.fn().mockResolvedValue({}),
    onRelaunchReview: vi.fn().mockResolvedValue(undefined),
    onViewTerminal: vi.fn(),
    onViewPR: vi.fn(),
    send: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    reconnectCount: 0,
  };
}

// ── Tests ──

describe('ManagerView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Stats Bar ──

  describe('Stats Bar', () => {
    it('shows ticket counts', () => {
      const props = defaultProps();
      props.issues = [
        makeIssue({ status: 'done' }),
        makeIssue({ status: 'done' }),
        makeIssue({ status: 'in_progress' }),
        makeIssue({ status: 'todo' }),
      ];
      render(<ManagerView {...props} />);
      // done/total (excludes backlog)
      expect(screen.getByText('2/4')).toBeInTheDocument();
    });

    it('shows active agent count', () => {
      const props = defaultProps();
      props.issues = [
        makeIssue({ status: 'in_progress', terminalId: 'term-1' }),
        makeIssue({ status: 'in_progress', terminalId: 'term-2' }),
      ];
      render(<ManagerView {...props} />);
      // Active count
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('shows crashed agent count when crashed agents exist', () => {
      const props = defaultProps();
      props.issues = [
        makeIssue({ status: 'in_progress', terminalId: null }),
      ];
      render(<ManagerView {...props} />);
      expect(screen.getByText('CRASHED')).toBeInTheDocument();
    });

    it('hides crashed stat when no crashed agents', () => {
      const props = defaultProps();
      props.issues = [
        makeIssue({ status: 'in_progress', terminalId: 'term-1' }),
      ];
      render(<ManagerView {...props} />);
      expect(screen.queryByText('CRASHED')).not.toBeInTheDocument();
    });

    it('shows PRs awaiting merge', () => {
      const props = defaultProps();
      props.prs = [
        makePR({ verdict: 'approved', status: 'reviewing' }),
        makePR({ verdict: 'approved', status: 'reviewing' }),
      ];
      render(<ManagerView {...props} />);
      expect(screen.getByText('AWAIT MERGE')).toBeInTheDocument();
    });
  });

  // ── Agent Status Dashboard ──

  describe('Agent Status Dashboard', () => {
    it('shows empty state when no active agents', () => {
      const props = defaultProps();
      render(<ManagerView {...props} />);
      expect(screen.getByText('No active agents.')).toBeInTheDocument();
    });

    it('renders cards for in_progress issues', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ title: 'Working Agent', status: 'in_progress', terminalId: 'term-1' })];
      render(<ManagerView {...props} />);
      expect(screen.getByText('Working Agent')).toBeInTheDocument();
    });

    it('renders cards for review issues', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ title: 'Review Agent', status: 'review', terminalId: 'term-2' })];
      render(<ManagerView {...props} />);
      expect(screen.getByText('Review Agent')).toBeInTheDocument();
    });

    it('does not render cards for todo/done/backlog issues', () => {
      const props = defaultProps();
      props.issues = [
        makeIssue({ title: 'Todo Issue', status: 'todo' }),
        makeIssue({ title: 'Done Issue', status: 'done' }),
        makeIssue({ title: 'Backlog Issue', status: 'backlog' }),
      ];
      render(<ManagerView {...props} />);
      expect(screen.queryByText('Todo Issue')).not.toBeInTheDocument();
      expect(screen.queryByText('Done Issue')).not.toBeInTheDocument();
      expect(screen.queryByText('Backlog Issue')).not.toBeInTheDocument();
    });

    it('shows agent name from preset', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ agent: 'claude', status: 'in_progress' })];
      render(<ManagerView {...props} />);
      expect(screen.getByText('Claude')).toBeInTheDocument();
    });

    it('shows agent icon from preset', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ agent: 'hermes', status: 'in_progress' })];
      render(<ManagerView {...props} />);
      expect(screen.getByText('⚡')).toBeInTheDocument();
    });

    it('applies working class for in_progress with terminal', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ status: 'in_progress', terminalId: 'term-1' })];
      const { container } = render(<ManagerView {...props} />);
      expect(container.querySelector('.manager-card-working')).not.toBeNull();
    });

    it('applies crashed class for in_progress without terminal', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ status: 'in_progress', terminalId: null })];
      const { container } = render(<ManagerView {...props} />);
      expect(container.querySelector('.manager-card-crashed')).not.toBeNull();
    });

    it('applies review class for review status', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ status: 'review', terminalId: 'term-1' })];
      const { container } = render(<ManagerView {...props} />);
      expect(container.querySelector('.manager-card-review')).not.toBeNull();
    });

    it('shows progress message when present', () => {
      const props = defaultProps();
      props.issues = [makeIssue({
        status: 'in_progress',
        terminalId: 'term-1',
        progressMessage: 'Running tests...',
      })];
      render(<ManagerView {...props} />);
      expect(screen.getByText('Running tests...')).toBeInTheDocument();
    });

    it('shows progress percent with message when present', () => {
      const props = defaultProps();
      props.issues = [makeIssue({
        status: 'in_progress',
        terminalId: 'term-1',
        progressMessage: 'Building project',
        progressPercent: 42,
      })];
      render(<ManagerView {...props} />);
      expect(screen.getByText(/\[42%\] Building project/)).toBeInTheDocument();
    });

    it('does not show progress when progressMessage is null', () => {
      const props = defaultProps();
      props.issues = [makeIssue({
        status: 'in_progress',
        terminalId: 'term-1',
        progressMessage: null,
      })];
      const { container } = render(<ManagerView {...props} />);
      expect(container.querySelector('.manager-card-progress')).toBeNull();
    });
  });

  // ── Quick Actions ──

  describe('Quick Actions', () => {
    it('Kill button calls onStatusChange with todo', async () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'in_progress', terminalId: 'term-1' })];
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('KILL'));
      await waitFor(() => {
        expect(props.onStatusChange).toHaveBeenCalledWith('issue-1', 'todo');
      });
    });

    it('Restart button calls onStatusChange with in_progress', async () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'in_progress', terminalId: null })];
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('RESTART'));
      await waitFor(() => {
        expect(props.onStatusChange).toHaveBeenCalledWith('issue-1', 'in_progress');
      });
    });

    it('Terminal button calls onViewTerminal', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'in_progress', terminalId: 'term-1' })];
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('TERMINAL'));
      expect(props.onViewTerminal).toHaveBeenCalledWith('issue-1');
    });

    it('PR button calls onViewPR when PR exists', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'review', terminalId: 'term-1' })];
      props.prs = [makePR({ issueId: 'issue-1' })];
      render(<ManagerView {...props} />);
      // There should be a PR button on the card
      const prButtons = screen.getAllByText('PR');
      fireEvent.click(prButtons[0]);
      expect(props.onViewPR).toHaveBeenCalled();
    });

    it('shows error when Kill fails', async () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'in_progress', terminalId: 'term-1' })];
      props.onStatusChange.mockResolvedValue('Agent busy');
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('KILL'));
      await waitFor(() => {
        expect(screen.getByText(/Agent busy/)).toBeInTheDocument();
      });
    });

    it('shows Restart button on review cards', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'review', terminalId: 'term-1' })];
      render(<ManagerView {...props} />);
      expect(screen.getByText('RESTART')).toBeInTheDocument();
    });

    it('does not show Kill button for review status', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ status: 'review', terminalId: 'term-1' })];
      render(<ManagerView {...props} />);
      expect(screen.queryByText('KILL')).not.toBeInTheDocument();
    });

    it('does not show Terminal button when no terminalId', () => {
      const props = defaultProps();
      props.issues = [makeIssue({ status: 'in_progress', terminalId: null })];
      render(<ManagerView {...props} />);
      expect(screen.queryByText('TERMINAL')).not.toBeInTheDocument();
    });
  });

  // ── PR Review Queue ──

  describe('PR Review Queue', () => {
    it('shows empty state when no PRs awaiting action', () => {
      const props = defaultProps();
      render(<ManagerView {...props} />);
      expect(screen.getByText('No PRs awaiting action.')).toBeInTheDocument();
    });

    it('shows approved PRs with merge button', () => {
      const props = defaultProps();
      props.prs = [makePR({ title: 'Approved Feature', verdict: 'approved', status: 'reviewing' })];
      render(<ManagerView {...props} />);
      expect(screen.getByText('Approved Feature')).toBeInTheDocument();
      expect(screen.getByText('MERGE')).toBeInTheDocument();
    });

    it('shows changes_requested PRs with send back button', () => {
      const props = defaultProps();
      props.prs = [makePR({ title: 'Needs Changes', verdict: 'changes_requested', status: 'reviewing' })];
      render(<ManagerView {...props} />);
      expect(screen.getByText('Needs Changes')).toBeInTheDocument();
      expect(screen.getByText('SEND BACK')).toBeInTheDocument();
    });

    it('does not show merged PRs in queue', () => {
      const props = defaultProps();
      props.prs = [makePR({ title: 'Already Merged', verdict: 'approved', status: 'merged' })];
      render(<ManagerView {...props} />);
      expect(screen.queryByText('Already Merged')).not.toBeInTheDocument();
    });

    it('does not show pending verdict PRs in queue', () => {
      const props = defaultProps();
      props.prs = [makePR({ title: 'Pending Review', verdict: 'pending', status: 'reviewing' })];
      render(<ManagerView {...props} />);
      expect(screen.queryByText('Pending Review')).not.toBeInTheDocument();
    });

    it('merge button calls onMerge', async () => {
      const props = defaultProps();
      props.prs = [makePR({ id: 'pr-1', verdict: 'approved', status: 'reviewing' })];
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MERGE'));
      await waitFor(() => {
        expect(props.onMerge).toHaveBeenCalledWith('pr-1');
      });
    });

    it('send back button moves issue to in_progress', async () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'review' })];
      props.prs = [makePR({ id: 'pr-1', issueId: 'issue-1', verdict: 'changes_requested', status: 'reviewing' })];
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('SEND BACK'));
      await waitFor(() => {
        expect(props.onStatusChange).toHaveBeenCalledWith('issue-1', 'in_progress');
      });
    });

    it('shows MERGING text while merge is in progress', async () => {
      const mergePromise = new Promise<{ error?: string }>(() => {}); // Never resolves
      const props = defaultProps();
      props.prs = [makePR({ id: 'pr-1', verdict: 'approved', status: 'reviewing' })];
      props.onMerge.mockReturnValue(mergePromise);
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MERGE'));
      await waitFor(() => {
        expect(screen.getByText('MERGING…')).toBeInTheDocument();
      });
    });
  });

  // ── Batch Actions ──

  describe('Batch Actions', () => {
    it('Merge All Approved is disabled when no approved PRs', () => {
      const props = defaultProps();
      render(<ManagerView {...props} />);
      const btn = screen.getByText(/MERGE ALL APPROVED/);
      expect(btn).toBeDisabled();
    });

    it('Merge All Approved is enabled when approved PRs exist', () => {
      const props = defaultProps();
      props.prs = [makePR({ verdict: 'approved', status: 'reviewing' })];
      render(<ManagerView {...props} />);
      const btn = screen.getByText(/MERGE ALL APPROVED/);
      expect(btn).not.toBeDisabled();
    });

    it('Merge All Approved calls onMerge for each approved PR', async () => {
      const props = defaultProps();
      props.prs = [
        makePR({ id: 'pr-1', verdict: 'approved', status: 'reviewing' }),
        makePR({ id: 'pr-2', verdict: 'approved', status: 'reviewing' }),
      ];
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText(/MERGE ALL APPROVED/));
      await waitFor(() => {
        expect(props.onMerge).toHaveBeenCalledWith('pr-1');
        expect(props.onMerge).toHaveBeenCalledWith('pr-2');
      });
    });

    it('Restart All Crashed is disabled when no crashed agents', () => {
      const props = defaultProps();
      render(<ManagerView {...props} />);
      const btn = screen.getByText(/RESTART ALL CRASHED/);
      expect(btn).toBeDisabled();
    });

    it('Restart All Crashed calls onStatusChange for crashed agents', async () => {
      const props = defaultProps();
      props.issues = [
        makeIssue({ id: 'issue-1', status: 'in_progress', terminalId: null }),
      ];
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText(/RESTART ALL CRASHED/));
      await waitFor(() => {
        // Should move to todo first, then in_progress
        expect(props.onStatusChange).toHaveBeenCalledWith('issue-1', 'todo');
        expect(props.onStatusChange).toHaveBeenCalledWith('issue-1', 'in_progress');
      });
    });

    it('Restart All Crashed stops if first onStatusChange (to todo) fails', async () => {
      const props = defaultProps();
      props.issues = [
        makeIssue({ id: 'issue-1', title: 'Crashed Agent', status: 'in_progress', terminalId: null }),
      ];
      // First call (to 'todo') fails
      props.onStatusChange.mockResolvedValueOnce('Cannot move to todo');
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText(/RESTART ALL CRASHED/));
      await waitFor(() => {
        expect(props.onStatusChange).toHaveBeenCalledWith('issue-1', 'todo');
        expect(screen.getByText(/Cannot move to todo/)).toBeInTheDocument();
      });
      // Should NOT have called the second onStatusChange (to in_progress)
      expect(props.onStatusChange).toHaveBeenCalledTimes(1);
    });

    it('Relaunch Dead Reviewers is disabled when no dead reviewers', () => {
      const props = defaultProps();
      render(<ManagerView {...props} />);
      const btn = screen.getByText(/RELAUNCH DEAD REVIEWERS/);
      expect(btn).toBeDisabled();
    });

    it('Relaunch Dead Reviewers calls onRelaunchReview for dead reviewers', async () => {
      const props = defaultProps();
      props.prs = [
        makePR({ id: 'pr-1', status: 'reviewing', reviewerTerminalId: null }),
      ];
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText(/RELAUNCH DEAD REVIEWERS/));
      await waitFor(() => {
        expect(props.onRelaunchReview).toHaveBeenCalledWith('pr-1');
      });
    });

    it('Relaunch Dead Reviewers count excludes PRs with active reviewers', () => {
      const props = defaultProps();
      props.prs = [
        makePR({ id: 'pr-1', status: 'reviewing', reviewerTerminalId: 'term-r1' }),
        makePR({ id: 'pr-2', status: 'reviewing', reviewerTerminalId: null }),
      ];
      render(<ManagerView {...props} />);
      expect(screen.getByText(/RELAUNCH DEAD REVIEWERS \(1\)/)).toBeInTheDocument();
    });

    it('Relaunch Dead Reviewers does not count open PRs without reviewerTerminalId', () => {
      const props = defaultProps();
      props.prs = [
        makePR({ id: 'pr-1', status: 'open', reviewerTerminalId: null }),
        makePR({ id: 'pr-2', status: 'open', reviewerTerminalId: null }),
      ];
      render(<ManagerView {...props} />);
      expect(screen.getByText(/RELAUNCH DEAD REVIEWERS \(0\)/)).toBeInTheDocument();
    });
  });

  // ── Terminal Preview ──

  describe('Terminal Preview', () => {
    it('subscribes to WebSocket for terminal output', () => {
      const subscribeFn = vi.fn(() => vi.fn());
      const props = defaultProps();
      props.issues = [makeIssue({ status: 'in_progress', terminalId: 'term-1' })];
      props.subscribe = subscribeFn;
      render(<ManagerView {...props} />);
      expect(subscribeFn).toHaveBeenCalled();
    });

    it('requests replay for terminal on mount', () => {
      const sendFn = vi.fn();
      const props = defaultProps();
      props.issues = [makeIssue({ status: 'in_progress', terminalId: 'term-1' })];
      props.send = sendFn;
      render(<ManagerView {...props} />);
      expect(sendFn).toHaveBeenCalledWith({ type: 'replay', terminalId: 'term-1' });
    });

    it('shows terminal output when stdout messages arrive', () => {
      let handler: ((msg: ServerMessage) => void) | null = null;
      const subscribeFn = vi.fn((h: (msg: ServerMessage) => void) => {
        handler = h;
        return vi.fn();
      });
      const props = defaultProps();
      props.issues = [makeIssue({ status: 'in_progress', terminalId: 'term-1' })];
      props.subscribe = subscribeFn;
      render(<ManagerView {...props} />);

      // Simulate stdout message
      act(() => {
        handler?.({ type: 'stdout', terminalId: 'term-1', data: 'Hello world\n' } as ServerMessage);
      });

      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });
  });

  // ── Reconnect Behavior ──

  describe('Reconnect', () => {
    it('re-replays all terminals after WebSocket reconnect', () => {
      const sendFn = vi.fn();
      const props = defaultProps();
      props.issues = [makeIssue({ status: 'in_progress', terminalId: 'term-1' })];
      props.send = sendFn;

      const { rerender } = render(<ManagerView {...props} />);
      expect(sendFn).toHaveBeenCalledWith({ type: 'replay', terminalId: 'term-1' });
      expect(sendFn).toHaveBeenCalledTimes(1);

      // Simulate reconnect by bumping reconnectCount
      sendFn.mockClear();
      rerender(<ManagerView {...props} reconnectCount={1} />);
      expect(sendFn).toHaveBeenCalledWith({ type: 'replay', terminalId: 'term-1' });
    });
  });

  // ── Exception Handling ──

  describe('Exception Handling', () => {
    it('catches rejected promise in handleKill and shows error', async () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'in_progress', terminalId: 'term-1' })];
      props.onStatusChange.mockRejectedValue(new Error('Network failure'));
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('KILL'));
      await waitFor(() => {
        expect(screen.getByText(/Network failure/)).toBeInTheDocument();
      });
    });

    it('catches rejected promise in handleMerge and shows error', async () => {
      const props = defaultProps();
      props.prs = [makePR({ id: 'pr-1', verdict: 'approved', status: 'reviewing' })];
      props.onMerge.mockRejectedValue(new Error('Merge conflict'));
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MERGE'));
      await waitFor(() => {
        expect(screen.getByText(/Merge conflict/)).toBeInTheDocument();
      });
    });

    it('catches rejected promise in handleRestart and shows error', async () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'in_progress', terminalId: null })];
      props.onStatusChange.mockRejectedValue(new Error('Spawn error'));
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('RESTART'));
      await waitFor(() => {
        expect(screen.getByText(/Spawn error/)).toBeInTheDocument();
      });
    });

    it('catches rejected promise in batch merge all approved', async () => {
      const props = defaultProps();
      props.prs = [makePR({ id: 'pr-1', verdict: 'approved', status: 'reviewing' })];
      props.onMerge.mockRejectedValue(new Error('Batch merge failed'));
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText(/MERGE ALL APPROVED/));
      await waitFor(() => {
        expect(screen.getByText(/Batch merge failed/)).toBeInTheDocument();
      });
    });

    it('catches rejected promise in handleRelaunchDeadReviewers', async () => {
      const props = defaultProps();
      props.prs = [makePR({ id: 'pr-1', status: 'reviewing', reviewerTerminalId: null })];
      props.onRelaunchReview.mockRejectedValue(new Error('Relaunch failed'));
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText(/RELAUNCH DEAD REVIEWERS/));
      await waitFor(() => {
        expect(screen.getByText(/Relaunch failed/)).toBeInTheDocument();
      });
    });
  });

  // ── Error Display ──

  describe('Error Display', () => {
    it('shows merge error when merge fails', async () => {
      const props = defaultProps();
      props.prs = [makePR({ id: 'pr-1', verdict: 'approved', status: 'reviewing' })];
      props.onMerge.mockResolvedValue({ error: 'Conflict detected' });
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MERGE'));
      await waitFor(() => {
        expect(screen.getByText(/Conflict detected/)).toBeInTheDocument();
      });
    });

    it('dismisses error on click', async () => {
      const props = defaultProps();
      props.issues = [makeIssue({ id: 'issue-1', status: 'in_progress', terminalId: 'term-1' })];
      props.onStatusChange.mockResolvedValue('Some error');
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('KILL'));
      await waitFor(() => {
        expect(screen.getByText(/Some error/)).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText(/Some error/));
      expect(screen.queryByText(/Some error/)).not.toBeInTheDocument();
    });
  });

  // ── View Button ──

  describe('View actions', () => {
    it('VIEW button on PR calls onViewPR', () => {
      const props = defaultProps();
      props.prs = [makePR({ verdict: 'approved', status: 'reviewing' })];
      render(<ManagerView {...props} />);
      const viewButtons = screen.getAllByText('VIEW');
      fireEvent.click(viewButtons[0]);
      expect(props.onViewPR).toHaveBeenCalled();
    });
  });

  // ── Manager Terminal ──

  describe('Manager Terminal', () => {
    it('shows MANAGER TERMINAL toggle button', () => {
      const props = defaultProps();
      render(<ManagerView {...props} />);
      expect(screen.getByText('MANAGER TERMINAL')).toBeInTheDocument();
    });

    it('terminal pane is collapsed by default', () => {
      const props = defaultProps();
      const { container } = render(<ManagerView {...props} />);
      expect(container.querySelector('.manager-terminal-toolbar')).toBeNull();
      expect(container.querySelector('.manager-terminal-pane')).toBeNull();
    });

    it('clicking toggle expands the terminal section', async () => {
      // Mock fetch for terminal creation
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-1', title: 'Manager Terminal' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      const { container } = render(<ManagerView {...props} />);

      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(container.querySelector('.manager-terminal-toolbar')).not.toBeNull();
      });
    });

    it('creates terminal with title Manager Terminal on first open', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-1' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        const postCalls = fetchSpy.mock.calls.filter(([url, opts]) => {
          const urlStr = typeof url === 'string' ? url : url.toString();
          return urlStr.includes('/terminals') && opts?.method === 'POST';
        });
        expect(postCalls.length).toBe(1);
        const body = JSON.parse(postCalls[0][1]?.body as string);
        expect(body.title).toBe('Manager Terminal');
        expect(body.cwd).toBe('/test/repo');
      });
    });

    it('persists terminal ID in localStorage', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-persist' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(localStorage.getItem('hermes:managerTerminalId')).toBe('mgr-term-persist');
      });
    });

    it('restores terminal from localStorage if it still exists', async () => {
      localStorage.setItem('hermes:managerTerminalId', 'existing-term');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([{ id: 'existing-term', title: 'Manager Terminal' }]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
        expect(screen.getByTestId('terminal-view').getAttribute('data-terminal-id')).toBe('existing-term');
      });

      // Should NOT have called POST to create a new terminal
      const postCalls = fetchSpy.mock.calls.filter(([, opts]) => opts?.method === 'POST');
      expect(postCalls.length).toBe(0);
    });

    it('creates new terminal if saved terminal no longer exists', async () => {
      localStorage.setItem('hermes:managerTerminalId', 'stale-term');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'new-term' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          // Return empty — stale-term doesn't exist
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(localStorage.getItem('hermes:managerTerminalId')).toBe('new-term');
      });
    });

    it('renders TerminalView with correct terminal ID when open', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-view' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        const termView = screen.getByTestId('terminal-view');
        expect(termView).toBeInTheDocument();
        expect(termView.getAttribute('data-terminal-id')).toBe('mgr-term-view');
      });
    });

    it('shows quick action buttons when terminal is open', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-1' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(screen.getByTitle('Check status of all issues, PRs, and terminals')).toBeInTheDocument();
        expect(screen.getByTitle('Merge all approved PRs via CLI')).toBeInTheDocument();
        expect(screen.getByTitle('Restart all crashed agents via CLI')).toBeInTheDocument();
      });
    });

    it('CHECK STATUS button sends stdin to terminal', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-stdin' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const sendFn = vi.fn();
      const props = defaultProps();
      props.send = sendFn;
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Check status of all issues, PRs, and terminals'));

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stdin',
          terminalId: 'mgr-term-stdin',
          data: expect.stringContaining('ISSUES'),
        }),
      );
    });

    it('MERGE ALL button sends stdin to terminal', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-merge' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const sendFn = vi.fn();
      const props = defaultProps();
      props.send = sendFn;
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Merge all approved PRs via CLI'));

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stdin',
          terminalId: 'mgr-term-merge',
          data: expect.stringContaining('merge'),
        }),
      );
    });

    it('RESTART CRASHED button sends stdin to terminal', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-restart' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const sendFn = vi.fn();
      const props = defaultProps();
      props.send = sendFn;
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle('Restart all crashed agents via CLI'));

      expect(sendFn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'stdin',
          terminalId: 'mgr-term-restart',
          data: expect.stringContaining('Restarting'),
        }),
      );
    });

    it('shows spawning status while terminal is being created', async () => {
      let resolveCreate: (value: Response) => void;
      const createPromise = new Promise<Response>((resolve) => { resolveCreate = resolve; });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return createPromise;
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(screen.getByText('spawning…')).toBeInTheDocument();
      });

      // Resolve the creation
      act(() => {
        resolveCreate!(new Response(JSON.stringify({ id: 'mgr-new' }), { status: 201 }));
      });

      await waitFor(() => {
        expect(screen.queryByText('spawning…')).not.toBeInTheDocument();
      });
    });

    it('shows error and retry when terminal creation fails', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response('{}', { status: 500 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(screen.getByText('Failed to create terminal')).toBeInTheDocument();
        expect(screen.getByText('[RETRY]')).toBeInTheDocument();
      });
    });

    it('clears terminal ID from localStorage when terminal is removed', async () => {
      localStorage.setItem('hermes:managerTerminalId', 'doomed-term');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([{ id: 'doomed-term', title: 'Manager Terminal' }]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      let subscribedHandler: ((msg: ServerMessage) => void) | null = null;
      const subscribeFn = vi.fn((handler: (msg: ServerMessage) => void) => {
        subscribedHandler = handler;
        return vi.fn();
      });

      const props = defaultProps();
      props.subscribe = subscribeFn;
      render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
      });

      // Simulate terminal removal message
      act(() => {
        subscribedHandler?.({ type: 'terminal:removed', terminalId: 'doomed-term' } as ServerMessage);
      });

      expect(localStorage.getItem('hermes:managerTerminalId')).toBeNull();
    });

    it('shows resize handle when terminal is open', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-1' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      const { container } = render(<ManagerView {...props} />);
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      await waitFor(() => {
        expect(container.querySelector('.manager-terminal-resize-handle')).not.toBeNull();
      });
    });

    it('collapsing terminal hides the terminal pane', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('/config')) {
          return new Response(JSON.stringify({ repoPath: '/test/repo', serverPort: 4000 }), { status: 200 });
        }
        if (urlStr.includes('/terminals') && opts?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'mgr-term-1' }), { status: 201 });
        }
        if (urlStr.includes('/terminals')) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });

      const props = defaultProps();
      const { container } = render(<ManagerView {...props} />);

      // Open
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));
      await waitFor(() => {
        expect(container.querySelector('.manager-terminal-pane')).not.toBeNull();
      });

      // Close
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));
      expect(container.querySelector('.manager-terminal-pane')).toBeNull();
    });

    it('quick action buttons are disabled when terminal is not ready', () => {
      const props = defaultProps();
      const { container } = render(<ManagerView {...props} />);

      // Open without waiting for terminal creation
      fireEvent.click(screen.getByText('MANAGER TERMINAL'));

      // The toolbar appears, but buttons should be disabled since terminalId is null
      const buttons = container.querySelectorAll('.manager-terminal-action');
      buttons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });
    });
  });
});
