import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PRDetail } from '../../src/components/PRDetail';
import type { PullRequest, IssueStatus, PRStatus } from '../../src/types';

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

const defaultProps = () => ({
  pr: makePR(),
  onBack: vi.fn(),
  onComment: vi.fn(),
  onVerdict: vi.fn(),
  onMerge: vi.fn(),
  onRelaunchReview: vi.fn(),
  onMoveToInProgress: vi.fn<[string], Promise<void>>().mockResolvedValue(undefined),
});

describe('PRDetail — Back to In Progress button', () => {
  it('renders the button when issueStatus is review', () => {
    const props = defaultProps();
    render(<PRDetail {...props} issueStatus="review" />);
    expect(screen.getByText(/BACK TO IN PROGRESS/)).toBeInTheDocument();
  });

  it('does not render the button when issueStatus is in_progress', () => {
    const props = defaultProps();
    render(<PRDetail {...props} issueStatus="in_progress" />);
    expect(screen.queryByText(/BACK TO IN PROGRESS/)).not.toBeInTheDocument();
  });

  it('does not render the button when issueStatus is todo', () => {
    const props = defaultProps();
    render(<PRDetail {...props} issueStatus="todo" />);
    expect(screen.queryByText(/BACK TO IN PROGRESS/)).not.toBeInTheDocument();
  });

  it('does not render the button when issueStatus is done', () => {
    const props = defaultProps();
    render(<PRDetail {...props} issueStatus="done" />);
    expect(screen.queryByText(/BACK TO IN PROGRESS/)).not.toBeInTheDocument();
  });

  it('does not render the button when issueStatus is undefined', () => {
    const props = defaultProps();
    render(<PRDetail {...props} />);
    expect(screen.queryByText(/BACK TO IN PROGRESS/)).not.toBeInTheDocument();
  });

  it('does not render the button when PR is merged (even if issueStatus is review)', () => {
    const props = defaultProps();
    props.pr = makePR({ status: 'merged' as PRStatus });
    render(<PRDetail {...props} issueStatus="review" />);
    expect(screen.queryByText(/BACK TO IN PROGRESS/)).not.toBeInTheDocument();
  });

  it('does not render the button when PR is closed', () => {
    const props = defaultProps();
    props.pr = makePR({ status: 'closed' as PRStatus });
    render(<PRDetail {...props} issueStatus="review" />);
    expect(screen.queryByText(/BACK TO IN PROGRESS/)).not.toBeInTheDocument();
  });

  it('calls onMoveToInProgress with the correct issueId on click', async () => {
    const props = defaultProps();
    props.pr = makePR({ issueId: 'my-issue-42' });
    render(<PRDetail {...props} issueStatus="review" />);

    fireEvent.click(screen.getByText(/BACK TO IN PROGRESS/));

    await waitFor(() => {
      expect(props.onMoveToInProgress).toHaveBeenCalledWith('my-issue-42');
    });
  });

  it('awaits onMoveToInProgress before calling onBack', async () => {
    const callOrder: string[] = [];
    let resolveMove: () => void;
    const movePromise = new Promise<void>((resolve) => { resolveMove = resolve; });

    const props = defaultProps();
    props.onMoveToInProgress = vi.fn(() => {
      callOrder.push('moveToInProgress');
      return movePromise;
    });
    props.onBack = vi.fn(() => {
      callOrder.push('onBack');
    });

    render(<PRDetail {...props} issueStatus="review" />);
    fireEvent.click(screen.getByText(/BACK TO IN PROGRESS/));

    // onBack should NOT have been called yet (move is still pending)
    expect(props.onBack).not.toHaveBeenCalled();
    expect(props.onMoveToInProgress).toHaveBeenCalled();

    // Resolve the move
    resolveMove!();

    await waitFor(() => {
      expect(props.onBack).toHaveBeenCalled();
    });

    // Verify order: move first, then back
    expect(callOrder).toEqual(['moveToInProgress', 'onBack']);
  });
});
