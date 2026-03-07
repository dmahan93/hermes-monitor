import { useEffect, useState } from 'react';
import type { AgentPreset } from '../types';

interface NewIssueModalProps {
  agents: AgentPreset[];
  onSubmit: (title: string, description: string, agent: string, command: string, branch: string) => void;
  onClose: () => void;
}

export function NewIssueModal({ agents, onSubmit, onClose }: NewIssueModalProps) {
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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">NEW ISSUE <span className="modal-title-hint">→ backlog</span></span>
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
            <select
              className="modal-select"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={a.installed === false}>
                  {a.icon} {a.name}{a.installed === false ? ' (not installed)' : ''}
                </option>
              ))}
            </select>
            {selectedAgent && (
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
            <button type="submit" className="modal-btn modal-btn-submit" disabled={!title.trim()}>
              [CREATE]
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
