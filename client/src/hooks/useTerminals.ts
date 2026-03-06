import { useState, useCallback, useEffect } from 'react';
import type { TerminalInfo, GridItem, ServerMessage } from '../types';

const API = '/api';

export function useTerminals(subscribe?: (handler: (msg: ServerMessage) => void) => () => void) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [layout, setLayout] = useState<GridItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTerminals = useCallback(async () => {
    try {
      const res = await fetch(`${API}/terminals`);
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
      console.error('Failed to fetch terminals:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTerminals();
  }, [fetchTerminals]);

  const addTerminal = useCallback(async (title?: string, command?: string) => {
    try {
      const res = await fetch(`${API}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, command }),
      });
      const term: TerminalInfo = await res.json();
      setTerminals((prev) => [...prev, term]);
      setLayout((prev) => {
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
      return null;
    }
  }, []);

  const removeTerminal = useCallback(async (id: string) => {
    try {
      await fetch(`${API}/terminals/${id}`, { method: 'DELETE' });
      setTerminals((prev) => prev.filter((t) => t.id !== id));
      setLayout((prev) => prev.filter((l) => l.i !== id));
    } catch (err) {
      console.error('Failed to remove terminal:', err);
    }
  }, []);

  // Real-time terminal removal via WebSocket
  useEffect(() => {
    if (!subscribe) return;
    const unsub = subscribe((msg) => {
      if (msg.type === 'terminal:removed') {
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

  // Auto-remove terminals when the server kills them (e.g. after conflict resolution)
  useEffect(() => {
    if (!subscribe) return;
    const unsub = subscribe((msg) => {
      if (msg.type === 'terminal:removed') {
        setTerminals((prev) => prev.filter((t) => t.id !== msg.terminalId));
        setLayout((prev) => prev.filter((l) => l.i !== msg.terminalId));
      }
    });
    return unsub;
  }, [subscribe]);

  return { terminals, layout, loading, addTerminal, removeTerminal, updateLayout, refetch: fetchTerminals };
}
