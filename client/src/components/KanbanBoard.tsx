import { useMemo, useState, useCallback, useEffect } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { KanbanColumn } from './KanbanColumn';
import { BacklogSection } from './BacklogSection';
import { NewIssueModal } from './NewIssueModal';
import type { Issue, IssueStatus, AgentPreset } from '../types';
import { COLUMNS } from '../types';
import './KanbanBoard.css';

const noop = () => {};

interface KanbanBoardProps {
  issues: Issue[];
  agents: AgentPreset[];
  agentsLoading?: boolean;
  agentsError?: string | null;
  onStatusChange: (id: string, status: IssueStatus) => Promise<string | null>;
  onCreateIssue: (title: string, description: string, agent: string, command: string, branch: string) => void;
  onDeleteIssue: (id: string) => void;
  onEditIssue?: (issueId: string) => void;
  onTerminalClick?: (issueId: string) => void;
  onIssueClick?: (issueId: string) => void;
  onPlanClick?: (issueId: string) => void;
}

export function KanbanBoard({ issues, agents, agentsLoading, agentsError, onStatusChange, onCreateIssue, onDeleteIssue, onEditIssue, onTerminalClick, onIssueClick, onPlanClick }: KanbanBoardProps) {
  const [showModal, setShowModal] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);

  // Auto-dismiss drag error toast after 4 seconds
  useEffect(() => {
    if (!dragError) return;
    const timer = setTimeout(() => setDragError(null), 4000);
    return () => clearTimeout(timer);
  }, [dragError]);

  const issuesByColumn = useMemo(() => {
    const grouped: Record<IssueStatus, Issue[]> = {
      backlog: [],
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

  const onDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStatus = destination.droppableId as IssueStatus;
    const issue = issues.find((i) => i.id === draggableId);
    if (issue && issue.status !== newStatus) {
      const error = await onStatusChange(draggableId, newStatus);
      if (error) {
        setDragError(error);
      }
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
      {dragError && (
        <div className="kanban-drag-error" onClick={() => setDragError(null)}>
          ⚠ {dragError}
        </div>
      )}
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="kanban-columns">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              columnId={col.id}
              label={col.label}
              issues={issuesByColumn[col.id]}
              agents={agents}
              allIssues={issues}
              onDelete={onDeleteIssue}
              onEdit={onEditIssue}
              onTerminalClick={onTerminalClick}
              onIssueClick={onIssueClick}
            />
          ))}
        </div>
        <BacklogSection
          issues={issuesByColumn.backlog}
          agents={agents}
          onDelete={onDeleteIssue}
          onPlanClick={onPlanClick || noop}
          onIssueClick={onIssueClick}
        />
      </DragDropContext>
      {showModal && (
        <NewIssueModal
          agents={agents}
          agentsLoading={agentsLoading}
          agentsError={agentsError}
          onSubmit={handleCreate}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
