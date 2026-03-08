import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGitGraph } from '../../src/hooks/useGitGraph';
import { API_BASE } from '../../src/config';
import type { GitCommit, GraphNode, GitFileChange } from '../../src/hooks/useGitGraph';

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

describe('useGitGraph', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
