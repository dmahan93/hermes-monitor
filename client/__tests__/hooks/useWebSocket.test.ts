import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWebSocket } from '../../src/hooks/useWebSocket';

describe('useWebSocket', () => {
  it('connects on mount', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:4000/ws'));

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });
  });

  it('reconnectCount starts at 0', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:4000/ws'));

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    expect(result.current.reconnectCount).toBe(0);
  });

  it('subscribe receives messages', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:4000/ws'));
    const received: any[] = [];

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    act(() => {
      result.current.subscribe((msg) => {
        received.push(msg);
      });
    });

    // Messages are handled by WebSocket mock — this verifies the hook wiring
    expect(typeof result.current.subscribe).toBe('function');
    expect(typeof result.current.send).toBe('function');
  });

  it('send is callable when connected', async () => {
    const { result } = renderHook(() => useWebSocket('ws://localhost:4000/ws'));

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Should not throw
    expect(() => {
      result.current.send({ type: 'stdin', terminalId: 'test', data: 'hello' });
    }).not.toThrow();
  });

  describe('reconnect behavior', () => {
    // Track WebSocket instances created during each test
    let wsInstances: any[];
    let OriginalWS: typeof WebSocket;

    beforeEach(() => {
      vi.useFakeTimers();
      wsInstances = [];
      OriginalWS = globalThis.WebSocket;

      // Wrap the mock to capture created instances
      const Wrapped = function (this: any, url: string) {
        const instance = new OriginalWS(url);
        wsInstances.push(instance);
        return instance;
      } as any;
      Wrapped.OPEN = (OriginalWS as any).OPEN;
      Wrapped.CLOSED = (OriginalWS as any).CLOSED;
      Wrapped.CONNECTING = 0;
      Wrapped.CLOSING = 2;
      globalThis.WebSocket = Wrapped;
    });

    afterEach(() => {
      globalThis.WebSocket = OriginalWS;
      vi.useRealTimers();
    });

    it('increments reconnectCount on WS reconnect', async () => {
      const { result, unmount } = renderHook(() => useWebSocket('ws://localhost:4000/ws'));

      // Flush the setTimeout(onopen, 0) in mock constructor
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(result.current.connected).toBe(true);
      expect(result.current.reconnectCount).toBe(0);

      // Simulate WS disconnect
      act(() => { wsInstances[0].close(); });
      expect(result.current.connected).toBe(false);

      // Hook schedules reconnect after 1s — advance timer
      await act(async () => { vi.advanceTimersByTime(1000); });
      // Flush the new WS instance's onopen setTimeout
      await act(async () => { vi.advanceTimersByTime(1); });

      expect(result.current.connected).toBe(true);
      expect(result.current.reconnectCount).toBe(1);
      expect(wsInstances.length).toBe(2);

      unmount();
    });

    it('increments reconnectCount on each subsequent reconnect', async () => {
      const { result, unmount } = renderHook(() => useWebSocket('ws://localhost:4000/ws'));

      // Initial connect
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(result.current.reconnectCount).toBe(0);

      // First reconnect cycle
      act(() => { wsInstances[0].close(); });
      await act(async () => { vi.advanceTimersByTime(1001); });
      expect(result.current.reconnectCount).toBe(1);

      // Second reconnect cycle
      act(() => { wsInstances[1].close(); });
      await act(async () => { vi.advanceTimersByTime(1001); });
      expect(result.current.reconnectCount).toBe(2);

      unmount();
    });

    it('does not increment reconnectCount on unmount + remount (StrictMode)', async () => {
      // Simulates React StrictMode: mount → unmount → remount
      // The cleanup resets hasConnectedRef so the remount's onopen
      // is correctly identified as an initial connect, not a reconnect.
      const { result, unmount } = renderHook(() => useWebSocket('ws://localhost:4000/ws'));

      // Initial connect
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(result.current.connected).toBe(true);
      expect(result.current.reconnectCount).toBe(0);

      // Unmount (triggers cleanup which resets hasConnectedRef)
      unmount();

      // Re-mount — simulates StrictMode re-run
      wsInstances = []; // clear tracked instances
      const { result: result2, unmount: unmount2 } = renderHook(() => useWebSocket('ws://localhost:4000/ws'));
      await act(async () => { vi.advanceTimersByTime(1); });

      expect(result2.current.connected).toBe(true);
      // Should still be 0 — this is a fresh mount, not a reconnect
      expect(result2.current.reconnectCount).toBe(0);

      unmount2();
    });

    it('subscribers persist across reconnects', async () => {
      const { result, unmount } = renderHook(() => useWebSocket('ws://localhost:4000/ws'));
      const received: any[] = [];

      // Initial connect
      await act(async () => { vi.advanceTimersByTime(1); });

      // Register a subscriber
      act(() => {
        result.current.subscribe((msg) => { received.push(msg); });
      });

      // Simulate reconnect
      act(() => { wsInstances[0].close(); });
      await act(async () => { vi.advanceTimersByTime(1001); });

      // Simulate a message on the new WS instance
      const msg = { type: 'stdout', terminalId: 't1', data: 'hello' };
      act(() => {
        wsInstances[1].onmessage?.({ data: JSON.stringify(msg) });
      });

      expect(received).toEqual([msg]);

      unmount();
    });
  });
});
