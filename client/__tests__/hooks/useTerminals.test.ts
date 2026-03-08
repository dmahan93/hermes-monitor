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
      ok: true,
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
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockTerminal) }) as any; // POST

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
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockTerminal]) }) // initial fetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) }) as any; // DELETE

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

  // --- Error-path tests ---

  it('fetchTerminals does not inject data into state on server error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    }) as any;

    const { result } = renderHook(() => useTerminals());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.terminals).toHaveLength(0);
  });

  it('addTerminal does not add to state on server error', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }) }) as any;

    const { result } = renderHook(() => useTerminals());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let returnValue: any;
    await act(async () => {
      returnValue = await result.current.addTerminal('Test');
    });

    expect(returnValue).toBeNull();
    expect(result.current.terminals).toHaveLength(0);
  });

  it('removeTerminal does not remove from state on 500 error', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockTerminal]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({ error: 'fail' }) }) as any;

    const { result } = renderHook(() => useTerminals());

    await waitFor(() => {
      expect(result.current.terminals).toHaveLength(1);
    });

    await act(async () => {
      await result.current.removeTerminal('abc-123');
    });

    // Terminal should still be in state since 500 error prevented removal
    expect(result.current.terminals).toHaveLength(1);
  });

  // --- WebSocket event tests ---

  it('handles terminal:created WS event by adding terminal to state', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }) as any;

    let wsHandler: ((msg: any) => void) | null = null;
    const mockSubscribe = (handler: (msg: any) => void) => {
      wsHandler = handler;
      return () => { wsHandler = null; };
    };

    const { result } = renderHook(() => useTerminals(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.terminals).toHaveLength(0);

    const newTerminal = {
      id: 'ws-term-1',
      title: 'WS Terminal',
      command: '/bin/bash',
      cols: 80,
      rows: 24,
      pid: 1234,
      createdAt: Date.now(),
    };

    act(() => {
      wsHandler!({ type: 'terminal:created', terminal: newTerminal });
    });

    expect(result.current.terminals).toHaveLength(1);
    expect(result.current.terminals[0].id).toBe('ws-term-1');
    expect(result.current.terminals[0].title).toBe('WS Terminal');
  });

  it('handles terminal:created WS event without duplicating existing terminals', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([mockTerminal]),
    }) as any;

    let wsHandler: ((msg: any) => void) | null = null;
    const mockSubscribe = (handler: (msg: any) => void) => {
      wsHandler = handler;
      return () => { wsHandler = null; };
    };

    const { result } = renderHook(() => useTerminals(mockSubscribe));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.terminals).toHaveLength(1);

    // Send a terminal:created event for the same terminal — should be a no-op
    act(() => {
      wsHandler!({ type: 'terminal:created', terminal: mockTerminal });
    });

    expect(result.current.terminals).toHaveLength(1);
  });

  it('handles terminal:removed WS event by removing terminal from state', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([mockTerminal]),
    }) as any;

    let wsHandler: ((msg: any) => void) | null = null;
    const mockSubscribe = (handler: (msg: any) => void) => {
      wsHandler = handler;
      return () => { wsHandler = null; };
    };

    const { result } = renderHook(() => useTerminals(mockSubscribe));

    await waitFor(() => {
      expect(result.current.terminals).toHaveLength(1);
    });

    act(() => {
      wsHandler!({ type: 'terminal:removed', terminalId: 'abc-123' });
    });

    expect(result.current.terminals).toHaveLength(0);
  });

  it('removeTerminal tolerates 404 and still removes from state', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([mockTerminal]) }) // initial fetch
      .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) }) as any;

    const { result } = renderHook(() => useTerminals());

    await waitFor(() => {
      expect(result.current.terminals).toHaveLength(1);
    });

    await act(async () => {
      await result.current.removeTerminal('abc-123');
    });

    // Terminal should be removed from state even on 404 (already gone server-side)
    expect(result.current.terminals).toHaveLength(0);
  });
});
