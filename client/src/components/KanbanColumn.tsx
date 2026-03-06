import { Droppable } from '@hello-pangea/dnd';
import { IssueCard } from './IssueCard';
import type { Issue, IssueStatus } from '../types';

interface KanbanColumnProps {
  columnId: IssueStatus;
  label: string;
  issues: Issue[];
  onDelete: (id: string) => void;
}

export function KanbanColumn({ columnId, label, issues, onDelete }: KanbanColumnProps) {
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
