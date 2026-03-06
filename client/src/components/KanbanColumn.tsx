import { Droppable } from '@hello-pangea/dnd';
import { IssueCard } from './IssueCard';
import type { Issue, IssueStatus, AgentPreset } from '../types';

interface KanbanColumnProps {
  columnId: IssueStatus;
  label: string;
  issues: Issue[];
  agents: AgentPreset[];
  onDelete: (id: string) => void;
}

export function KanbanColumn({ columnId, label, issues, agents, onDelete }: KanbanColumnProps) {
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
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
