import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PRList, filterPRs } from '../../src/components/PRList';
import type { PullRequest, Issue, PRStatus, IssueStatus } from '../../src/types';

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    issueId: 'issue-1',
    title: overrides.title || `PR (${overrides.status || 'open'})`,
    description: '',
    sourceBranch: 'feature',
    targetBranch: 'main',
    repoPath: '/repo',
    status: 'open' as PRStatus,
    diff: '',
    changedFiles: ['file.ts'],
    verdict: 'pending',
    reviewerTerminalId: null,
    comments: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeIssue(id: string, status: IssueStatus = 'todo'): Issue {
  return {
    id,
    title: `Issue ${id}`,
    description: '',
    status,
    agent: 'hermes',
    command: '',
    terminalId: null,
    branch: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const ALL_STATUSES: PRStatus[] = ['open', 'reviewing', 'approved', 'changes_requested', 'merged', 'closed'];

describe('filterPRs', () => {
  const prs = ALL_STATUSES.map((status) => makePR({ status }));

  it('open view includes open, reviewing, approved, changes_requested', () => {
    const result = filterPRs(prs, 'open');
    const statuses = result.map((pr) => pr.status);
    expect(statuses).toEqual(['open', 'reviewing', 'approved', 'changes_requested']);
  });

  it('open view excludes merged and closed', () => {
    const result = filterPRs(prs, 'open');
    const statuses = result.map((pr) => pr.status);
    expect(statuses).not.toContain('merged');
    expect(statuses).not.toContain('closed');
  });

  it('closed view includes merged and closed', () => {
    const result = filterPRs(prs, 'closed');
    const statuses = result.map((pr) => pr.status);
    expect(statuses).toEqual(['merged', 'closed']);
  });

  it('closed view excludes open statuses', () => {
    const result = filterPRs(prs, 'closed');
    const statuses = result.map((pr) => pr.status);
    expect(statuses).not.toContain('open');
    expect(statuses).not.toContain('reviewing');
    expect(statuses).not.toContain('approved');
    expect(statuses).not.toContain('changes_requested');
  });

  it('all view returns every PR', () => {
    const result = filterPRs(prs, 'all');
    expect(result).toHaveLength(prs.length);
    expect(result).toEqual(prs);
  });

  it('handles empty array', () => {
    expect(filterPRs([], 'open')).toEqual([]);
    expect(filterPRs([], 'closed')).toEqual([]);
    expect(filterPRs([], 'all')).toEqual([]);
  });

  it('handles all PRs being one status', () => {
    const allMerged = [makePR({ status: 'merged' }), makePR({ status: 'merged' })];
    expect(filterPRs(allMerged, 'open')).toHaveLength(0);
    expect(filterPRs(allMerged, 'closed')).toHaveLength(2);
    expect(filterPRs(allMerged, 'all')).toHaveLength(2);
  });
});

describe('PRList component', () => {
  const defaultProps = () => ({
    prs: [] as PullRequest[],
    issues: [] as Issue[],
    onComment: vi.fn(),
    onVerdict: vi.fn(),
    onMerge: vi.fn(),
    onFixConflicts: vi.fn(),
    onRelaunchReview: vi.fn(),
    onMoveToInProgress: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
  });

  it('shows empty state when no PRs exist', () => {
    render(<PRList {...defaultProps()} />);
    expect(screen.getByText(/No pull requests yet/)).toBeInTheDocument();
  });

  it('renders PR items in the list', () => {
    const props = defaultProps();
    props.prs = [makePR({ title: 'My Feature PR' })];
    render(<PRList {...props} />);
    expect(screen.getByText('My Feature PR')).toBeInTheDocument();
  });

  it('clicking a PR opens PRDetail view', () => {
    const props = defaultProps();
    props.prs = [makePR({ title: 'My Feature PR' })];
    render(<PRList {...props} />);
    fireEvent.click(screen.getByText('My Feature PR'));
    // In detail view, the back button should appear
    expect(screen.getByText('[← BACK]')).toBeInTheDocument();
  });

  it('renders view tabs with correct labels', () => {
    const props = defaultProps();
    props.prs = [makePR({ status: 'open' })];
    render(<PRList {...props} />);
    expect(screen.getByText(/OPEN/)).toBeInTheDocument();
    expect(screen.getByText(/CLOSED/)).toBeInTheDocument();
    expect(screen.getByText(/ALL/)).toBeInTheDocument();
  });

  it('shows filtered empty state for closed view when no closed PRs', () => {
    const props = defaultProps();
    props.prs = [makePR({ status: 'open' })];
    render(<PRList {...props} />);
    // Switch to closed tab
    fireEvent.click(screen.getByText(/CLOSED/));
    expect(screen.getByText(/No closed pull requests/)).toBeInTheDocument();
  });

  it('defaults to open view showing only active PRs', () => {
    const props = defaultProps();
    props.prs = [
      makePR({ status: 'open', title: 'Active PR' }),
      makePR({ status: 'merged', title: 'Merged PR' }),
    ];
    render(<PRList {...props} />);
    expect(screen.getByText('Active PR')).toBeInTheDocument();
    expect(screen.queryByText('Merged PR')).not.toBeInTheDocument();
  });

  it('closed tab shows merged and closed PRs', () => {
    const props = defaultProps();
    props.prs = [
      makePR({ status: 'open', title: 'Active PR' }),
      makePR({ status: 'merged', title: 'Merged PR' }),
      makePR({ status: 'closed', title: 'Closed PR' }),
    ];
    render(<PRList {...props} />);
    fireEvent.click(screen.getByText(/CLOSED/));
    expect(screen.queryByText('Active PR')).not.toBeInTheDocument();
    expect(screen.getByText('Merged PR')).toBeInTheDocument();
    expect(screen.getByText('Closed PR')).toBeInTheDocument();
  });

  it('all tab shows every PR', () => {
    const props = defaultProps();
    props.prs = [
      makePR({ status: 'open', title: 'Active PR' }),
      makePR({ status: 'merged', title: 'Merged PR' }),
    ];
    render(<PRList {...props} />);
    fireEvent.click(screen.getByText(/ALL/));
    expect(screen.getByText('Active PR')).toBeInTheDocument();
    expect(screen.getByText('Merged PR')).toBeInTheDocument();
  });

  it('passes issueStatus to PRDetail when issue is in review', () => {
    const props = defaultProps();
    props.prs = [makePR({ issueId: 'issue-1', title: 'My PR' })];
    props.issues = [makeIssue('issue-1', 'review')];
    render(<PRList {...props} />);
    fireEvent.click(screen.getByText('My PR'));
    // The back-to-in-progress button should be visible because issue is in review
    expect(screen.getByText(/BACK TO IN PROGRESS/)).toBeInTheDocument();
  });

  it('hides back-to-in-progress button when issue is not in review', () => {
    const props = defaultProps();
    props.prs = [makePR({ issueId: 'issue-1', title: 'My PR' })];
    props.issues = [makeIssue('issue-1', 'in_progress')];
    render(<PRList {...props} />);
    fireEvent.click(screen.getByText('My PR'));
    expect(screen.queryByText(/BACK TO IN PROGRESS/)).not.toBeInTheDocument();
  });

  it('hides back-to-in-progress button when issue is not found', () => {
    const props = defaultProps();
    props.prs = [makePR({ issueId: 'nonexistent', title: 'My PR' })];
    props.issues = [];
    render(<PRList {...props} />);
    fireEvent.click(screen.getByText('My PR'));
    expect(screen.queryByText(/BACK TO IN PROGRESS/)).not.toBeInTheDocument();
  });

  it('threads onMoveToInProgress through to PRDetail', async () => {
    const props = defaultProps();
    props.prs = [makePR({ issueId: 'issue-1', title: 'My PR' })];
    props.issues = [makeIssue('issue-1', 'review')];
    render(<PRList {...props} />);
    fireEvent.click(screen.getByText('My PR'));

    fireEvent.click(screen.getByText(/BACK TO IN PROGRESS/));

    await waitFor(() => {
      expect(props.onMoveToInProgress).toHaveBeenCalledWith('issue-1');
    });
  });
});
