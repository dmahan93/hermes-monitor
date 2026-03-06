import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PRList } from '../../src/components/PRList';
import type { PullRequest, Issue, PRStatus, IssueStatus } from '../../src/types';

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'pr-1',
    issueId: 'issue-1',
    title: 'Test PR',
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

const defaultProps = () => ({
  prs: [] as PullRequest[],
  issues: [] as Issue[],
  onComment: vi.fn(),
  onVerdict: vi.fn(),
  onMerge: vi.fn(),
  onRelaunchReview: vi.fn(),
  onMoveToInProgress: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
});

describe('PRList', () => {
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
