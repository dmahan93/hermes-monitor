import { useState } from 'react';

interface NewIssueModalProps {
  onSubmit: (title: string, description: string, command: string, branch: string) => void;
  onClose: () => void;
}

export function NewIssueModal({ onSubmit, onClose }: NewIssueModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [branch, setBranch] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), description.trim(), command.trim(), branch.trim());
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">NEW ISSUE</span>
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
            <span className="modal-label">command</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder='e.g. hermes --task "{{title}}"'
            />
          </label>
          <label className="modal-field">
            <span className="modal-label">branch</span>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="e.g. fix/login-bug"
            />
          </label>
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
