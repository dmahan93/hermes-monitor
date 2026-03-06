import { useState } from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import type { Issue, AgentPreset } from '../types';

interface BacklogSectionProps {
  issues: Issue[];
  agents: AgentPreset[];
  onDelete: (id: string) => void;
  onPlanClick: (issueId: string) => void;
  onIssueClick?: (issueId: string) => void;
}

export function BacklogSection({ issues, agents, onDelete, onPlanClick, onIssueClick }: BacklogSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="backlog-section">
      <div className="backlog-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="backlog-toggle">{collapsed ? '▸' : '▾'}</span>
        <span className="backlog-label">BACKLOG</span>
        <span className="backlog-count">{issues.length}</span>
      </div>
      {!collapsed && (
        <Droppable droppableId="backlog" direction="horizontal">
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`backlog-body ${snapshot.isDraggingOver ? 'drag-over' : ''} ${issues.length === 0 ? 'backlog-empty' : ''}`}
            >
              {issues.length === 0 && (
                <div className="backlog-empty-text">
                  new issues land here for planning — drag to TODO when ready
                </div>
              )}
              {issues.map((issue, index) => {
                const agent = agents.find((a) => a.id === issue.agent);
                return (
                  <Draggable key={issue.id} draggableId={issue.id} index={index}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                        className={`backlog-card ${dragSnapshot.isDragging ? 'dragging' : ''}`}
                      >
                        <div className="backlog-card-header">
                          <span
                            className="backlog-card-title"
                            onClick={(e) => { e.stopPropagation(); onIssueClick?.(issue.id); }}
                          >
                            {issue.title}
                          </span>
                          <button
                            className="issue-card-delete"
                            onClick={(e) => { e.stopPropagation(); onDelete(issue.id); }}
                            title="Delete issue"
                          >
                            ×
                          </button>
                        </div>
                        {issue.description && (
                          <div className="backlog-card-desc">{issue.description}</div>
                        )}
                        <div className="backlog-card-meta">
                          {agent && (
                            <span className="issue-card-agent" title={agent.description}>
                              {agent.icon} {agent.name}
                            </span>
                          )}
                          <button
                            className="backlog-plan-btn"
                            onClick={(e) => { e.stopPropagation(); onPlanClick(issue.id); }}
                            title={issue.terminalId ? 'Continue planning' : 'Start planning'}
                          >
                            {issue.terminalId ? '▸ planning' : '⚙ plan'}
                          </button>
                        </div>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      )}
    </div>
  );
}
