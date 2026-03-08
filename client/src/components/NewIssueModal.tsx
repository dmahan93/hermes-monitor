import { useEffect, useRef, useState } from 'react';
import type { AgentPreset } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './NewIssueModal.css';

interface NewIssueModalProps {
  agents: AgentPreset[];
  agentsLoading: boolean;
  agentsError: string | null;
  onSubmit: (title: string, description: string, agent: string, command: string, branch: string) => void;
  onClose: () => void;
}

export function NewIssueModal({ agents, agentsLoading, agentsError, onSubmit, onClose }: NewIssueModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agent, setAgent] = useState('hermes');
  const [command, setCommand] = useState('');
  const [branch, setBranch] = useState('');

  const selectedAgent = agents.find((a) => a.id === agent);
  const showCommand = agent === 'custom';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(
      title.trim(),
      description.trim(),
      agent,
      showCommand ? command.trim() : '',
      branch.trim()
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" ref={modalRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-issue-modal-title">
        <div className="modal-header">
          <span className="modal-title" id="new-issue-modal-title">NEW ISSUE <span className="modal-title-hint">→ backlog</span></span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <label className="modal-field">
            <span className="modal-label">title *</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
            />
          </label>
          <label className="modal-field">
            <span className="modal-label">description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Details, context, acceptance criteria..."
              rows={3}
            />
          </label>
          <label className="modal-field">
            <span className="modal-label">agent</span>
            {agentsError ? (
              <span className="modal-error">⚠ Failed to load agents: {agentsError}</span>
            ) : (
              <select
                className="modal-select"
                value={agentsLoading ? '' : agent}
                onChange={(e) => setAgent(e.target.value)}
                disabled={agentsLoading}
              >
                {agentsLoading ? (
                  <option value="">Loading agents...</option>
                ) : (
                  agents.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.installed === false}>
                      {a.icon} {a.name}{a.installed === false ? ' (not installed)' : ''}
                    </option>
                  ))
                )}
              </select>
            )}
            {selectedAgent && !agentsLoading && !agentsError && (
              <span className="modal-hint">{selectedAgent.description}</span>
            )}
          </label>
          {showCommand && (
            <label className="modal-field">
              <span className="modal-label">command</span>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder='e.g. my-agent --task "{{title}}"'
              />
              <span className="modal-hint">
                variables: {'{{title}}'}, {'{{description}}'}, {'{{branch}}'}, {'{{id}}'}
              </span>
            </label>
          )}
          <label className="modal-field">
            <span className="modal-label">branch</span>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="e.g. fix/login-bug"
            />
          </label>
          <div className="modal-backlog-hint">
            issue will be added to the backlog for planning before moving to TODO
          </div>
          <div className="modal-actions">
            <button type="button" className="modal-btn modal-btn-cancel" onClick={onClose}>
              [CANCEL]
            </button>
            <button type="submit" className="modal-btn modal-btn-submit" disabled={!title.trim() || agentsLoading || !!agentsError}>
              [CREATE]
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
