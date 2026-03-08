import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePRs } from '../../src/hooks/usePRs';
import { API_BASE } from '../../src/config';

const mockPR = {
  id: 'pr-1',
  issueId: 'issue-1',
  title: 'Test PR',
  description: 'A test PR',
  submitterNotes: '',
  sourceBranch: 'feature/test',
  targetBranch: 'master',
  repoPath: '/tmp/repo',
  status: 'open' as const,
  diff: '',
  changedFiles: ['file.ts'],
  verdict: 'pending',
  reviewerTerminalId: null,
  comments: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// No-op subscribe that returns an unsubscribe function
const mockSubscribe = (_handler: (msg: any) => void) => () => {};

describe('usePRs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches PRs on mount', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([mockPR]),
    }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.prs).toHaveLength(1);
    expect(result.current.prs[0].id).toBe('pr-1');
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/prs`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('addComment calls POST with correct URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) as any; // POST comment

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.addComment('pr-1', 'Great work!');
    });

    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/prs/pr-1/comments`, expect.objectContaining({
      method: 'POST',
    }));
  });

  it('setVerdict calls POST with correct URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) as any; // POST verdict

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.setVerdict('pr-1', 'approved');
    });

    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/prs/pr-1/verdict`, expect.objectContaining({
      method: 'POST',
    }));
  });

  it('mergePR calls POST with correct URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) as any; // POST merge

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let mergeResult: { error?: string } = {};
    await act(async () => {
      mergeResult = await result.current.mergePR('pr-1');
    });

    expect(mergeResult.error).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/prs/pr-1/merge`, { method: 'POST' });
  });

  // --- Error-path tests ---

  it('fetchPRs does not inject data into state on server error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.prs).toHaveLength(0);
  });

  it('addComment handles server error gracefully', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockPR]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }) }) as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.addComment('pr-1', 'Nice work!');
    });

    expect(consoleSpy).toHaveBeenCalledWith('Failed to add comment:', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('setVerdict handles server error gracefully', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockPR]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({ error: 'invalid' }) }) as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.setVerdict('pr-1', 'approved');
    });

    expect(consoleSpy).toHaveBeenCalledWith('Failed to set verdict:', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('fixConflicts handles server error gracefully', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockPR]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }) }) as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.fixConflicts('pr-1');
    });

    expect(consoleSpy).toHaveBeenCalledWith('Failed to fix conflicts:', expect.any(Error));
    consoleSpy.mockRestore();
  });

  // --- onError integration tests ---

  it('calls onError when fetchPRs fails', async () => {
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    }) as any;

    renderHook(() => usePRs(mockSubscribe, onError));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Failed to fetch PRs');
    });

    consoleSpy.mockRestore();
  });

  it('calls onError when addComment fails', async () => {
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockPR]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }) }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe, onError));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.addComment('pr-1', 'Nice work!');
    });

    expect(onError).toHaveBeenCalledWith('Failed to add comment');
    consoleSpy.mockRestore();
  });

  it('calls onError when setVerdict fails', async () => {
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockPR]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({ error: 'invalid' }) }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe, onError));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.setVerdict('pr-1', 'approved');
    });

    expect(onError).toHaveBeenCalledWith('Failed to set verdict');
    consoleSpy.mockRestore();
  });

  it('calls onError when fixConflicts fails', async () => {
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockPR]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }) }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe, onError));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.fixConflicts('pr-1');
    });

    expect(onError).toHaveBeenCalledWith('Failed to fix conflicts');
    consoleSpy.mockRestore();
  });

  it('calls onError when relaunchReview fails (HTTP error)', async () => {
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockPR]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error', json: () => Promise.resolve({ error: 'fail' }) }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe, onError));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.relaunchReview('pr-1');
    });

    expect(onError).toHaveBeenCalledWith('Failed to relaunch review');
    consoleSpy.mockRestore();
  });

  it('calls onError when relaunchReview fails (network error)', async () => {
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockPR]) }) // initial fetch
      .mockRejectedValueOnce(new Error('Network error')) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe, onError));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.relaunchReview('pr-1');
    });

    expect(onError).toHaveBeenCalledWith('Failed to relaunch review');
    consoleSpy.mockRestore();
  });

  it('does NOT call onError when mergePR fails (returns error to caller)', async () => {
    const onError = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockPR]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: 'Merge failed' }) }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe, onError));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let mergeResult: { error?: string } = {};
    await act(async () => {
      mergeResult = await result.current.mergePR('pr-1');
    });

    // mergePR returns errors to callers, so onError should NOT be called
    expect(mergeResult.error).toBe('Merge failed');
    expect(onError).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('confirmMerge calls POST with correct URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) as any; // POST confirm-merge

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let confirmResult: { error?: string } = {};
    await act(async () => {
      confirmResult = await result.current.confirmMerge('pr-1');
    });

    expect(confirmResult.error).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/prs/pr-1/confirm-merge`, { method: 'POST' });
  });

  it('confirmMerge returns error on failure', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: 'PR is already merged' }) }) as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let confirmResult: { error?: string } = {};
    await act(async () => {
      confirmResult = await result.current.confirmMerge('pr-1');
    });

    expect(confirmResult.error).toBe('PR is already merged');
    consoleSpy.mockRestore();
  });

  it('mergePR returns status and prUrl from github mode response', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'github_pr_created', prUrl: 'https://github.com/test/repo/pull/1' }) }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let mergeResult: { error?: string; status?: string; prUrl?: string } = {};
    await act(async () => {
      mergeResult = await result.current.mergePR('pr-1');
    });

    expect(mergeResult.status).toBe('github_pr_created');
    expect(mergeResult.prUrl).toBe('https://github.com/test/repo/pull/1');
  });

  it('closePR calls POST /prs/:id/close', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'closed' }) }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let closeResult: { error?: string } = {};
    await act(async () => {
      closeResult = await result.current.closePR('pr-1');
    });

    expect(closeResult.error).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/prs/pr-1/close`, { method: 'POST' });
  });

  it('closePR returns error on failure', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: 'Cannot close a merged PR' }) }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let closeResult: { error?: string } = {};
    await act(async () => {
      closeResult = await result.current.closePR('pr-1');
    });

    expect(closeResult.error).toBe('Cannot close a merged PR');
  });

  it('closePR handles network error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockRejectedValueOnce(new Error('Network down')) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let closeResult: { error?: string } = {};
    await act(async () => {
      closeResult = await result.current.closePR('pr-1');
    });

    expect(closeResult.error).toBe('Network error');
    consoleSpy.mockRestore();
  });

  it('closeAllStalePRs calls POST /batch/close-stale-prs', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ closed: [{ id: 'pr-1', title: 'Old PR' }], errors: [] }) }) as any;

    const { result } = renderHook(() => usePRs(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let staleResult: any = {};
    await act(async () => {
      staleResult = await result.current.closeAllStalePRs();
    });

    expect(staleResult.closed).toHaveLength(1);
    expect(staleResult.closed[0].id).toBe('pr-1');
    expect(staleResult.errors).toHaveLength(0);
  });
});
