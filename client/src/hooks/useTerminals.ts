import { useState, useCallback, useEffect, useRef } from 'react';
import type { TerminalInfo, GridItem, ServerMessage } from '../types';
import { API_BASE } from '../config';

export function useTerminals(subscribe?: (handler: (msg: ServerMessage) => void) => () => void, onError?: (message: string) => void) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [layout, setLayout] = useState<GridItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Store onError in a ref to avoid triggering re-renders and infinite fetch loops
  // when callers pass an unstable callback reference.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fetchTerminals = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE}/terminals`, { signal });
      if (!res.ok) throw new Error(`Failed to fetch terminals (${res.status})`);
      const data: TerminalInfo[] = await res.json();
      setTerminals(data);
      // Generate layout for any terminals not already in layout
      setLayout((prev) => {
        const existing = new Set(prev.map((l) => l.i));
        const newItems = data
          .filter((t) => !existing.has(t.id))
          .map((t, idx) => ({
            i: t.id,
            x: (prev.length + idx) % 2 * 6,
            y: Math.floor((prev.length + idx) / 2) * 4,
            w: 6,
            h: 4,
          }));
        return [...prev.filter((l) => data.some((t) => t.id === l.i)), ...newItems];
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Failed to fetch terminals:', err);
      onErrorRef.current?.('Failed to fetch terminals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchTerminals(controller.signal);
    return () => controller.abort();
  }, [fetchTerminals]);

  const addTerminal = useCallback(async (title?: string, command?: string) => {
    try {
      const res = await fetch(`${API_BASE}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, command }),
      });
      if (!res.ok) throw new Error(`Failed to create terminal (${res.status})`);
      const term: TerminalInfo = await res.json();
      setTerminals((prev) => {
        if (prev.some((t) => t.id === term.id)) return prev;
        return [...prev, term];
      });
      setLayout((prev) => {
        if (prev.some((l) => l.i === term.id)) return prev;
        const col = prev.length % 2;
        const row = Math.floor(prev.length / 2);
        return [
          ...prev,
          { i: term.id, x: col * 6, y: row * 4, w: 6, h: 4 },
        ];
      });
      return term;
    } catch (err) {
      console.error('Failed to create terminal:', err);
      onErrorRef.current?.('Failed to create terminal');
      return null;
    }
  }, []);

  const removeTerminal = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/terminals/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`Failed to remove terminal (${res.status})`);
      setTerminals((prev) => prev.filter((t) => t.id !== id));
      setLayout((prev) => prev.filter((l) => l.i !== id));
    } catch (err) {
      console.error('Failed to remove terminal:', err);
      onErrorRef.current?.('Failed to remove terminal');
    }
  }, []);

  // Real-time terminal creation and removal via WebSocket
  useEffect(() => {
    if (!subscribe) return;
    const unsub = subscribe((msg) => {
      if (msg.type === 'terminal:created') {
        const terminal = msg.terminal;
        setTerminals((prev) => {
          if (prev.some((t) => t.id === terminal.id)) return prev;
          return [...prev, terminal];
        });
        setLayout((prev) => {
          if (prev.some((l) => l.i === terminal.id)) return prev;
          const col = prev.length % 2;
          const row = Math.floor(prev.length / 2);
          return [...prev, { i: terminal.id, x: col * 6, y: row * 4, w: 6, h: 4 }];
        });
      } else if (msg.type === 'terminal:removed') {
        const removedId = msg.terminalId;
        setTerminals((prev) => prev.filter((t) => t.id !== removedId));
        setLayout((prev) => prev.filter((l) => l.i !== removedId));
      }
    });
    return unsub;
  }, [subscribe]);

  const updateLayout = useCallback((newLayout: GridItem[]) => {
    setLayout(newLayout);
  }, []);

  return { terminals, layout, loading, addTerminal, removeTerminal, updateLayout, refetch: fetchTerminals };
}
