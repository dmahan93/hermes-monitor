import { useState } from 'react';
import type { Issue, IssueStatus, PullRequest, AgentPreset } from '../types';

interface IssueDetailProps {
  issue: Issue;
  agents: AgentPreset[];
  pr?: PullRequest;
  initialEditing?: boolean;
  subtasks?: Issue[];
  parentIssue?: Issue;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Issue>) => void;
  onStatusChange: (id: string, status: IssueStatus) => void;
  onDelete: (id: string) => void;
  onTerminalClick?: (issueId: string) => void;
  onPRClick?: (prId: string) => void;
  onCreateSubtask?: (parentId: string, title: string, description?: string) => void;
  onSubtaskClick?: (issueId: string) => void;
  onParentClick?: (issueId: string) => void;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  backlog: { label: 'BACKLOG', className: 'issue-status-backlog' },
  todo: { label: 'TODO', className: 'issue-status-todo' },
  in_progress: { label: 'IN PROGRESS', className: 'issue-status-wip' },
  review: { label: 'REVIEW', className: 'issue-status-review' },
  done: { label: 'DONE', className: 'issue-status-done' },
};

export function IssueDetail({
  issue, agents, pr, initialEditing, subtasks, parentIssue,
  onClose, onUpdate, onStatusChange, onDelete, onTerminalClick, onPRClick,
  onCreateSubtask, onSubtaskClick, onParentClick,
}: IssueDetailProps) {
  // initialEditing is only read at mount. This works because App.tsx renders
  // <IssueDetail key={`${detailIssueId}-${detailEditing}`}>, forcing a full
  // remount when switching issues OR when toggling between view/edit mode.
  const [editing, setEditing] = useState(initialEditing ?? false);
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description);
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtaskDesc, setSubtaskDesc] = useState('');
  const agent = agents.find((a) => a.id === issue.agent);
  const status = STATUS_LABELS[issue.status] || STATUS_LABELS.todo;

  const handleAddSubtask = () => {
    if (!subtaskTitle.trim() || !onCreateSubtask) return;
    onCreateSubtask(issue.id, subtaskTitle.trim(), subtaskDesc.trim() || undefined);
    setSubtaskTitle('');
    setSubtaskDesc('');
    setShowSubtaskForm(false);
  };

  const handleSave = () => {
    onUpdate(issue.id, { title: title.trim(), description: description.trim() });
    setEditing(false);
  };

  const handleCancel = () => {
    setTitle(issue.title);
    setDescription(issue.description);
    setEditing(false);
  };

  return (
    <div className="issue-detail-overlay" onClick={onClose}>
      <div className="issue-detail" onClick={(e) => e.stopPropagation()}>
        <div className="issue-detail-header">
          <span className={`issue-detail-status ${status.className}`}>{status.label}</span>
          <button className="issue-detail-close" onClick={onClose}>×</button>
        </div>

        <div className="issue-detail-body">
          {editing ? (
            <>
              <input
                className="issue-detail-title-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <textarea
                className="issue-detail-desc-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Description..."
              />
              <div className="issue-detail-edit-actions">
                <button className="modal-btn modal-btn-cancel" onClick={handleCancel}>[CANCEL]</button>
                <button className="modal-btn modal-btn-submit" onClick={handleSave}>[SAVE]</button>
              </div>
            </>
          ) : (
            <>
              <h2 className="issue-detail-title">{issue.title}</h2>
              {issue.description ? (
                <p className="issue-detail-desc">{issue.description}</p>
              ) : (
                <p className="issue-detail-desc issue-detail-no-desc">No description.</p>
              )}
              <button className="issue-detail-edit-btn" onClick={() => setEditing(true)}>[EDIT]</button>
            </>
          )}

          <div className="issue-detail-meta">
            <div className="issue-detail-meta-row">
              <span className="issue-detail-label">agent</span>
              <span className="issue-detail-value">
                {agent ? `${agent.icon} ${agent.name}` : issue.agent}
              </span>
            </div>
            {parentIssue && (
              <div className="issue-detail-meta-row">
                <span className="issue-detail-label">parent</span>
                <button
                  className="issue-detail-value issue-detail-parent-link"
                  onClick={() => onParentClick?.(parentIssue.id)}
                >
                  ↑ {parentIssue.title}
                </button>
              </div>
            )}
            {issue.branch && (
              <div className="issue-detail-meta-row">
                <span className="issue-detail-label">branch</span>
                <span className="issue-detail-value issue-detail-branch">⎇ {issue.branch}</span>
              </div>
            )}
            {issue.terminalId && (
              <div className="issue-detail-meta-row">
                <span className="issue-detail-label">terminal</span>
                <button
                  className="issue-detail-value issue-detail-terminal-link"
                  onClick={() => onTerminalClick?.(issue.id)}
                >
                  ▸ active — click to view
                </button>
              </div>
            )}
            {pr && (
              <div className="issue-detail-meta-row">
                <span className="issue-detail-label">pull request</span>
                <button
                  className="issue-detail-value issue-detail-pr-link"
                  onClick={() => onPRClick?.(pr.id)}
                >
                  PR: {pr.status} — {pr.changedFiles.length} files, {pr.comments.length} comments
                </button>
              </div>
            )}
            <div className="issue-detail-meta-row">
              <span className="issue-detail-label">created</span>
              <span className="issue-detail-value">{new Date(issue.createdAt).toLocaleString()}</span>
            </div>
            <div className="issue-detail-meta-row">
              <span className="issue-detail-label">updated</span>
              <span className="issue-detail-value">{new Date(issue.updatedAt).toLocaleString()}</span>
            </div>
          </div>

          {/* Subtasks section */}
          {!issue.parentId && (
            <div className="issue-detail-subtasks">
              <div className="issue-detail-subtasks-header">
                <h3 className="issue-detail-section-title">
                  SUBTASKS {subtasks && subtasks.length > 0 && `(${subtasks.filter(s => s.status === 'done').length}/${subtasks.length})`}
                </h3>
                {onCreateSubtask && !showSubtaskForm && (
                  <button
                    className="issue-detail-add-subtask-btn"
                    onClick={() => setShowSubtaskForm(true)}
                  >
                    [+ ADD SUBTASK]
                  </button>
                )}
              </div>
              {showSubtaskForm && (
                <div className="issue-detail-subtask-form">
                  <input
                    className="issue-detail-subtask-title-input"
                    type="text"
                    value={subtaskTitle}
                    onChange={(e) => setSubtaskTitle(e.target.value)}
                    placeholder="Subtask title..."
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubtask(); if (e.key === 'Escape') setShowSubtaskForm(false); }}
                  />
                  <input
                    className="issue-detail-subtask-desc-input"
                    type="text"
                    value={subtaskDesc}
                    onChange={(e) => setSubtaskDesc(e.target.value)}
                    placeholder="Description (optional)"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubtask(); if (e.key === 'Escape') setShowSubtaskForm(false); }}
                  />
                  <div className="issue-detail-subtask-form-actions">
                    <button className="modal-btn modal-btn-cancel" onClick={() => setShowSubtaskForm(false)}>[CANCEL]</button>
                    <button className="modal-btn modal-btn-submit" onClick={handleAddSubtask} disabled={!subtaskTitle.trim()}>[ADD]</button>
                  </div>
                </div>
              )}
              {subtasks && subtasks.length > 0 ? (
                <ul className="issue-detail-subtask-list">
                  {subtasks.map((sub) => {
                    const subStatus = STATUS_LABELS[sub.status] || STATUS_LABELS.todo;
                    return (
                      <li key={sub.id} className="issue-detail-subtask-item">
                        <span className={`issue-detail-subtask-status ${subStatus.className}`}>{subStatus.label}</span>
                        <button
                          className="issue-detail-subtask-title"
                          onClick={() => onSubtaskClick?.(sub.id)}
                        >
                          {sub.title}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : !showSubtaskForm && (
                <p className="issue-detail-no-subtasks">No subtasks yet.</p>
              )}
            </div>
          )}

          {/* Previous reviews */}
          {pr && pr.comments.length > 0 && (
            <div className="issue-detail-reviews">
              <h3 className="issue-detail-section-title">REVIEW HISTORY</h3>
              {pr.comments.map((c) => (
                <div key={c.id} className={`issue-detail-review ${c.author === 'hermes-reviewer' ? 'review-bot' : 'review-human'}`}>
                  <div className="issue-detail-review-header">
                    <span>{c.author === 'hermes-reviewer' ? '⚗ hermes-reviewer' : '👤 ' + c.author}</span>
                    <span>{new Date(c.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <pre className="issue-detail-review-body">{c.body}</pre>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="issue-detail-footer">
          <div className="issue-detail-status-actions">
            {issue.status !== 'backlog' && (
              <button className="modal-btn" onClick={() => onStatusChange(issue.id, 'backlog')}>→ BACKLOG</button>
            )}
            {issue.status !== 'todo' && (
              <button className="modal-btn" onClick={() => onStatusChange(issue.id, 'todo')}>→ TODO</button>
            )}
            {issue.status !== 'in_progress' && (
              <button className="modal-btn" onClick={() => onStatusChange(issue.id, 'in_progress')}>→ IN PROGRESS</button>
            )}
            {issue.status !== 'review' && (
              <button className="modal-btn" onClick={() => onStatusChange(issue.id, 'review')}>→ REVIEW</button>
            )}
            {issue.status !== 'done' && (
              <button className="modal-btn" onClick={() => onStatusChange(issue.id, 'done')}>→ DONE</button>
            )}
          </div>
          <button className="modal-btn issue-detail-delete-btn" onClick={() => { onDelete(issue.id); onClose(); }} aria-label="Delete issue">
            [DELETE]
          </button>
        </div>
      </div>
    </div>
  );
}
