import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanbanBoard } from '../../src/components/KanbanBoard';
import type { Issue, AgentPreset } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', description: 'Hermes agent', installed: true },
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
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('KanbanBoard', () => {
  it('renders 4 columns', () => {
    render(
      <KanbanBoard
        issues={[]}
        agents={mockAgents}
        onStatusChange={() => {}}
        onCreateIssue={() => {}}
        onDeleteIssue={() => {}}
      />
    );
    expect(screen.getByText('TODO')).toBeInTheDocument();
    expect(screen.getByText('IN PROGRESS')).toBeInTheDocument();
    expect(screen.getByText('REVIEW')).toBeInTheDocument();
    expect(screen.getByText('DONE')).toBeInTheDocument();
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
        onStatusChange={() => {}}
        onCreateIssue={() => {}}
        onDeleteIssue={() => {}}
      />
    );
    expect(screen.getByText('Todo task')).toBeInTheDocument();
    expect(screen.getByText('WIP task')).toBeInTheDocument();
    expect(screen.getByText('Review task')).toBeInTheDocument();
  });

  it('new issue button opens modal', () => {
    render(
      <KanbanBoard
        issues={[]}
        agents={mockAgents}
        onStatusChange={() => {}}
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
        onStatusChange={() => {}}
        onCreateIssue={() => {}}
        onDeleteIssue={() => {}}
      />
    );
    expect(screen.getByText('[+ NEW ISSUE]')).toBeInTheDocument();
  });
});
