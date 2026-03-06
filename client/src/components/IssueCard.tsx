import { Draggable } from '@hello-pangea/dnd';
import type { Issue, AgentPreset } from '../types';

interface IssueCardProps {
  issue: Issue;
  index: number;
  agents: AgentPreset[];
  onDelete: (id: string) => void;
  onEdit?: (issueId: string) => void;
  onTerminalClick?: (issueId: string) => void;
  onClick?: (issueId: string) => void;
}

export function IssueCard({ issue, index, agents, onDelete, onEdit, onTerminalClick, onClick }: IssueCardProps) {
  const agent = agents.find((a) => a.id === issue.agent);

  return (
    <Draggable draggableId={issue.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`issue-card ${snapshot.isDragging ? 'dragging' : ''}`}
        >
          <div className="issue-card-header">
            <span
              className="issue-card-title issue-card-title-clickable"
              onClick={(e) => { e.stopPropagation(); onClick?.(issue.id); }}
            >
              {issue.title}
            </span>
            <div className="issue-card-actions">
              <button
                className="issue-card-edit"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit?.(issue.id);
                }}
                title="Edit issue"
              >
                ✎
              </button>
              <button
                className="issue-card-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(issue.id);
                }}
                title="Delete issue"
              >
                ×
              </button>
            </div>
          </div>
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
          </div>
        </div>
      )}
    </Draggable>
  );
}
