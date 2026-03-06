import { useState, useCallback, useEffect } from 'react';
import { TerminalView } from './TerminalView';
import type { Issue, AgentPreset, ClientMessage, ServerMessage } from '../types';

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
}

export function PlanningPane({
  issue, agents, send, subscribe,
  onUpdate, onPromote, onStartPlanning, onStopPlanning, onClose,
}: PlanningPaneProps) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description);
  const [dirty, setDirty] = useState(false);

  // Sync local state with prop changes (e.g., from WebSocket updates)
  useEffect(() => {
    if (!dirty) {
      setTitle(issue.title);
      setDescription(issue.description);
    }
  }, [issue.title, issue.description, dirty]);

  const agent = agents.find((a) => a.id === issue.agent);

  const handleSave = useCallback(async () => {
    await onUpdate(issue.id, { title: title.trim(), description: description.trim() });
    setDirty(false);
  }, [issue.id, title, description, onUpdate]);

  const handlePromote = useCallback(async () => {
    // Save any unsaved changes first, then promote
    if (dirty) {
      await onUpdate(issue.id, { title: title.trim(), description: description.trim() });
    }
    onPromote(issue.id);
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
              <button className="planning-save-btn" onClick={handleSave}>
                [SAVE CHANGES]
              </button>
            )}
          </div>
        </div>
        <div className="planning-terminal">
          {issue.terminalId ? (
            <>
              <div className="planning-terminal-header">
                <span className="planning-terminal-label">▸ planning terminal</span>
                <button
                  className="planning-terminal-stop"
                  onClick={() => onStopPlanning(issue.id)}
                  title="Stop planning terminal"
                >
                  [×]
                </button>
              </div>
              <div className="planning-terminal-body">
                <TerminalView
                  terminalId={issue.terminalId}
                  send={send}
                  subscribe={subscribe}
                />
              </div>
            </>
          ) : (
            <div className="planning-terminal-empty">
              <div className="planning-terminal-empty-text">
                <div>no planning terminal active</div>
                <button
                  className="planning-terminal-start"
                  onClick={() => onStartPlanning(issue.id)}
                >
                  [START TERMINAL]
                </button>
                <div className="planning-terminal-hint">
                  opens a shell for exploring, researching, prototyping
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
