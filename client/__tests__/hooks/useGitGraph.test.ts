import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGitGraph } from '../../src/hooks/useGitGraph';
import { API_BASE } from '../../src/config';
import type { GitCommit, GraphNode, GitFileChange } from '../../src/hooks/useGitGraph';
import type { ServerMessage } from '../../src/types';

const mockCommits: GitCommit[] = [
  {
    hash: 'abc1234567890',
    shortHash: 'abc1234',
    message: 'Initial commit',
    author: 'Test',
    date: '2025-01-01',
    parents: [],
    refs: ['HEAD -> main'],
  },
  {
    hash: 'def4567890123',
    shortHash: 'def4567',
    message: 'Second commit',
    author: 'Test',
    date: '2025-01-02',
    parents: ['abc1234567890'],
    refs: [],
  },
];

const mockGraph: GraphNode[] = [
  { hash: 'abc1234567890', col: 0, lines: [] },
  { hash: 'def4567890123', col: 0, lines: [{ fromCol: 0, toCol: 0, type: 'straight' }] },
];

const mockFiles: GitFileChange[] = [
  { path: 'src/index.ts', status: 'M', additions: 5, deletions: 2 },
];

function mockFetchSuccess() {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ commits: mockCommits, graph: mockGraph }),
  }) as any;
}

const originalFetch = globalThis.fetch;

describe('useGitGraph', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('fetches git log on mount', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useGitGraph());

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/git/log?limit=80`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns commits and graph data', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.commits).toHaveLength(2);
    expect(result.current.commits[0].hash).toBe('abc1234567890');
    expect(result.current.commits[1].hash).toBe('def4567890123');
    expect(result.current.graph).toHaveLength(2);
    expect(result.current.graph[0].col).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch errors gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as any;

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('HTTP 500');
    expect(result.current.commits).toHaveLength(0);
    expect(result.current.graph).toHaveLength(0);
  });

  it('handles network errors gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure')) as any;

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network failure');
    expect(result.current.commits).toHaveLength(0);
  });

  it('refetch function works', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    // Refetch
    await act(async () => {
      await result.current.refetch();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.commits).toHaveLength(2);
  });

  it('aborts fetch on unmount', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    // Use a never-resolving fetch to keep the request in-flight
    globalThis.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as any;

    const { unmount } = renderHook(() => useGitGraph());

    unmount();

    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it('selectCommit fetches file list for a commit', async () => {
    // First call: log fetch, second call: show fetch
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commits: mockCommits, graph: mockGraph }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc1234567890', files: mockFiles }),
      }) as any;

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.selectCommit('abc1234567890');
    });

    expect(result.current.selectedSha).toBe('abc1234567890');
    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0].path).toBe('src/index.ts');
    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/git/show/abc1234567890`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('selectCommit with null deselects', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.selectCommit(null);
    });

    expect(result.current.selectedSha).toBeNull();
    expect(result.current.files).toHaveLength(0);
  });

  it('selectCommit handles file fetch error', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commits: mockCommits, graph: mockGraph }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      }) as any;

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.selectCommit('abc1234567890');
    });

    expect(result.current.selectedSha).toBe('abc1234567890');
    expect(result.current.files).toHaveLength(0);
    expect(result.current.filesLoading).toBe(false);
  });

  it('viewDiff fetches diff content', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commits: mockCommits, graph: mockGraph }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc1234567890', file: 'src/index.ts', diff: '+ added line' }),
      }) as any;

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.viewDiff('abc1234567890', 'src/index.ts');
    });

    expect(result.current.diffContent).toBe('+ added line');
    expect(result.current.diffFile).toBe('src/index.ts');
    expect(result.current.diffSha).toBe('abc1234567890');
    expect(result.current.diffLoading).toBe(false);
  });

  it('closeDiff clears diff state', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commits: mockCommits, graph: mockGraph }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc1234567890', file: 'src/index.ts', diff: 'diff content' }),
      }) as any;

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.viewDiff('abc1234567890', 'src/index.ts');
    });

    expect(result.current.diffFile).toBe('src/index.ts');

    act(() => {
      result.current.closeDiff();
    });

    expect(result.current.diffFile).toBeNull();
    expect(result.current.diffContent).toBe('');
    expect(result.current.diffSha).toBeNull();
  });

  it('viewDiff handles fetch error', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commits: mockCommits, graph: mockGraph }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 }) as any;

    const { result } = renderHook(() => useGitGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.viewDiff('abc1234567890', 'src/index.ts');
    });

    expect(result.current.diffContent).toBe('Failed to load diff');
    expect(result.current.diffLoading).toBe(false);
  });

  it('selectCommit with same SHA toggles deselection', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ commits: mockCommits, graph: mockGraph }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sha: 'abc1234567890', files: mockFiles }),
      }) as any;

    const { result } = renderHook(() => useGitGraph());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Select a commit
    await act(async () => {
      await result.current.selectCommit('abc1234567890');
    });

    expect(result.current.selectedSha).toBe('abc1234567890');
    expect(result.current.files).toHaveLength(1);

    // Select the same commit again — should toggle deselection
    await act(async () => {
      await result.current.selectCommit('abc1234567890');
    });

    expect(result.current.selectedSha).toBeNull();
    expect(result.current.files).toHaveLength(0);
  });

  // ── New tests for polling, WS events, refresh ──

  it('exposes refreshing state that defaults to false', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.refreshing).toBe(false);
  });

  it('refresh() sets refreshing (not loading) during background fetch', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Replace fetch with a slow mock to observe the refreshing state
    let resolveRefresh!: (v: any) => void;
    globalThis.fetch = vi.fn().mockReturnValue(
      new Promise((res) => { resolveRefresh = res; }),
    ) as any;

    // Start a background refresh
    act(() => {
      result.current.refresh();
    });

    // Should be refreshing, NOT loading
    expect(result.current.refreshing).toBe(true);
    expect(result.current.loading).toBe(false);

    // Resolve the fetch
    await act(async () => {
      resolveRefresh({
        ok: true,
        json: () => Promise.resolve({ commits: mockCommits, graph: mockGraph }),
      });
    });

    expect(result.current.refreshing).toBe(false);
  });

  it('polls every 30s when active', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() =>
      useGitGraph({ active: true }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Initial fetch
    expect(fetch).toHaveBeenCalledTimes(1);

    // Advance 30 seconds — should trigger a poll
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    // Wait for the polling fetch to complete
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    // Another 30s
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  it('does not poll when active is false', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() =>
      useGitGraph({ active: false }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    // Advance well past the poll interval
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });

    // No additional fetches
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops polling on unmount', async () => {
    mockFetchSuccess();

    const { result, unmount } = renderHook(() =>
      useGitGraph({ active: true }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    unmount();

    // Advance past poll interval
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    // No extra fetch after unmount
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches on pr:updated with status merged via WS', async () => {
    mockFetchSuccess();

    const handlers: Array<(msg: ServerMessage) => void> = [];
    const mockSubscribe = vi.fn((handler) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    });

    const { result } = renderHook(() =>
      useGitGraph({ subscribe: mockSubscribe, active: false }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    // Simulate pr:updated with status 'merged'
    act(() => {
      for (const h of handlers) {
        h({
          type: 'pr:updated',
          pr: {
            id: 'pr-1',
            issueId: 'issue-1',
            title: 'Test PR',
            sourceBranch: 'feature',
            targetBranch: 'main',
            status: 'merged',
            diff: '',
            comments: [],
            createdAt: '',
            updatedAt: '',
          },
        } as ServerMessage);
      }
    });

    // The refresh fires after a 500ms timeout
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('does not refetch on pr:updated with non-merged status', async () => {
    mockFetchSuccess();

    const handlers: Array<(msg: ServerMessage) => void> = [];
    const mockSubscribe = vi.fn((handler) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    });

    const { result } = renderHook(() =>
      useGitGraph({ subscribe: mockSubscribe, active: false }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    // Simulate pr:updated with status 'reviewing'
    act(() => {
      for (const h of handlers) {
        h({
          type: 'pr:updated',
          pr: {
            id: 'pr-1',
            issueId: 'issue-1',
            title: 'Test PR',
            sourceBranch: 'feature',
            targetBranch: 'main',
            status: 'reviewing',
            diff: '',
            comments: [],
            createdAt: '',
            updatedAt: '',
          },
        } as ServerMessage);
      }
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    // Should NOT have refetched
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches on issue:updated with done status via WS', async () => {
    mockFetchSuccess();

    const handlers: Array<(msg: ServerMessage) => void> = [];
    const mockSubscribe = vi.fn((handler) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    });

    const { result } = renderHook(() =>
      useGitGraph({ subscribe: mockSubscribe, active: false }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    // Simulate issue:updated with status 'done'
    act(() => {
      for (const h of handlers) {
        h({
          type: 'issue:updated',
          issue: {
            id: 'issue-1',
            title: 'Test Issue',
            description: '',
            status: 'done',
            agent: 'test',
            command: '',
            terminalId: null,
            branch: 'test-branch',
            parentId: null,
            createdAt: '',
            updatedAt: '',
          },
        } as ServerMessage);
      }
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('does not refetch on issue:updated with review status', async () => {
    mockFetchSuccess();

    const handlers: Array<(msg: ServerMessage) => void> = [];
    const mockSubscribe = vi.fn((handler) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    });

    const { result } = renderHook(() =>
      useGitGraph({ subscribe: mockSubscribe, active: false }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    // Simulate issue:updated with status 'review' — not a git-changing event
    act(() => {
      for (const h of handlers) {
        h({
          type: 'issue:updated',
          issue: {
            id: 'issue-1',
            title: 'Test Issue',
            description: '',
            status: 'review',
            agent: 'test',
            command: '',
            terminalId: null,
            branch: 'test-branch',
            parentId: null,
            createdAt: '',
            updatedAt: '',
          },
        } as ServerMessage);
      }
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes WS handler on unmount', async () => {
    mockFetchSuccess();

    const unsubFn = vi.fn();
    const mockSubscribe = vi.fn().mockReturnValue(unsubFn);

    const { unmount } = renderHook(() =>
      useGitGraph({ subscribe: mockSubscribe }),
    );

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalled();
    });

    unmount();

    expect(unsubFn).toHaveBeenCalled();
  });

  it('background refresh error does not set error state', async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useGitGraph());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Make the next fetch fail
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as any;

    await act(async () => {
      result.current.refresh();
    });

    // Error should NOT be set for background refresh
    expect(result.current.error).toBeNull();
    expect(result.current.refreshing).toBe(false);
  });
});
