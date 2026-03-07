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
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/prs`);
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
});
