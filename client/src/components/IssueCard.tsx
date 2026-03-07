import { Draggable } from '@hello-pangea/dnd';
import type { Issue, AgentPreset } from '../types';

export interface SubtaskInfo {
  total: number;
  done: number;
}

interface IssueCardProps {
  issue: Issue;
  index: number;
  agents: AgentPreset[];
  onDelete: (id: string) => void;
  onEdit?: (issueId: string) => void;
  onTerminalClick?: (issueId: string) => void;
  onClick?: (issueId: string) => void;
  parentTitle?: string;
  subtaskInfo?: SubtaskInfo;
}

export function IssueCard({ issue, index, agents, onDelete, onEdit, onTerminalClick, onClick, parentTitle, subtaskInfo }: IssueCardProps) {
  const agent = agents.find((a) => a.id === issue.agent);

  return (
    <Draggable draggableId={issue.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`issue-card ${snapshot.isDragging ? 'dragging' : ''} ${issue.parentId ? 'issue-card-subtask' : ''}`}
        >
          <div className="issue-card-header">
            <span
              className="issue-card-title issue-card-title-clickable"
              onClick={(e) => { e.stopPropagation(); onClick?.(issue.id); }}
            >
              {issue.title}
            </span>
            <div className="issue-card-actions">
              {onEdit && (
                <button
                  className="issue-card-edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(issue.id);
                  }}
                  title="Edit issue"
                  aria-label="Edit issue"
                >
                  ✎
                </button>
              )}
              <button
                className="issue-card-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  const subtaskWarning = subtaskInfo && subtaskInfo.total > 0
                    ? ` This will also delete ${subtaskInfo.total} subtask${subtaskInfo.total !== 1 ? 's' : ''}.`
                    : ' This will also delete all subtasks.';
                  if (window.confirm(`Delete "${issue.title}"?${subtaskWarning}`)) {
                    onDelete(issue.id);
                  }
                }}
                title="Delete issue"
                aria-label="Delete issue"
              >
                ×
              </button>
            </div>
          </div>
          {parentTitle && (
            <div className="issue-card-parent" title="Subtask of parent issue">
              ↑ {parentTitle}
            </div>
          )}
          {issue.description && (
            <div className="issue-card-desc">{issue.description}</div>
          )}
          <div className="issue-card-meta">
            {agent && (
              <span className="issue-card-agent" title={agent.description}>
                {agent.icon} {agent.name}
              </span>
            )}
            {issue.terminalId && (
              <button
                className="issue-card-terminal-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onTerminalClick?.(issue.id);
                }}
                title="Open terminal"
              >
                ▸ active
              </button>
            )}
            {issue.branch && (
              <span className="issue-card-branch" title={issue.branch}>
                ⎇ {issue.branch}
              </span>
            )}
            {subtaskInfo && subtaskInfo.total > 0 && (
              <span className="issue-card-subtasks" title={`${subtaskInfo.done}/${subtaskInfo.total} subtasks done`}>
                ◫ {subtaskInfo.done}/{subtaskInfo.total}
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}
