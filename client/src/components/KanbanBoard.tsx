import { useMemo, useState, useCallback } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { KanbanColumn } from './KanbanColumn';
import { NewIssueModal } from './NewIssueModal';
import type { Issue, IssueStatus, AgentPreset } from '../types';
import { COLUMNS } from '../types';

interface KanbanBoardProps {
  issues: Issue[];
  agents: AgentPreset[];
  onStatusChange: (id: string, status: IssueStatus) => void;
  onCreateIssue: (title: string, description: string, agent: string, command: string, branch: string) => void;
  onDeleteIssue: (id: string) => void;
  onTerminalClick?: (issueId: string) => void;
}

export function KanbanBoard({ issues, agents, onStatusChange, onCreateIssue, onDeleteIssue, onTerminalClick }: KanbanBoardProps) {
  const [showModal, setShowModal] = useState(false);

  const issuesByColumn = useMemo(() => {
    const grouped: Record<IssueStatus, Issue[]> = {
      todo: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const issue of issues) {
      grouped[issue.status]?.push(issue);
    }
    return grouped;
  }, [issues]);

  const onDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStatus = destination.droppableId as IssueStatus;
    const issue = issues.find((i) => i.id === draggableId);
    if (issue && issue.status !== newStatus) {
      onStatusChange(draggableId, newStatus);
    }
  }, [issues, onStatusChange]);

  const handleCreate = useCallback((title: string, description: string, agent: string, command: string, branch: string) => {
    onCreateIssue(title, description, agent, command, branch);
    setShowModal(false);
  }, [onCreateIssue]);

  return (
    <div className="kanban-board">
      <div className="kanban-toolbar">
        <button className="header-add-btn" onClick={() => setShowModal(true)}>
          [+ NEW ISSUE]
        </button>
      </div>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="kanban-columns">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              columnId={col.id}
              label={col.label}
              issues={issuesByColumn[col.id]}
              agents={agents}
              onDelete={onDeleteIssue}
              onTerminalClick={onTerminalClick}
            />
          ))}
        </div>
      </DragDropContext>
      {showModal && (
        <NewIssueModal
          agents={agents}
          onSubmit={handleCreate}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
