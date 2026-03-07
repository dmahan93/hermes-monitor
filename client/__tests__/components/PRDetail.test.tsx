import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('PRDetail — Screenshots section', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(screenshotsResponse: any) {
    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/screenshots')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(screenshotsResponse),
        } as Response);
      }
      // merge-check default
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ canMerge: false, hasConflicts: false }),
      } as Response);
    }) as any;
  }

  it('renders SCREENSHOTS section when screenshots exist', async () => {
    mockFetch({
      screenshots: [
        { filename: 'before-abc12345.png', url: '/screenshots/issue-1/before-abc12345.png' },
        { filename: 'after-def67890.png', url: '/screenshots/issue-1/after-def67890.png' },
      ],
    });

    const props = defaultProps();
    render(<PRDetail {...props} />);

    await waitFor(() => {
      expect(screen.getByText(/SCREENSHOTS \(2\)/)).toBeInTheDocument();
    });
  });

  it('does not render SCREENSHOTS section when no screenshots', async () => {
    mockFetch({ screenshots: [] });

    const props = defaultProps();
    render(<PRDetail {...props} />);

    // Wait for fetch to complete
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    expect(screen.queryByText(/SCREENSHOTS/)).not.toBeInTheDocument();
  });

  it('renders images with correct src attributes', async () => {
    mockFetch({
      screenshots: [
        { filename: 'homepage-abc12345.png', url: '/screenshots/issue-1/homepage-abc12345.png' },
      ],
    });

    const props = defaultProps();
    render(<PRDetail {...props} />);

    await waitFor(() => {
      const img = screen.getByRole('button', { name: /View.*full size/ });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', '/screenshots/issue-1/homepage-abc12345.png');
    });
  });

  it('generates clean caption from filename', async () => {
    mockFetch({
      screenshots: [
        { filename: 'my-screenshot-abc12345.png', url: '/screenshots/issue-1/my-screenshot-abc12345.png' },
      ],
    });

    const props = defaultProps();
    render(<PRDetail {...props} />);

    await waitFor(() => {
      expect(screen.getByText('my screenshot')).toBeInTheDocument();
    });
  });

  it('fetches screenshots for the correct PR id', async () => {
    mockFetch({ screenshots: [] });

    const props = defaultProps();
    props.pr = makePR({ id: 'custom-pr-id' });
    render(<PRDetail {...props} />);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/prs/custom-pr-id/screenshots');
    });
  });
});
