import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentTerminalList, selectionKey } from '../../src/components/AgentTerminalList';
import type { Issue, AgentPreset, PullRequest } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', planningCommand: 'hermes chat', description: 'Hermes agent', installed: true },
];

const makeIssue = (id: string, title: string, opts?: Partial<Issue>): Issue => ({
  id,
  title,
  description: '',
  status: 'in_progress',
  agent: 'hermes',
  command: '',
  terminalId: `term-${id}`,
  branch: `branch-${id}`,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...opts,
});

const makePR = (id: string, title: string, opts?: Partial<PullRequest>): PullRequest => ({
  id,
  issueId: `issue-${id}`,
  title,
  description: '',
  sourceBranch: `feature-${id}`,
  targetBranch: 'main',
  repoPath: '/tmp/repo',
  status: 'reviewing',
  diff: '',
  changedFiles: [],
  verdict: 'pending',
  reviewerTerminalId: `review-term-${id}`,
  comments: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...opts,
});

const defaultProps = {
  issues: [] as Issue[],
  prs: [] as PullRequest[],
  agents: mockAgents,
  activeTerminalId: null,
  onSelect: vi.fn(),
};

describe('AgentTerminalList', () => {
  describe('filter tabs', () => {
    it('renders all three filter tabs', () => {
      render(<AgentTerminalList {...defaultProps} />);
      expect(screen.getByText('ALL')).toBeInTheDocument();
      expect(screen.getByText('AGENTS')).toBeInTheDocument();
      expect(screen.getByText('REVIEWERS')).toBeInTheDocument();
    });

    it('has proper ARIA tablist/tab roles', () => {
      render(<AgentTerminalList {...defaultProps} />);
      const tablist = screen.getByRole('tablist');
      expect(tablist).toBeInTheDocument();
      expect(tablist).toHaveAttribute('aria-label', 'Terminal filter');

      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(3);
    });

    it('marks the active tab with aria-selected', () => {
      render(<AgentTerminalList {...defaultProps} />);
      const tabs = screen.getAllByRole('tab');
      // ALL is active by default
      expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
      expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
      expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
    });

    it('switches active tab on click', () => {
      render(<AgentTerminalList {...defaultProps} />);
      fireEvent.click(screen.getByText('AGENTS'));
      const tabs = screen.getAllByRole('tab');
      expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
      expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    });

    it('tab buttons have type="button"', () => {
      render(<AgentTerminalList {...defaultProps} />);
      const tabs = screen.getAllByRole('tab');
      tabs.forEach((tab) => {
        expect(tab).toHaveAttribute('type', 'button');
      });
    });
  });

  describe('empty states', () => {
    it('shows "No agents or reviewers running." when filter is ALL and nothing running', () => {
      render(<AgentTerminalList {...defaultProps} />);
      expect(screen.getByText('No agents or reviewers running.')).toBeInTheDocument();
    });

    it('shows "No agents running." when filter is AGENTS and no agents', () => {
      render(<AgentTerminalList {...defaultProps} />);
      fireEvent.click(screen.getByText('AGENTS'));
      expect(screen.getByText('No agents running.')).toBeInTheDocument();
    });

    it('shows "No reviewers running." when filter is REVIEWERS and no reviewers', () => {
      render(<AgentTerminalList {...defaultProps} />);
      fireEvent.click(screen.getByText('REVIEWERS'));
      expect(screen.getByText('No reviewers running.')).toBeInTheDocument();
    });
  });

  describe('rendering agent items', () => {
    it('renders agent items when filter is ALL', () => {
      const issues = [makeIssue('1', 'Fix bug'), makeIssue('2', 'Add feature')];
      render(<AgentTerminalList {...defaultProps} issues={issues} />);
      expect(screen.getByText('Fix bug')).toBeInTheDocument();
      expect(screen.getByText('Add feature')).toBeInTheDocument();
    });

    it('renders agent items when filter is AGENTS', () => {
      const issues = [makeIssue('1', 'Fix bug')];
      render(<AgentTerminalList {...defaultProps} issues={issues} />);
      fireEvent.click(screen.getByText('AGENTS'));
      expect(screen.getByText('Fix bug')).toBeInTheDocument();
    });

    it('hides agent items when filter is REVIEWERS', () => {
      const issues = [makeIssue('1', 'Fix bug')];
      render(<AgentTerminalList {...defaultProps} issues={issues} />);
      fireEvent.click(screen.getByText('REVIEWERS'));
      expect(screen.queryByText('Fix bug')).not.toBeInTheDocument();
    });

    it('only shows issues with a terminalId', () => {
      const issues = [
        makeIssue('1', 'Active task'),
        makeIssue('2', 'No terminal', { terminalId: null }),
      ];
      render(<AgentTerminalList {...defaultProps} issues={issues} />);
      expect(screen.getByText('Active task')).toBeInTheDocument();
      expect(screen.queryByText('No terminal')).not.toBeInTheDocument();
    });

    it('only shows in_progress issues (filters out review/done with stale terminalId)', () => {
      const issues = [
        makeIssue('1', 'Working agent', { status: 'in_progress' }),
        makeIssue('2', 'Review stale', { status: 'review', terminalId: 'term-stale' }),
        makeIssue('3', 'Done stale', { status: 'done', terminalId: 'term-done' }),
        makeIssue('4', 'Todo stale', { status: 'todo', terminalId: 'term-todo' }),
      ];
      render(<AgentTerminalList {...defaultProps} issues={issues} />);
      expect(screen.getByText('Working agent')).toBeInTheDocument();
      expect(screen.queryByText('Review stale')).not.toBeInTheDocument();
      expect(screen.queryByText('Done stale')).not.toBeInTheDocument();
      expect(screen.queryByText('Todo stale')).not.toBeInTheDocument();
    });
  });

  describe('rendering reviewer items', () => {
    it('renders reviewer items when filter is ALL', () => {
      const prs = [makePR('1', 'PR: Fix types')];
      render(<AgentTerminalList {...defaultProps} prs={prs} />);
      expect(screen.getByText('PR: Fix types')).toBeInTheDocument();
    });

    it('renders reviewer items when filter is REVIEWERS', () => {
      const prs = [makePR('1', 'PR: Fix types')];
      render(<AgentTerminalList {...defaultProps} prs={prs} />);
      fireEvent.click(screen.getByText('REVIEWERS'));
      expect(screen.getByText('PR: Fix types')).toBeInTheDocument();
    });

    it('hides reviewer items when filter is AGENTS', () => {
      const prs = [makePR('1', 'PR: Fix types')];
      render(<AgentTerminalList {...defaultProps} prs={prs} />);
      fireEvent.click(screen.getByText('AGENTS'));
      expect(screen.queryByText('PR: Fix types')).not.toBeInTheDocument();
    });

    it('only shows PRs with a reviewerTerminalId', () => {
      const prs = [
        makePR('1', 'Active review'),
        makePR('2', 'No terminal', { reviewerTerminalId: null }),
      ];
      render(<AgentTerminalList {...defaultProps} prs={prs} />);
      expect(screen.getByText('Active review')).toBeInTheDocument();
      expect(screen.queryByText('No terminal')).not.toBeInTheDocument();
    });

    it('only shows PRs with active status (reviewing or open)', () => {
      const prs = [
        makePR('1', 'Reviewing PR', { status: 'reviewing' }),
        makePR('2', 'Conflict fixer', { status: 'open' }),
        makePR('3', 'Approved PR', { status: 'approved' }),
        makePR('4', 'Changes requested PR', { status: 'changes_requested' }),
        makePR('5', 'Merged PR', { status: 'merged' }),
        makePR('6', 'Closed PR', { status: 'closed' }),
      ];
      render(<AgentTerminalList {...defaultProps} prs={prs} />);
      expect(screen.getByText('Reviewing PR')).toBeInTheDocument();
      expect(screen.getByText('Conflict fixer')).toBeInTheDocument();
      expect(screen.queryByText('Approved PR')).not.toBeInTheDocument();
      expect(screen.queryByText('Changes requested PR')).not.toBeInTheDocument();
      expect(screen.queryByText('Merged PR')).not.toBeInTheDocument();
      expect(screen.queryByText('Closed PR')).not.toBeInTheDocument();
    });
  });

  describe('mixed agents and reviewers', () => {
    it('shows both when filter is ALL', () => {
      const issues = [makeIssue('1', 'Agent task')];
      const prs = [makePR('1', 'Review task')];
      render(<AgentTerminalList {...defaultProps} issues={issues} prs={prs} />);
      expect(screen.getByText('Agent task')).toBeInTheDocument();
      expect(screen.getByText('Review task')).toBeInTheDocument();
    });

    it('shows only agents when filter is AGENTS', () => {
      const issues = [makeIssue('1', 'Agent task')];
      const prs = [makePR('1', 'Review task')];
      render(<AgentTerminalList {...defaultProps} issues={issues} prs={prs} />);
      fireEvent.click(screen.getByText('AGENTS'));
      expect(screen.getByText('Agent task')).toBeInTheDocument();
      expect(screen.queryByText('Review task')).not.toBeInTheDocument();
    });

    it('shows only reviewers when filter is REVIEWERS', () => {
      const issues = [makeIssue('1', 'Agent task')];
      const prs = [makePR('1', 'Review task')];
      render(<AgentTerminalList {...defaultProps} issues={issues} prs={prs} />);
      fireEvent.click(screen.getByText('REVIEWERS'));
      expect(screen.queryByText('Agent task')).not.toBeInTheDocument();
      expect(screen.getByText('Review task')).toBeInTheDocument();
    });
  });

  describe('click callbacks', () => {
    it('emits agent selection when clicking an agent item', () => {
      const onSelect = vi.fn();
      const issues = [makeIssue('issue-1', 'Fix bug')];
      render(<AgentTerminalList {...defaultProps} issues={issues} onSelect={onSelect} />);
      fireEvent.click(screen.getByText('Fix bug'));
      expect(onSelect).toHaveBeenCalledWith({ kind: 'agent', issueId: 'issue-1' });
    });

    it('emits reviewer selection when clicking a reviewer item', () => {
      const onSelect = vi.fn();
      const prs = [makePR('pr-1', 'Review PR')];
      render(<AgentTerminalList {...defaultProps} prs={prs} onSelect={onSelect} />);
      fireEvent.click(screen.getByText('Review PR'));
      expect(onSelect).toHaveBeenCalledWith({ kind: 'reviewer', prId: 'pr-1' });
    });
  });

  describe('active item highlighting', () => {
    it('marks an agent item as active when its terminalId matches', () => {
      const issues = [makeIssue('1', 'Active task', { terminalId: 'term-active' })];
      const { container } = render(
        <AgentTerminalList {...defaultProps} issues={issues} activeTerminalId="term-active" />
      );
      const activeItem = container.querySelector('.agent-list-item-active');
      expect(activeItem).toBeInTheDocument();
    });

    it('marks a reviewer item as active when its reviewerTerminalId matches', () => {
      const prs = [makePR('1', 'Active review', { reviewerTerminalId: 'review-active' })];
      const { container } = render(
        <AgentTerminalList {...defaultProps} prs={prs} activeTerminalId="review-active" />
      );
      const activeItem = container.querySelector('.agent-list-item-active');
      expect(activeItem).toBeInTheDocument();
    });
  });
});

describe('selectionKey', () => {
  it('returns agent:id for agent selections', () => {
    expect(selectionKey({ kind: 'agent', issueId: 'abc' })).toBe('agent:abc');
  });

  it('returns reviewer:id for reviewer selections', () => {
    expect(selectionKey({ kind: 'reviewer', prId: 'xyz' })).toBe('reviewer:xyz');
  });

  it('produces different keys for agent and reviewer with same id', () => {
    const agentKey = selectionKey({ kind: 'agent', issueId: 'same-id' });
    const reviewerKey = selectionKey({ kind: 'reviewer', prId: 'same-id' });
    expect(agentKey).not.toBe(reviewerKey);
  });
});
