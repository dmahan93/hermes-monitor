import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PRDetail } from '../../src/components/PRDetail';
import { API_BASE } from '../../src/config';
import type { PullRequest, IssueStatus, PRStatus } from '../../src/types';

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'pr-1',
    issueId: 'issue-1',
    title: 'Test PR',
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

const defaultProps = () => ({
  pr: makePR(),
  onBack: vi.fn(),
  onComment: vi.fn(),
  onVerdict: vi.fn(),
  onMerge: vi.fn<[string], Promise<{ error?: string; status?: string; prUrl?: string }>>().mockResolvedValue({}),
  onConfirmMerge: vi.fn<[string], Promise<{ error?: string }>>().mockResolvedValue({}),
  onFixConflicts: vi.fn(),
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

describe('PRDetail — Submitter Notes section', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Default mock: empty screenshots + no-merge
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ screenshots: [], canMerge: false, hasConflicts: false }),
      } as Response)
    ) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders SUBMITTER NOTES section when submitterNotes is present', async () => {
    const props = defaultProps();
    props.pr = makePR({ submitterNotes: 'I refactored the auth module and added tests.' });
    render(<PRDetail {...props} />);

    await waitFor(() => {
      expect(screen.getByText('SUBMITTER NOTES')).toBeInTheDocument();
    });
  });

  it('does not render SUBMITTER NOTES section when submitterNotes is empty', async () => {
    const props = defaultProps();
    props.pr = makePR({ submitterNotes: '' });
    render(<PRDetail {...props} />);

    // Wait for any async effects
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    expect(screen.queryByText('SUBMITTER NOTES')).not.toBeInTheDocument();
  });

  it('renders the submitter notes content', async () => {
    const props = defaultProps();
    props.pr = makePR({ submitterNotes: 'Fixed the edge case in user validation' });
    render(<PRDetail {...props} />);

    await waitFor(() => {
      expect(screen.getByText('Fixed the edge case in user validation')).toBeInTheDocument();
    });
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
      expect(globalThis.fetch).toHaveBeenCalledWith(`${API_BASE}/prs/custom-pr-id/screenshots`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });
  });
});

describe('PRDetail — Merge confirmation', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalConfirm: typeof window.confirm;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalConfirm = window.confirm;
    // Mock fetch: merge-check returns canMerge: true, no conflicts
    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/merge-check')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ canMerge: true, hasConflicts: false }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ screenshots: [] }),
      } as Response);
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.confirm = originalConfirm;
  });

  it('shows confirmation dialog before merging', async () => {
    window.confirm = vi.fn(() => true);
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved' });
    render(<PRDetail {...props} />);

    // Wait for merge button to appear (after merge-check resolves)
    await waitFor(() => {
      expect(screen.getByText(/MERGE/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/MERGE/));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Test PR'),
    );
  });

  it('calls onMerge when user confirms', async () => {
    window.confirm = vi.fn(() => true);
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved' });
    render(<PRDetail {...props} />);

    await waitFor(() => {
      expect(screen.getByText(/MERGE/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/MERGE/));

    await waitFor(() => {
      expect(props.onMerge).toHaveBeenCalledWith('pr-1');
    });
  });

  it('does not call onMerge when user cancels', async () => {
    window.confirm = vi.fn(() => false);
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved' });
    render(<PRDetail {...props} />);

    await waitFor(() => {
      expect(screen.getByText(/MERGE/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/MERGE/));
    expect(window.confirm).toHaveBeenCalled();
    expect(props.onMerge).not.toHaveBeenCalled();
  });

  it('includes target branch in confirmation message', async () => {
    window.confirm = vi.fn(() => false);
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved', targetBranch: 'production' });
    render(<PRDetail {...props} />);

    await waitFor(() => {
      expect(screen.getByText(/MERGE/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/MERGE/));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('production'),
    );
  });
});

describe('PRDetail — GitHub merge mode', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalConfirm: typeof window.confirm;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalConfirm = window.confirm;
    globalThis.fetch = vi.fn((url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/merge-check')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ canMerge: true, hasConflicts: false }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ screenshots: [] }),
      } as Response);
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.confirm = originalConfirm;
  });

  it('shows "Create GitHub PR" button when mergeMode is github', async () => {
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved' });
    render(<PRDetail {...props} mergeMode="github" />);

    await waitFor(() => {
      expect(screen.getByText(/Create GitHub PR/)).toBeInTheDocument();
    });
  });

  it('shows regular MERGE button when mergeMode is local', async () => {
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved' });
    render(<PRDetail {...props} mergeMode="local" />);

    await waitFor(() => {
      expect(screen.getByText(/MERGE/)).toBeInTheDocument();
      expect(screen.queryByText(/Create GitHub PR/)).not.toBeInTheDocument();
    });
  });

  it('shows "View GitHub PR" link and "CONFIRM MERGED" button when github mode and PR URL exists', async () => {
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved', githubPrUrl: 'https://github.com/test/repo/pull/1' });
    render(<PRDetail {...props} mergeMode="github" />);

    await waitFor(() => {
      expect(screen.getByText(/View GitHub PR/)).toBeInTheDocument();
      expect(screen.getByText(/CONFIRM MERGED/)).toBeInTheDocument();
    });
  });

  it('does not show CONFIRM MERGED button when mergeMode is local', async () => {
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved', githubPrUrl: 'https://github.com/test/repo/pull/1' });
    render(<PRDetail {...props} mergeMode="local" />);

    await waitFor(() => {
      expect(screen.getByText(/MERGE/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/CONFIRM MERGED/)).not.toBeInTheDocument();
  });

  it('calls onConfirmMerge when CONFIRM MERGED is clicked and confirmed', async () => {
    window.confirm = vi.fn(() => true);
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved', githubPrUrl: 'https://github.com/test/repo/pull/1' });
    render(<PRDetail {...props} mergeMode="github" />);

    await waitFor(() => {
      expect(screen.getByText(/CONFIRM MERGED/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/CONFIRM MERGED/));

    await waitFor(() => {
      expect(props.onConfirmMerge).toHaveBeenCalledWith('pr-1');
    });
  });

  it('shows confirmation dialog for GitHub PR creation', async () => {
    window.confirm = vi.fn(() => true);
    const props = defaultProps();
    props.pr = makePR({ verdict: 'approved' });
    render(<PRDetail {...props} mergeMode="github" />);

    await waitFor(() => {
      expect(screen.getByText(/Create GitHub PR/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Create GitHub PR/));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Create GitHub PR'),
    );
  });
});
