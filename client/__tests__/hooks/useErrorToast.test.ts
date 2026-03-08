import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useErrorToast } from '../../src/hooks/useErrorToast';

describe('useErrorToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with an empty error list', () => {
    const { result } = renderHook(() => useErrorToast());
    expect(result.current.errors).toHaveLength(0);
  });

  it('addError adds an error entry', () => {
    const { result } = renderHook(() => useErrorToast());

    act(() => {
      result.current.addError('Something went wrong');
    });

    expect(result.current.errors).toHaveLength(1);
    expect(result.current.errors[0].message).toBe('Something went wrong');
    expect(result.current.errors[0].id).toBeTruthy();
    expect(result.current.errors[0].timestamp).toBeGreaterThan(0);
  });

  it('addError stacks multiple errors', () => {
    const { result } = renderHook(() => useErrorToast());

    act(() => {
      result.current.addError('Error 1');
    });
    // Advance time past dedup window so distinct messages aren't collapsed
    act(() => {
      result.current.addError('Error 2');
    });
    act(() => {
      result.current.addError('Error 3');
    });

    expect(result.current.errors).toHaveLength(3);
    expect(result.current.errors[0].message).toBe('Error 1');
    expect(result.current.errors[2].message).toBe('Error 3');
  });

  it('removeError removes a specific error', () => {
    const { result } = renderHook(() => useErrorToast());

    let id: string | null;
    act(() => {
      id = result.current.addError('Error to remove');
    });
    act(() => {
      result.current.addError('Error to keep');
    });

    expect(result.current.errors).toHaveLength(2);

    act(() => {
      result.current.removeError(id!);
    });

    expect(result.current.errors).toHaveLength(1);
    expect(result.current.errors[0].message).toBe('Error to keep');
  });

  it('auto-dismisses errors after 5 seconds', () => {
    const { result } = renderHook(() => useErrorToast());

    act(() => {
      result.current.addError('Temporary error');
    });

    expect(result.current.errors).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.errors).toHaveLength(0);
  });

  it('manual dismiss cancels the auto-dismiss timer', () => {
    const { result } = renderHook(() => useErrorToast());

    let id: string;
    act(() => {
      id = result.current.addError('Manual dismiss');
    });

    act(() => {
      result.current.removeError(id!);
    });

    expect(result.current.errors).toHaveLength(0);

    // Advancing timers should not cause issues (timer was cleared)
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.errors).toHaveLength(0);
  });

  it('each error gets a unique id', () => {
    const { result } = renderHook(() => useErrorToast());

    act(() => {
      result.current.addError('Error A');
    });
    act(() => {
      result.current.addError('Error B');
    });

    const ids = result.current.errors.map((e) => e.id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  // --- Deduplication tests ---

  it('suppresses duplicate messages within the dedup window', () => {
    const { result } = renderHook(() => useErrorToast());

    act(() => {
      result.current.addError('Same error');
    });

    // Same message within 2s dedup window — should be suppressed
    act(() => {
      result.current.addError('Same error');
    });

    expect(result.current.errors).toHaveLength(1);
  });

  it('returns null for suppressed duplicate messages', () => {
    const { result } = renderHook(() => useErrorToast());

    let firstId: string | null;
    let secondId: string | null;

    act(() => {
      firstId = result.current.addError('Same error');
    });

    act(() => {
      secondId = result.current.addError('Same error');
    });

    expect(firstId!).toBeTruthy(); // First call returns a real ID
    expect(secondId!).toBeNull();  // Dedup'd call returns null
  });

  it('allows duplicate messages after the dedup window passes', () => {
    const { result } = renderHook(() => useErrorToast());

    act(() => {
      result.current.addError('Repeated error');
    });

    expect(result.current.errors).toHaveLength(1);

    // Advance past dedup window (2s) but before auto-dismiss (5s)
    act(() => {
      vi.advanceTimersByTime(2500);
    });

    act(() => {
      result.current.addError('Repeated error');
    });

    expect(result.current.errors).toHaveLength(2);
  });

  // --- Max toast count tests ---

  it('enforces a maximum of 5 toasts, dropping oldest', () => {
    const { result } = renderHook(() => useErrorToast());

    for (let i = 1; i <= 6; i++) {
      act(() => {
        result.current.addError(`Error ${i}`);
      });
    }

    expect(result.current.errors).toHaveLength(5);
    // Oldest error (Error 1) should have been evicted
    expect(result.current.errors[0].message).toBe('Error 2');
    expect(result.current.errors[4].message).toBe('Error 6');
  });

  it('cleans up timers for evicted toasts', () => {
    const { result } = renderHook(() => useErrorToast());

    // Add 6 errors — first one gets evicted
    for (let i = 1; i <= 6; i++) {
      act(() => {
        result.current.addError(`Error ${i}`);
      });
    }

    expect(result.current.errors).toHaveLength(5);

    // Advance past auto-dismiss — all remaining should dismiss without errors
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.errors).toHaveLength(0);
  });
});
