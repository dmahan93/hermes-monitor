import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { KanbanColumn } from '../../src/components/KanbanColumn';
import type { Issue, AgentPreset } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', planningCommand: 'hermes chat', description: 'Hermes agent' },
];

const makeIssue = (id: string, title: string, status: Issue['status'] = 'todo'): Issue => ({
  id,
  title,
  description: `Description for ${title}`,
  status,
  agent: 'hermes',
  command: '',
  terminalId: null,
  branch: null,
  parentId: null,
  reviewerModel: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

function renderColumn(
  issues: Issue[] = [],
  allIssues?: Issue[],
  overrides: Partial<Parameters<typeof KanbanColumn>[0]> = {},
) {
  const props = {
    columnId: 'todo' as const,
    label: 'TODO',
    issues,
    agents: mockAgents,
    allIssues: allIssues ?? issues,
    onDelete: vi.fn(),
    ...overrides,
  };

  return render(
    <DragDropContext onDragEnd={() => {}}>
      <KanbanColumn {...props} />
    </DragDropContext>,
  );
}

describe('KanbanColumn', () => {
  it('renders column title', () => {
    renderColumn();
    expect(screen.getByText('TODO')).toBeInTheDocument();
  });

  it('renders custom column label', () => {
    renderColumn([], [], { label: 'IN PROGRESS', columnId: 'in_progress' });
    expect(screen.getByText('IN PROGRESS')).toBeInTheDocument();
  });

  it('renders issue count', () => {
    const issues = [
      makeIssue('1', 'Task A'),
      makeIssue('2', 'Task B'),
    ];
    renderColumn(issues);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders issue cards for provided issues', () => {
    const issues = [
      makeIssue('1', 'Fix login bug'),
      makeIssue('2', 'Add dark mode'),
      makeIssue('3', 'Write docs'),
    ];
    renderColumn(issues);
    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
    expect(screen.getByText('Add dark mode')).toBeInTheDocument();
    expect(screen.getByText('Write docs')).toBeInTheDocument();
  });

  it('renders empty state when no issues', () => {
    renderColumn([]);
    expect(screen.getByText('TODO')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    // No issue cards rendered
    expect(screen.queryByText('Fix login bug')).not.toBeInTheDocument();
  });

  it('provides a droppable area for drag-and-drop', () => {
    const { container } = renderColumn([]);
    // The column body should have the droppable data attributes
    const droppable = container.querySelector('.kanban-column-body');
    expect(droppable).toBeInTheDocument();
  });

  it('renders issue descriptions', () => {
    const issues = [makeIssue('1', 'Task A')];
    renderColumn(issues);
    expect(screen.getByText('Description for Task A')).toBeInTheDocument();
  });

  it('renders parent title for child issues', () => {
    const parentIssue = makeIssue('parent-1', 'Parent Task');
    const childIssue = { ...makeIssue('child-1', 'Child Task'), parentId: 'parent-1' };
    renderColumn([childIssue], [parentIssue, childIssue]);
    // KanbanColumn resolves parentTitle and passes it to IssueCard which renders "↑ {parentTitle}"
    expect(screen.getByText('Child Task')).toBeInTheDocument();
    expect(screen.getByText(/↑ Parent Task/)).toBeInTheDocument();
  });

  it('shows subtask info for parent issues', () => {
    const parentIssue = makeIssue('parent-1', 'Parent Task');
    const childDone = { ...makeIssue('child-1', 'Done child', 'done'), parentId: 'parent-1' };
    const childTodo = { ...makeIssue('child-2', 'Todo child', 'todo'), parentId: 'parent-1' };
    // parent is in the column, children are in allIssues
    renderColumn([parentIssue], [parentIssue, childDone, childTodo]);
    // KanbanColumn computes subtaskInfo = { total: 2, done: 1 } and passes it to IssueCard
    // IssueCard renders "◫ 1/2" with title "1/2 subtasks done"
    expect(screen.getByText('Parent Task')).toBeInTheDocument();
    expect(screen.getByTitle('1/2 subtasks done')).toBeInTheDocument();
  });

  it('calls onDelete when delete button is clicked and confirmed', async () => {
    const onDelete = vi.fn();
    const issues = [makeIssue('1', 'Task to delete')];
    renderColumn(issues, issues, { onDelete });

    const deleteBtn = screen.getByLabelText('Delete issue');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('[DELETE]'));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('1');
    });
  });

  it('calls onEdit when edit button is clicked', () => {
    const onEdit = vi.fn();
    const issues = [makeIssue('1', 'Task to edit')];
    renderColumn(issues, issues, { onEdit });

    const editBtn = screen.getByLabelText('Edit issue');
    fireEvent.click(editBtn);

    expect(onEdit).toHaveBeenCalledWith('1');
  });

  it('calls onIssueClick when issue title is clicked', () => {
    const onIssueClick = vi.fn();
    const issues = [makeIssue('1', 'Clickable Task')];
    renderColumn(issues, issues, { onIssueClick });

    fireEvent.click(screen.getByText('Clickable Task'));

    expect(onIssueClick).toHaveBeenCalledWith('1');
  });
});
