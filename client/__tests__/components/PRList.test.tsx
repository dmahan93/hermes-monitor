import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PRList, filterPRs } from '../../src/components/PRList';
import type { PullRequest, PRStatus } from '../../src/types';

function makePR(overrides: Partial<PullRequest> & { status: PRStatus }): PullRequest {
  return {
    id: Math.random().toString(36).slice(2),
    issueId: 'issue-1',
    title: `PR (${overrides.status})`,
    description: '',
    sourceBranch: 'feature',
    targetBranch: 'main',
    repoPath: '/repo',
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
  const defaultProps = {
    prs: [] as PullRequest[],
    onComment: vi.fn(),
    onVerdict: vi.fn(),
    onMerge: vi.fn(),
    onRelaunchReview: vi.fn(),
  };

  it('shows empty state when no PRs exist', () => {
    render(<PRList {...defaultProps} />);
    expect(screen.getByText(/No pull requests yet/)).toBeInTheDocument();
  });

  it('renders view tabs with correct labels', () => {
    const prs = [makePR({ status: 'open' })];
    render(<PRList {...defaultProps} prs={prs} />);
    expect(screen.getByText(/OPEN/)).toBeInTheDocument();
    expect(screen.getByText(/CLOSED/)).toBeInTheDocument();
    expect(screen.getByText(/ALL/)).toBeInTheDocument();
  });

  it('shows filtered empty state for closed view when no closed PRs', () => {
    const prs = [makePR({ status: 'open' })];
    render(<PRList {...defaultProps} prs={prs} />);
    // Switch to closed tab
    fireEvent.click(screen.getByText(/CLOSED/));
    expect(screen.getByText(/No closed pull requests/)).toBeInTheDocument();
  });

  it('defaults to open view showing only active PRs', () => {
    const prs = [
      makePR({ status: 'open', title: 'Active PR' }),
      makePR({ status: 'merged', title: 'Merged PR' }),
    ];
    render(<PRList {...defaultProps} prs={prs} />);
    expect(screen.getByText('Active PR')).toBeInTheDocument();
    expect(screen.queryByText('Merged PR')).not.toBeInTheDocument();
  });

  it('closed tab shows merged and closed PRs', () => {
    const prs = [
      makePR({ status: 'open', title: 'Active PR' }),
      makePR({ status: 'merged', title: 'Merged PR' }),
      makePR({ status: 'closed', title: 'Closed PR' }),
    ];
    render(<PRList {...defaultProps} prs={prs} />);
    fireEvent.click(screen.getByText(/CLOSED/));
    expect(screen.queryByText('Active PR')).not.toBeInTheDocument();
    expect(screen.getByText('Merged PR')).toBeInTheDocument();
    expect(screen.getByText('Closed PR')).toBeInTheDocument();
  });

  it('all tab shows every PR', () => {
    const prs = [
      makePR({ status: 'open', title: 'Active PR' }),
      makePR({ status: 'merged', title: 'Merged PR' }),
    ];
    render(<PRList {...defaultProps} prs={prs} />);
    fireEvent.click(screen.getByText(/ALL/));
    expect(screen.getByText('Active PR')).toBeInTheDocument();
    expect(screen.getByText('Merged PR')).toBeInTheDocument();
  });
});
