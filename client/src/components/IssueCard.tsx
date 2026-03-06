import { Draggable } from '@hello-pangea/dnd';
import type { Issue, AgentPreset } from '../types';

interface IssueCardProps {
  issue: Issue;
  index: number;
  agents: AgentPreset[];
  onDelete: (id: string) => void;
}

export function IssueCard({ issue, index, agents, onDelete }: IssueCardProps) {
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
            <span className="issue-card-title">{issue.title}</span>
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
              <span className="issue-card-terminal" title="Terminal active">
                ▸ active
              </span>
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
