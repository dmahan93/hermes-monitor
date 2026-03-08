import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useIssues } from '../../src/hooks/useIssues';
import { API_BASE } from '../../src/config';

const mockIssue = {
  id: 'issue-1',
  title: 'Test Issue',
  description: 'A test issue',
  status: 'todo' as const,
  agent: 'hermes',
  command: 'echo hello',
  terminalId: null,
  branch: null,
  parentId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// No-op subscribe that returns an unsubscribe function
const mockSubscribe = (_handler: (msg: any) => void) => () => {};

describe('useIssues', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches issues on mount', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([mockIssue]),
    }) as any;

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toHaveLength(1);
    expect(result.current.issues[0].id).toBe('issue-1');
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/issues`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('createIssue calls POST with correct URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ...mockIssue, id: 'new-1' }) }) as any;

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.createIssue('New Issue', 'description');
    });

    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/issues`, expect.objectContaining({
      method: 'POST',
    }));
  });

  it('updateIssue calls PATCH with correct URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockIssue]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) as any; // PATCH

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.updateIssue('issue-1', { title: 'Updated' });
    });

    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/issues/issue-1`, expect.objectContaining({
      method: 'PATCH',
    }));
  });

  it('deleteIssue calls DELETE with correct URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockIssue]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) as any; // DELETE

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.issues).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteIssue('issue-1');
    });

    expect(result.current.issues).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/issues/issue-1`, { method: 'DELETE' });
  });

  it('changeStatus calls PATCH with correct URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockIssue]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) as any; // PATCH status

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.changeStatus('issue-1', 'in_progress');
    });

    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/issues/issue-1/status`, expect.objectContaining({
      method: 'PATCH',
    }));
  });

  // --- Error-path tests ---

  it('fetchIssues does not inject data into state on server error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    }) as any;

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toHaveLength(0);
  });

  it('createIssue returns null and does not add to state on server error', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }) }) as any;

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let returnValue: any;
    await act(async () => {
      returnValue = await result.current.createIssue('New Issue');
    });

    expect(returnValue).toBeNull();
    expect(result.current.issues).toHaveLength(0);
  });

  it('deleteIssue refetches from server when DELETE returns non-ok', async () => {
    const refetchedIssues = [mockIssue]; // Server still has the issue

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockIssue]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }) }) // DELETE fails
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(refetchedIssues) }) as any; // refetch after failure

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.issues).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteIssue('issue-1');
    });

    // After the failed DELETE, the catch block calls fetchIssues() which restores the issue
    await waitFor(() => {
      expect(result.current.issues).toHaveLength(1);
    });

    expect(result.current.issues[0].id).toBe('issue-1');
    // Verify 3 fetch calls: initial fetch, DELETE, refetch
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('updateIssue handles server error gracefully', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockIssue]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }) }) as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.updateIssue('issue-1', { title: 'Updated' });
    });

    // Should log error, not crash
    expect(consoleSpy).toHaveBeenCalledWith('Failed to update issue:', expect.any(Error));
    consoleSpy.mockRestore();
  });
});
