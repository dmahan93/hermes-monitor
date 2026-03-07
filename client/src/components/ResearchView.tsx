import { useEffect, useState, useCallback, useRef } from 'react';
import { TerminalView } from './TerminalView';
import type { ServerMessage } from '../types';

const API = '/api';
const STORAGE_KEY = 'hermes:researchTerminalId';

interface ResearchViewProps {
  send: (msg: any) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;
}

/**
 * Research tab — a single full-screen terminal for ad-hoc exploration.
 * Lazily creates a dedicated terminal on first visit. The terminal ID is
 * persisted in localStorage so it survives page reloads.
 */
export function ResearchView({ send, subscribe }: ResearchViewProps) {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  // Check if a terminal ID from storage still exists on the server
  const validateTerminal = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API}/terminals`);
      const terminals = await res.json();
      return terminals.some((t: { id: string }) => t.id === id);
    } catch {
      return false;
    }
  }, []);

  // Create a fresh research terminal
  const createTerminal = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Research' }),
      });
      if (!res.ok) throw new Error('Failed to create terminal');
      const term = await res.json();
      return term.id;
    } catch (err: any) {
      setError(err.message || 'Failed to create research terminal');
      return null;
    }
  }, []);

  // Initialize: restore from localStorage or create new
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    (async () => {
      setLoading(true);
      setError(null);

      // Try to restore a saved terminal
      const savedId = localStorage.getItem(STORAGE_KEY);
      if (savedId) {
        const exists = await validateTerminal(savedId);
        if (exists) {
          setTerminalId(savedId);
          setLoading(false);
          return;
        }
        // Stale — clear it
        localStorage.removeItem(STORAGE_KEY);
      }

      // Create a new one
      const newId = await createTerminal();
      if (newId) {
        localStorage.setItem(STORAGE_KEY, newId);
        setTerminalId(newId);
      }
      setLoading(false);
    })();
  }, [validateTerminal, createTerminal]);

  // Listen for terminal removal — if our research terminal gets killed,
  // clear state so we can recreate on next interaction
  useEffect(() => {
    if (!terminalId) return;
    const unsub = subscribe((msg) => {
      if (msg.type === 'terminal:removed' && msg.terminalId === terminalId) {
        localStorage.removeItem(STORAGE_KEY);
        setTerminalId(null);
      }
    });
    return unsub;
  }, [terminalId, subscribe]);

  // Recreate terminal if it was removed
  const handleRecreate = useCallback(async () => {
    setLoading(true);
    setError(null);
    const newId = await createTerminal();
    if (newId) {
      localStorage.setItem(STORAGE_KEY, newId);
      setTerminalId(newId);
    }
    setLoading(false);
  }, [createTerminal]);

  if (loading) {
    return (
      <div className="research-view">
        <div className="research-loading">Spawning research terminal…</div>
      </div>
    );
  }

  if (error || !terminalId) {
    return (
      <div className="research-view">
        <div className="research-empty">
          <div className="research-empty-text">
            {error || 'No research terminal available.'}
          </div>
          <button className="research-recreate-btn" onClick={handleRecreate}>
            [NEW TERMINAL]
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="research-view">
      <div className="research-header">
        <span className="research-title">⧫ RESEARCH</span>
        <button
          className="research-recreate-btn"
          onClick={handleRecreate}
          title="Kill and respawn terminal"
        >
          [RESPAWN]
        </button>
      </div>
      <div className="research-terminal">
        <TerminalView
          terminalId={terminalId}
          send={send}
          subscribe={subscribe}
        />
      </div>
    </div>
  );
}
