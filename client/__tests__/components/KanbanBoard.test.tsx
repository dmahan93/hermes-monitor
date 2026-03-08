import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanBoard } from '../../src/components/KanbanBoard';
import type { Issue, AgentPreset } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', planningCommand: 'hermes chat', description: 'Hermes agent', installed: true },
];

const makeIssue = (id: string, title: string, status: Issue['status'] = 'todo'): Issue => ({
  id,
  title,
  description: '',
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

describe('KanbanBoard', () => {
  it('renders 4 columns and backlog section', () => {
    render(
      <KanbanBoard
        issues={[]}
        agents={mockAgents}
        agentsLoading={false}
        agentsError={null}
        onStatusChange={async () => null}
        onCreateIssue={() => {}}
        onDeleteIssue={() => {}}
      />
    );
    expect(screen.getByText('TODO')).toBeInTheDocument();
    expect(screen.getByText('IN PROGRESS')).toBeInTheDocument();
    expect(screen.getByText('REVIEW')).toBeInTheDocument();
    expect(screen.getByText('DONE')).toBeInTheDocument();
    expect(screen.getByText('BACKLOG')).toBeInTheDocument();
  });

  it('renders issues in correct columns', () => {
    const issues = [
      makeIssue('1', 'Todo task', 'todo'),
      makeIssue('2', 'WIP task', 'in_progress'),
      makeIssue('3', 'Review task', 'review'),
    ];
    render(
      <KanbanBoard
        issues={issues}
        agents={mockAgents}
        agentsLoading={false}
        agentsError={null}
        onStatusChange={async () => null}
        onCreateIssue={() => {}}
        onDeleteIssue={() => {}}
      />
    );
    expect(screen.getByText('Todo task')).toBeInTheDocument();
    expect(screen.getByText('WIP task')).toBeInTheDocument();
    expect(screen.getByText('Review task')).toBeInTheDocument();
  });

  it('renders backlog issues in backlog section', () => {
    const issues = [
      makeIssue('1', 'Backlog task', 'backlog'),
      makeIssue('2', 'Todo task', 'todo'),
    ];
    render(
      <KanbanBoard
        issues={issues}
        agents={mockAgents}
        agentsLoading={false}
        agentsError={null}
        onStatusChange={async () => null}
        onCreateIssue={() => {}}
        onDeleteIssue={() => {}}
      />
    );
    expect(screen.getByText('Backlog task')).toBeInTheDocument();
    expect(screen.getByText('Todo task')).toBeInTheDocument();
  });

  it('new issue button opens modal', () => {
    render(
      <KanbanBoard
        issues={[]}
        agents={mockAgents}
        agentsLoading={false}
        agentsError={null}
        onStatusChange={async () => null}
        onCreateIssue={() => {}}
        onDeleteIssue={() => {}}
      />
    );
    fireEvent.click(screen.getByText('[+ NEW ISSUE]'));
    expect(screen.getByText('NEW ISSUE')).toBeInTheDocument();
  });

  it('shows new issue button', () => {
    render(
      <KanbanBoard
        issues={[]}
        agents={mockAgents}
        agentsLoading={false}
        agentsError={null}
        onStatusChange={async () => null}
        onCreateIssue={() => {}}
        onDeleteIssue={() => {}}
      />
    );
    expect(screen.getByText('[+ NEW ISSUE]')).toBeInTheDocument();
  });

  it('backlog plan button calls onPlanClick', () => {
    const onPlanClick = vi.fn();
    const issues = [makeIssue('1', 'Plan me', 'backlog')];
    render(
      <KanbanBoard
        issues={issues}
        agents={mockAgents}
        agentsLoading={false}
        agentsError={null}
        onStatusChange={async () => null}
        onCreateIssue={() => {}}
        onDeleteIssue={() => {}}
        onPlanClick={onPlanClick}
      />
    );
    fireEvent.click(screen.getByText('⚙ plan'));
    expect(onPlanClick).toHaveBeenCalledWith('1');
  });
});
