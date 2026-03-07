import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useIssues } from '../../src/hooks/useIssues';
import { API_BASE } from '../../src/config';

const mockIssue = {
  id: 'issue-1',
  title: 'Test Issue',
  description: 'A test issue',
  status: 'backlog' as const,
  agent: 'hermes',
  command: 'echo test',
  terminalId: null,
  branch: null,
  parentId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// A no-op subscribe that returns an unsubscribe function
const mockSubscribe = vi.fn(() => vi.fn());

describe('useIssues', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches issues on mount', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([mockIssue]),
    }) as any;

    const { result } = renderHook(() => useIssues(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.issues).toHaveLength(1);
    expect(result.current.issues[0].id).toBe('issue-1');
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/issues`);
  });

  it('createIssue calls POST with correct URL', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ...mockIssue, id: 'new-1' }) }) as any;

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
      .mockResolvedValueOnce({ json: () => Promise.resolve([mockIssue]) }) // initial fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({}) }) as any; // PATCH

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
      .mockResolvedValueOnce({ json: () => Promise.resolve([mockIssue]) }) // initial fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({}) }) as any; // DELETE

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
      .mockResolvedValueOnce({ json: () => Promise.resolve([mockIssue]) }) // initial fetch
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
});
