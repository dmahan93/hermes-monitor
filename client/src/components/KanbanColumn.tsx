import { useMemo } from 'react';
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
  // Memoize derived maps to avoid recomputing on every render
  const { parentTitleMap, subtaskInfoMap } = useMemo(() => {
    // Build an O(1) title lookup, then derive parent titles and subtask info in O(n)
    const titleById = new Map(allIssues.map((i) => [i.id, i.title]));

    const parentTitles = new Map<string, string>();
    for (const issue of issues) {
      if (issue.parentId) {
        const title = titleById.get(issue.parentId);
        if (title) parentTitles.set(issue.id, title);
      }
    }

    // Count all subtasks for parent issues in this column
    const subtaskInfos = new Map<string, SubtaskInfo>();
    const columnIds = new Set(issues.map((i) => i.id));
    for (const issue of allIssues) {
      if (issue.parentId && columnIds.has(issue.parentId)) {
        const info = subtaskInfos.get(issue.parentId) || { total: 0, done: 0 };
        info.total++;
        if (issue.status === 'done') info.done++;
        subtaskInfos.set(issue.parentId, info);
      }
    }

    return { parentTitleMap: parentTitles, subtaskInfoMap: subtaskInfos };
  }, [issues, allIssues]);

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
