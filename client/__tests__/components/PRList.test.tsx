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
    submitterNotes: '',
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
    onConfirmMerge: vi.fn(),
    onFixConflicts: vi.fn(),
    onRelaunchReview: vi.fn(),
    onClosePR: vi.fn<[string], Promise<{ error?: string }>>().mockResolvedValue({}),
    onCloseAllStale: vi.fn().mockResolvedValue({ closed: [], errors: [] }),
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

  it('shows close button on open PR cards', () => {
    const props = defaultProps();
    props.prs = [makePR({ status: 'open', title: 'Open PR' })];
    render(<PRList {...props} />);
    const closeBtn = screen.getByLabelText(/Close PR: Open PR/);
    expect(closeBtn).toBeInTheDocument();
  });

  it('does not show close button on merged PR cards', () => {
    const props = defaultProps();
    props.prs = [makePR({ status: 'merged', title: 'Merged PR' })];
    render(<PRList {...props} />);
    // Switch to closed tab to see merged PRs
    fireEvent.click(screen.getByText(/CLOSED/));
    expect(screen.queryByLabelText(/Close PR/)).not.toBeInTheDocument();
  });

  it('does not show close button on closed PR cards', () => {
    const props = defaultProps();
    props.prs = [makePR({ status: 'closed', title: 'Closed PR' })];
    render(<PRList {...props} />);
    fireEvent.click(screen.getByText(/CLOSED/));
    expect(screen.queryByLabelText(/Close PR/)).not.toBeInTheDocument();
  });

  it('calls onClosePR with confirmation when close button is clicked', async () => {
    window.confirm = vi.fn(() => true);
    const props = defaultProps();
    props.prs = [makePR({ id: 'pr-close-1', status: 'open', title: 'PR to close' })];
    render(<PRList {...props} />);
    const closeBtn = screen.getByLabelText(/Close PR: PR to close/);
    fireEvent.click(closeBtn);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Close this PR?'));
    await waitFor(() => {
      expect(props.onClosePR).toHaveBeenCalledWith('pr-close-1');
    });
  });

  it('does not call onClosePR when confirmation is cancelled', () => {
    window.confirm = vi.fn(() => false);
    const props = defaultProps();
    props.prs = [makePR({ id: 'pr-close-2', status: 'open', title: 'PR no close' })];
    render(<PRList {...props} />);
    const closeBtn = screen.getByLabelText(/Close PR: PR no close/);
    fireEvent.click(closeBtn);
    expect(props.onClosePR).not.toHaveBeenCalled();
  });

  it('close button does not navigate to PR detail', async () => {
    window.confirm = vi.fn(() => true);
    const props = defaultProps();
    props.prs = [makePR({ status: 'open', title: 'Click Test PR' })];
    render(<PRList {...props} />);
    const closeBtn = screen.getByLabelText(/Close PR: Click Test PR/);
    fireEvent.click(closeBtn);
    // Should still be on list view (no back button)
    expect(screen.queryByText('[← BACK]')).not.toBeInTheDocument();
    expect(screen.getByText('Click Test PR')).toBeInTheDocument();
  });

  it('shows Close All Stale button when stale PRs exist', () => {
    const props = defaultProps();
    props.prs = [makePR({ issueId: 'done-issue', status: 'open', title: 'Stale PR' })];
    props.issues = [makeIssue('done-issue', 'done')];
    render(<PRList {...props} />);
    expect(screen.getByText(/CLOSE 1 STALE/)).toBeInTheDocument();
  });

  it('does not show Close All Stale button when no stale PRs', () => {
    const props = defaultProps();
    props.prs = [makePR({ issueId: 'active-issue', status: 'open', title: 'Active PR' })];
    props.issues = [makeIssue('active-issue', 'review')];
    render(<PRList {...props} />);
    expect(screen.queryByText(/CLOSE.*STALE/)).not.toBeInTheDocument();
  });

  it('counts orphaned PRs (no linked issue) as stale', () => {
    const props = defaultProps();
    props.prs = [makePR({ issueId: 'deleted-issue', status: 'approved', title: 'Orphan PR' })];
    props.issues = [];
    render(<PRList {...props} />);
    expect(screen.getByText(/CLOSE 1 STALE/)).toBeInTheDocument();
  });

  it('calls onCloseAllStale with confirmation when stale button is clicked', async () => {
    window.confirm = vi.fn(() => true);
    const props = defaultProps();
    props.prs = [makePR({ issueId: 'done-issue', status: 'open', title: 'Stale PR' })];
    props.issues = [makeIssue('done-issue', 'done')];
    render(<PRList {...props} />);
    fireEvent.click(screen.getByText(/CLOSE 1 STALE/));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(props.onCloseAllStale).toHaveBeenCalled();
    });
  });
});
