import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePRs } from '../../src/hooks/usePRs';
import { API_BASE } from '../../src/config';

const mockPR = {
  id: 'pr-1',
  issueId: 'issue-1',
  title: 'Test PR',
  description: 'A test pull request',
  submitterNotes: '',
  sourceBranch: 'feature',
  targetBranch: 'main',
  repoPath: '/tmp/repo',
  status: 'open' as const,
  diff: '',
  changedFiles: ['file.ts'],
  verdict: '',
  reviewerTerminalId: null,
  comments: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// A no-op subscribe that returns an unsubscribe function
const mockSubscribe = vi.fn(() => vi.fn());

describe('usePRs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches PRs on mount', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
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
      .mockResolvedValueOnce({ json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({}) }) as any; // POST comment

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
      .mockResolvedValueOnce({ json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({}) }) as any; // POST verdict

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
      .mockResolvedValueOnce({ json: () => Promise.resolve([]) }) // initial fetch
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
});
