import { useState, useCallback, useRef, useEffect } from 'react';

export interface ErrorEntry {
  id: string;
  message: string;
  timestamp: number;
}

const AUTO_DISMISS_MS = 5000;
const MAX_TOASTS = 5;
/** Suppress duplicate messages within this window (ms). */
const DEDUP_WINDOW_MS = 2000;

let nextId = 0;

export function useErrorToast() {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Track recent messages in a ref for synchronous dedup checking.
  // Map<message, timestamp> — avoids the React 18 batching pitfall where
  // reading variables set inside a setErrors() updater is unreliable.
  const recentMessagesRef = useRef<Map<string, number>>(new Map());

  const removeError = useCallback((id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addError = useCallback((message: string): string | null => {
    const now = Date.now();
    const id = `error-${++nextId}-${now}`;

    // Prune stale entries from the dedup map to prevent unbounded growth
    recentMessagesRef.current.forEach((ts, msg) => {
      if (now - ts > DEDUP_WINDOW_MS) recentMessagesRef.current.delete(msg);
    });

    // Synchronous dedup check via ref — safe regardless of React batching
    const lastSeen = recentMessagesRef.current.get(message);
    if (lastSeen !== undefined && now - lastSeen < DEDUP_WINDOW_MS) {
      return null; // Duplicate within window — suppressed (no toast created)
    }
    recentMessagesRef.current.set(message, now);

    setErrors((prev) => {
      const entry: ErrorEntry = { id, message, timestamp: now };
      const next = [...prev, entry];

      // Enforce max toast count — drop oldest first
      if (next.length > MAX_TOASTS) {
        const evicted = next.slice(0, next.length - MAX_TOASTS);
        for (const e of evicted) {
          // Clean up timers for evicted toasts synchronously from within the updater
          // This is safe because timersRef is a ref (not state), so mutating it
          // has no React batching concerns.
          const timer = timersRef.current.get(e.id);
          if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(e.id);
          }
        }
        return next.slice(next.length - MAX_TOASTS);
      }
      return next;
    });

    // Schedule auto-dismiss
    const timer = setTimeout(() => {
      removeError(id);
    }, AUTO_DISMISS_MS);
    timersRef.current.set(id, timer);

    return id;
  }, [removeError]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return { errors, addError, removeError };
}
