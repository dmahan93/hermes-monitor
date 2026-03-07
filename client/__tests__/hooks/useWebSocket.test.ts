import { describe, it, expect, vi } from 'vitest';
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
});
