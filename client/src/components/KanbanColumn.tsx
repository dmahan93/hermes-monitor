import { Droppable } from '@hello-pangea/dnd';
import { IssueCard, type SubtaskInfo } from './IssueCard';
import type { Issue, IssueStatus, AgentPreset } from '../types';

interface KanbanColumnProps {
  columnId: IssueStatus;
  label: string;
  issues: Issue[];
  agents: AgentPreset[];
  allIssues: Issue[];
  onDelete: (id: string) => void;
  onEdit?: (issueId: string) => void;
  onTerminalClick?: (issueId: string) => void;
  onIssueClick?: (issueId: string) => void;
}

export function KanbanColumn({ columnId, label, issues, agents, allIssues, onDelete, onEdit, onTerminalClick, onIssueClick }: KanbanColumnProps) {
  // Build lookup maps for parent titles and subtask info
  const parentTitleMap = new Map<string, string>();
  const subtaskInfoMap = new Map<string, SubtaskInfo>();

  for (const issue of allIssues) {
    if (issue.parentId) {
      const parent = allIssues.find((i) => i.id === issue.parentId);
      if (parent) parentTitleMap.set(issue.id, parent.title);
    }
  }

  for (const issue of issues) {
    const subtasks = allIssues.filter((i) => i.parentId === issue.id);
    if (subtasks.length > 0) {
      subtaskInfoMap.set(issue.id, {
        total: subtasks.length,
        done: subtasks.filter((s) => s.status === 'done').length,
      });
    }
  }

  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        <span className="kanban-column-label">{label}</span>
        <span className="kanban-column-count">{issues.length}</span>
      </div>
      <Droppable droppableId={columnId}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`kanban-column-body ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
          >
            {issues.map((issue, index) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                index={index}
                agents={agents}
                onDelete={onDelete}
                onEdit={onEdit}
                onTerminalClick={onTerminalClick}
                onClick={onIssueClick}
                parentTitle={parentTitleMap.get(issue.id)}
                subtaskInfo={subtaskInfoMap.get(issue.id)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
