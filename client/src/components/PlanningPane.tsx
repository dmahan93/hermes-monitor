import { useState, useCallback, useEffect, useRef } from 'react';
import { TerminalView } from './TerminalView';
import type { Issue, AgentPreset, ClientMessage, ServerMessage } from '../types';
import './PlanningPane.css';

interface PlanningPaneProps {
  issue: Issue;
  agents: AgentPreset[];
  send: (msg: ClientMessage) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;
  onUpdate: (id: string, updates: Partial<Issue>) => Promise<void>;
  onPromote: (id: string) => void;
  onStartPlanning: (id: string) => void;
  onStopPlanning: (id: string) => void;
  onClose: () => void;
  reconnectCount?: number;
}

export function PlanningPane({
  issue, agents, send, subscribe,
  onUpdate, onPromote, onStartPlanning, onStopPlanning, onClose,
  reconnectCount,
}: PlanningPaneProps) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Sync local state with prop changes (e.g., from WebSocket updates).
  // When dirty, local edits are preserved and external updates are intentionally
  // dropped — the user's version wins on save. This is acceptable for a single-user
  // tool but would need conflict detection for multi-user scenarios.
  useEffect(() => {
    if (!dirty) {
      setTitle(issue.title);
      setDescription(issue.description);
    }
  }, [issue.title, issue.description, dirty]);

  const agent = agents.find((a) => a.id === issue.agent);

  const handleSave = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onUpdate(issue.id, { title: trimmed, description: description.trim() });
      if (mountedRef.current) setDirty(false);
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [issue.id, title, description, saving, onUpdate]);

  const handlePromote = useCallback(async () => {
    // Save any unsaved changes first, then promote
    try {
      if (dirty) {
        const trimmed = title.trim();
        if (trimmed) {
          await onUpdate(issue.id, { title: trimmed, description: description.trim() });
        }
      }
      onPromote(issue.id);
    } catch (err) {
      console.error('Failed to save before promoting:', err);
      // Still promote even if save failed — the user explicitly requested promotion
      onPromote(issue.id);
    }
  }, [issue.id, title, description, dirty, onUpdate, onPromote]);

  return (
    <div className="planning-pane">
      <div className="planning-header">
        <button className="planning-back-btn" onClick={onClose} title="Back to board">
          ← BOARD
        </button>
        <span className="planning-title-display">
          planning: {issue.title}
        </span>
        <div className="planning-header-actions">
          <button className="planning-promote-btn" onClick={handlePromote}>
            [→ MOVE TO TODO]
          </button>
        </div>
      </div>
      <div className="planning-body">
        <div className="planning-details">
          <div className="planning-form">
            <label className="planning-field">
              <span className="planning-label">title</span>
              <input
                type="text"
                className="planning-input"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
              />
            </label>
            <label className="planning-field">
              <span className="planning-label">description</span>
              <textarea
                className="planning-textarea"
                value={description}
                onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
                rows={6}
                placeholder="Plan details, acceptance criteria, notes..."
              />
            </label>
            {agent && (
              <div className="planning-meta-row">
                <span className="planning-label">agent</span>
                <span className="planning-value">{agent.icon} {agent.name}</span>
              </div>
            )}
            {issue.branch && (
              <div className="planning-meta-row">
                <span className="planning-label">branch</span>
                <span className="planning-value planning-branch">⎇ {issue.branch}</span>
              </div>
            )}
            {dirty && (
              <button
                className="planning-save-btn"
                onClick={handleSave}
                disabled={saving || !title.trim()}
              >
                {saving ? '[SAVING...]' : '[SAVE CHANGES]'}
              </button>
            )}
          </div>
        </div>
        <div className="planning-terminal">
          {issue.terminalId ? (
            <>
              <div className="planning-terminal-header">
                <span className="planning-terminal-label">▸ {agent ? `${agent.icon} ${agent.name}` : 'planning agent'}</span>
                <button
                  className="planning-terminal-stop"
                  onClick={() => onStopPlanning(issue.id)}
                  title="Stop planning agent"
                >
                  [×]
                </button>
              </div>
              <div className="planning-terminal-body">
                <TerminalView
                  terminalId={issue.terminalId}
                  send={send}
                  subscribe={subscribe}
                  reconnectCount={reconnectCount}
                />
              </div>
            </>
          ) : (
            <div className="planning-terminal-empty">
              <div className="planning-terminal-empty-text">
                <div>no planning agent active</div>
                <button
                  className="planning-terminal-start"
                  onClick={() => onStartPlanning(issue.id)}
                >
                  {agent ? `[START ${agent.name.toUpperCase()}]` : '[START AGENT]'}
                </button>
                <div className="planning-terminal-hint">
                  launches {agent ? agent.name : 'an agent'} to explore, research, and prototype
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
