import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNotificationSound, playTone } from '../../src/hooks/useNotificationSound';
import type { AlertTone, ServerMessage } from '../../src/types';

// Mock AudioContext
function createMockAudioContext() {
  const mockGain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  const mockOscillator = {
    type: 'sine',
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const mockCtx = {
    currentTime: 0,
    state: 'running' as AudioContextState,
    destination: {},
    createGain: vi.fn(() => mockGain),
    createOscillator: vi.fn(() => ({ ...mockOscillator })),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
  return { mockCtx: mockCtx as unknown as AudioContext, mockGain, mockOscillator };
}

describe('playTone', () => {
  it('creates oscillators for positive tone', () => {
    const { mockCtx } = createMockAudioContext();
    playTone(mockCtx, 'positive');
    // Positive = ascending two-note chime (2 oscillators)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
    expect(mockCtx.createGain).toHaveBeenCalledTimes(1);
  });

  it('creates oscillators for alert tone', () => {
    const { mockCtx } = createMockAudioContext();
    playTone(mockCtx, 'alert');
    // Alert = two short pips (2 oscillators)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('creates oscillators for negative tone', () => {
    const { mockCtx } = createMockAudioContext();
    playTone(mockCtx, 'negative');
    // Negative = descending two-note (2 oscillators)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('creates single oscillator for neutral tone', () => {
    const { mockCtx } = createMockAudioContext();
    playTone(mockCtx, 'neutral');
    // Neutral = single pip (1 oscillator)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(1);
  });
});

describe('useNotificationSound', () => {
  let handlers: Set<(msg: ServerMessage) => void>;
  let mockSubscribe: (handler: (msg: ServerMessage) => void) => () => void;
  let originalAudioContext: typeof globalThis.AudioContext;

  beforeEach(() => {
    handlers = new Set();
    mockSubscribe = (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    };

    // Mock AudioContext globally
    const { mockCtx } = createMockAudioContext();
    originalAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = vi.fn(() => mockCtx) as any;
  });

  afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
  });

  it('does not subscribe when disabled', () => {
    renderHook(() => useNotificationSound(mockSubscribe, false));
    expect(handlers.size).toBe(0);
  });

  it('subscribes when enabled', () => {
    renderHook(() => useNotificationSound(mockSubscribe, true));
    expect(handlers.size).toBe(1);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useNotificationSound(mockSubscribe, true));
    expect(handlers.size).toBe(1);
    unmount();
    expect(handlers.size).toBe(0);
  });

  it('creates AudioContext on first status change message', () => {
    renderHook(() => useNotificationSound(mockSubscribe, true));

    const msg: ServerMessage = {
      type: 'issue:statusChanged',
      issueId: 'test-1',
      title: 'Test',
      from: 'backlog',
      to: 'todo',
      alertTone: 'neutral',
    };

    for (const handler of handlers) {
      handler(msg);
    }

    expect(AudioContext).toHaveBeenCalledTimes(1);
  });

  it('ignores non-statusChanged messages', () => {
    renderHook(() => useNotificationSound(mockSubscribe, true));

    const msg: ServerMessage = {
      type: 'issue:updated',
      issue: {
        id: 'test-1',
        title: 'Test',
        description: '',
        status: 'todo',
        agent: 'hermes',
        command: '',
        terminalId: null,
        branch: null,
        parentId: null,
        reviewerModel: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };

    for (const handler of handlers) {
      handler(msg);
    }

    // AudioContext should NOT be created for non-statusChanged messages
    expect(AudioContext).not.toHaveBeenCalled();
  });

  it('debounces rapid status change messages', () => {
    renderHook(() => useNotificationSound(mockSubscribe, true));

    const msg: ServerMessage = {
      type: 'issue:statusChanged',
      issueId: 'test-1',
      title: 'Test',
      from: 'backlog',
      to: 'todo',
      alertTone: 'neutral',
    };

    // Fire twice rapidly
    for (const handler of handlers) {
      handler(msg);
      handler(msg);
    }

    // AudioContext should only be created once (debounced)
    expect(AudioContext).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes when enabled changes', () => {
    const { rerender } = renderHook(
      ({ enabled }) => useNotificationSound(mockSubscribe, enabled),
      { initialProps: { enabled: false } },
    );

    expect(handlers.size).toBe(0);

    rerender({ enabled: true });
    expect(handlers.size).toBe(1);

    rerender({ enabled: false });
    expect(handlers.size).toBe(0);
  });
});
