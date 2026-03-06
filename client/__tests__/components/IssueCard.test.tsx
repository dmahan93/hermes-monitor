import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { IssueCard } from '../../src/components/IssueCard';
import type { Issue, AgentPreset } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', description: 'Hermes agent' },
  { id: 'claude', name: 'Claude Code', icon: '◈', command: '', description: 'Claude agent' },
];

const mockIssue: Issue = {
  id: 'issue-1',
  title: 'Fix the login bug',
  description: 'Users cant log in on mobile',
  status: 'todo',
  agent: 'hermes',
  command: '',
  terminalId: null,
  branch: 'fix/login',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function renderCard(issue: Issue = mockIssue, onDelete = vi.fn()) {
  return render(
    <DragDropContext onDragEnd={() => {}}>
      <Droppable droppableId="test">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <IssueCard issue={issue} index={0} agents={mockAgents} onDelete={onDelete} />
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}

describe('IssueCard', () => {
  it('renders title', () => {
    renderCard();
    expect(screen.getByText('Fix the login bug')).toBeInTheDocument();
  });

  it('renders description', () => {
    renderCard();
    expect(screen.getByText('Users cant log in on mobile')).toBeInTheDocument();
  });

  it('renders agent name', () => {
    renderCard();
    expect(screen.getByText(/Hermes/)).toBeInTheDocument();
  });

  it('renders branch name', () => {
    renderCard();
    expect(screen.getByText(/fix\/login/)).toBeInTheDocument();
  });

  it('shows terminal status when active', () => {
    renderCard({ ...mockIssue, terminalId: 'term-1' });
    expect(screen.getByText(/active/)).toBeInTheDocument();
  });

  it('delete button calls onDelete', () => {
    const onDelete = vi.fn();
    renderCard(mockIssue, onDelete);
    fireEvent.click(screen.getByTitle('Delete issue'));
    expect(onDelete).toHaveBeenCalledWith('issue-1');
  });
});
