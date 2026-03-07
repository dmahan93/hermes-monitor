import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DragDropContext } from '@hello-pangea/dnd';
import { BacklogSection } from '../../src/components/BacklogSection';
import type { Issue, AgentPreset } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', planningCommand: 'hermes chat', description: 'Hermes agent', installed: true },
];

const makeIssue = (id: string, title: string, opts: Partial<Issue> = {}): Issue => ({
  id,
  title,
  description: '',
  status: 'backlog',
  agent: 'hermes',
  command: '',
  terminalId: null,
  branch: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...opts,
});

function renderBacklog(
  issues: Issue[] = [],
  overrides: { onDelete?: ReturnType<typeof vi.fn>; onPlanClick?: ReturnType<typeof vi.fn>; onIssueClick?: ReturnType<typeof vi.fn> } = {},
) {
  const onDelete = overrides.onDelete || vi.fn();
  const onPlanClick = overrides.onPlanClick || vi.fn();
  const onIssueClick = overrides.onIssueClick || vi.fn();
  return render(
    <DragDropContext onDragEnd={() => {}}>
      <BacklogSection
        issues={issues}
        agents={mockAgents}
        onDelete={onDelete}
        onPlanClick={onPlanClick}
        onIssueClick={onIssueClick}
      />
    </DragDropContext>
  );
}

describe('BacklogSection', () => {
  it('renders BACKLOG header with issue count', () => {
    const issues = [makeIssue('1', 'Task A'), makeIssue('2', 'Task B')];
    renderBacklog(issues);
    expect(screen.getByText('BACKLOG')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders issue titles', () => {
    const issues = [makeIssue('1', 'Plan feature X'), makeIssue('2', 'Research Y')];
    renderBacklog(issues);
    expect(screen.getByText('Plan feature X')).toBeInTheDocument();
    expect(screen.getByText('Research Y')).toBeInTheDocument();
  });

  it('renders empty text when no issues', () => {
    renderBacklog([]);
    expect(screen.getByText(/new issues land here/)).toBeInTheDocument();
  });

  it('renders issue description when present', () => {
    const issues = [makeIssue('1', 'Task', { description: 'Some details here' })];
    renderBacklog(issues);
    expect(screen.getByText('Some details here')).toBeInTheDocument();
  });

  it('collapse toggle hides issues', () => {
    const issues = [makeIssue('1', 'Visible task')];
    renderBacklog(issues);
    expect(screen.getByText('Visible task')).toBeInTheDocument();

    // Click the header to collapse
    fireEvent.click(screen.getByText('BACKLOG'));
    expect(screen.queryByText('Visible task')).not.toBeInTheDocument();

    // Click again to expand
    fireEvent.click(screen.getByText('BACKLOG'));
    expect(screen.getByText('Visible task')).toBeInTheDocument();
  });

  it('shows ⚙ plan button for issues without terminal', () => {
    const issues = [makeIssue('1', 'Plannable')];
    renderBacklog(issues);
    expect(screen.getByText('⚙ plan')).toBeInTheDocument();
  });

  it('shows ▸ planning for issues with active terminal', () => {
    const issues = [makeIssue('1', 'Active planning', { terminalId: 'term-1' })];
    renderBacklog(issues);
    expect(screen.getByText('▸ planning')).toBeInTheDocument();
  });

  it('plan button calls onPlanClick with issue id', () => {
    const onPlanClick = vi.fn();
    const issues = [makeIssue('abc-123', 'Plan me')];
    renderBacklog(issues, { onPlanClick });
    fireEvent.click(screen.getByText('⚙ plan'));
    expect(onPlanClick).toHaveBeenCalledWith('abc-123');
  });

  it('delete button calls onDelete with issue id', () => {
    const onDelete = vi.fn();
    const issues = [makeIssue('del-1', 'Delete me')];
    renderBacklog(issues, { onDelete });
    fireEvent.click(screen.getByTitle('Delete issue'));
    expect(onDelete).toHaveBeenCalledWith('del-1');
  });

  it('issue title click calls onIssueClick', () => {
    const onIssueClick = vi.fn();
    const issues = [makeIssue('click-1', 'Click me')];
    renderBacklog(issues, { onIssueClick });
    fireEvent.click(screen.getByText('Click me'));
    expect(onIssueClick).toHaveBeenCalledWith('click-1');
  });

  it('renders agent info', () => {
    const issues = [makeIssue('1', 'With agent', { agent: 'hermes' })];
    renderBacklog(issues);
    expect(screen.getByText(/Hermes/)).toBeInTheDocument();
  });

  it('auto-expands when new issues are added while collapsed', () => {
    const issues = [makeIssue('1', 'First task')];
    const { rerender } = render(
      <DragDropContext onDragEnd={() => {}}>
        <BacklogSection
          issues={issues}
          agents={mockAgents}
          onDelete={() => {}}
          onPlanClick={() => {}}
        />
      </DragDropContext>
    );

    // Collapse
    fireEvent.click(screen.getByText('BACKLOG'));
    expect(screen.queryByText('First task')).not.toBeInTheDocument();

    // Rerender with more issues — should auto-expand
    const moreIssues = [...issues, makeIssue('2', 'New task')];
    rerender(
      <DragDropContext onDragEnd={() => {}}>
        <BacklogSection
          issues={moreIssues}
          agents={mockAgents}
          onDelete={() => {}}
          onPlanClick={() => {}}
        />
      </DragDropContext>
    );

    expect(screen.getByText('First task')).toBeInTheDocument();
    expect(screen.getByText('New task')).toBeInTheDocument();
  });
});
