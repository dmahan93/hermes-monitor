import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTerminals } from '../../src/hooks/useTerminals';
import { API_BASE } from '../../src/config';

const mockTerminal = {
  id: 'abc-123',
  title: 'Terminal 1',
  command: '/bin/bash',
  cols: 80,
  rows: 24,
  pid: 9999,
  createdAt: Date.now(),
};

describe('useTerminals', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches terminals on mount', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([mockTerminal]),
    }) as any;

    const { result } = renderHook(() => useTerminals());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.terminals).toHaveLength(1);
    expect(result.current.terminals[0].id).toBe('abc-123');
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/terminals`);
  });

  it('addTerminal calls POST and updates state', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve(mockTerminal) }) as any; // POST

    const { result } = renderHook(() => useTerminals());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.addTerminal('Test');
    });

    expect(result.current.terminals).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/terminals`, expect.objectContaining({
      method: 'POST',
    }));
  });

  it('removeTerminal calls DELETE and updates state', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve([mockTerminal]) }) // initial fetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ ok: true }) }) as any; // DELETE

    const { result } = renderHook(() => useTerminals());

    await waitFor(() => {
      expect(result.current.terminals).toHaveLength(1);
    });

    await act(async () => {
      await result.current.removeTerminal('abc-123');
    });

    expect(result.current.terminals).toHaveLength(0);
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/terminals/abc-123`, { method: 'DELETE' });
  });
});
