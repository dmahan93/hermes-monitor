import { useEffect, useState, useCallback, useRef } from 'react';
import { TerminalView } from './TerminalView';
import type { ServerMessage } from '../types';
import './ResearchView.css';

const API = '/api';
const STORAGE_KEY = 'hermes:researchTerminalId';

interface ResearchViewProps {
  send: (msg: any) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;
  onTerminalIdChange?: (id: string | null) => void;
}

/**
 * Research tab — a single full-screen terminal for ad-hoc exploration.
 * Lazily creates a dedicated terminal on first visit. The terminal ID is
 * persisted in localStorage so it survives page reloads.
 */
export function ResearchView({ send, subscribe, onTerminalIdChange }: ResearchViewProps) {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);
  const creatingRef = useRef(false);

  // Notify parent when terminal ID changes
  const updateTerminalId = useCallback((id: string | null) => {
    setTerminalId(id);
    onTerminalIdChange?.(id);
  }, [onTerminalIdChange]);

  // Check if a terminal ID from storage still exists on the server.
  // Throws on network errors so callers can distinguish "not found" from "unreachable".
  const validateTerminal = useCallback(async (id: string): Promise<boolean> => {
    const res = await fetch(`${API}/terminals`);
    if (!res.ok) throw new Error('Failed to fetch terminals');
    const terminals = await res.json();
    return terminals.some((t: { id: string }) => t.id === id);
  }, []);

  // Delete a terminal on the server (best-effort, errors are swallowed)
  const deleteTerminal = useCallback(async (id: string) => {
    try {
      await fetch(`${API}/terminals/${id}`, { method: 'DELETE' });
    } catch {
      // Best-effort cleanup — if it fails the server will reap eventually
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
        try {
          const exists = await validateTerminal(savedId);
          if (exists) {
            updateTerminalId(savedId);
            setLoading(false);
            return;
          }
        } catch {
          // Network error — show error instead of creating a duplicate
          setError('Could not reach server to validate terminal. Try again.');
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
        updateTerminalId(newId);
      }
      setLoading(false);
    })();
  }, [validateTerminal, createTerminal, updateTerminalId]);

  // Listen for terminal removal — if our research terminal gets killed,
  // clear state so we can recreate on next interaction
  useEffect(() => {
    if (!terminalId) return;
    const unsub = subscribe((msg) => {
      if (msg.type === 'terminal:removed' && msg.terminalId === terminalId) {
        localStorage.removeItem(STORAGE_KEY);
        updateTerminalId(null);
      }
    });
    return unsub;
  }, [terminalId, subscribe, updateTerminalId]);

  // Recreate terminal — kills the old one first to prevent orphans
  const handleRecreate = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      setLoading(true);
      setError(null);

      // Kill old terminal first
      if (terminalId) {
        await deleteTerminal(terminalId);
      }
      localStorage.removeItem(STORAGE_KEY);
      updateTerminalId(null);

      const newId = await createTerminal();
      if (newId) {
        localStorage.setItem(STORAGE_KEY, newId);
        updateTerminalId(newId);
      }
      setLoading(false);
    } finally {
      creatingRef.current = false;
    }
  }, [createTerminal, deleteTerminal, terminalId, updateTerminalId]);

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
