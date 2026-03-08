import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { SubtaskInfo } from '../../src/components/IssueCard';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { IssueCard } from '../../src/components/IssueCard';
import type { Issue, AgentPreset } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', planningCommand: 'hermes chat', description: 'Hermes agent' },
  { id: 'claude', name: 'Claude Code', icon: '◈', command: '', planningCommand: 'claude', description: 'Claude agent' },
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

function renderCard(
  issue: Issue = mockIssue,
  onDelete = vi.fn(),
  { onEdit, subtaskInfo }: { onEdit?: (issueId: string) => void; subtaskInfo?: SubtaskInfo } = {},
) {
  return render(
    <DragDropContext onDragEnd={() => {}}>
      <Droppable droppableId="test">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <IssueCard issue={issue} index={0} agents={mockAgents} onDelete={onDelete} onEdit={onEdit} subtaskInfo={subtaskInfo} />
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

  describe('delete confirmation', () => {
    it('shows confirm dialog when delete is clicked', async () => {
      renderCard();
      fireEvent.click(screen.getByTitle('Delete issue'));
      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      });
      expect(screen.getByText(/DELETE ISSUE/)).toBeInTheDocument();
    });

    it('calls onDelete when user confirms', async () => {
      const onDelete = vi.fn();
      renderCard(mockIssue, onDelete);
      fireEvent.click(screen.getByTitle('Delete issue'));
      await waitFor(() => {
        expect(screen.getByText('[DELETE]')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('[DELETE]'));
      await waitFor(() => {
        expect(onDelete).toHaveBeenCalledWith('issue-1');
      });
    });

    it('does not call onDelete when user cancels', async () => {
      const onDelete = vi.fn();
      renderCard(mockIssue, onDelete);
      fireEvent.click(screen.getByTitle('Delete issue'));
      await waitFor(() => {
        expect(screen.getByText('[CANCEL]')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('[CANCEL]'));
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('shows issue title in confirmation message', async () => {
      renderCard(mockIssue);
      fireEvent.click(screen.getByTitle('Delete issue'));
      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      });
      const dialog = screen.getByRole('alertdialog');
      expect(within(dialog).getByText(/Fix the login bug/)).toBeInTheDocument();
    });

    it('shows subtask count when subtaskInfo is provided', async () => {
      renderCard(mockIssue, vi.fn(), { subtaskInfo: { total: 3, done: 1 } });
      fireEvent.click(screen.getByTitle('Delete issue'));
      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      });
      expect(screen.getByText(/3 subtasks/)).toBeInTheDocument();
    });

    it('shows singular subtask when count is 1', async () => {
      renderCard(mockIssue, vi.fn(), { subtaskInfo: { total: 1, done: 0 } });
      fireEvent.click(screen.getByTitle('Delete issue'));
      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      });
      const message = screen.getByText(/1 subtask/);
      expect(message.textContent).toContain('1 subtask');
      expect(message.textContent).not.toContain('1 subtasks');
    });

    it('shows generic subtask warning when no subtaskInfo for top-level issue', async () => {
      renderCard(mockIssue);
      fireEvent.click(screen.getByTitle('Delete issue'));
      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      });
      expect(screen.getByText(/may also delete associated subtasks/)).toBeInTheDocument();
    });

    it('does not show subtask warning for child issues without subtaskInfo', async () => {
      const childIssue = { ...mockIssue, parentId: 'parent-1' };
      renderCard(childIssue);
      fireEvent.click(screen.getByTitle('Delete issue'));
      await waitFor(() => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      });
      const message = screen.getByText(/Delete/);
      expect(message.textContent).not.toContain('subtask');
    });
  });

  it('edit button renders when onEdit is provided', () => {
    const onEdit = vi.fn();
    renderCard(mockIssue, vi.fn(), { onEdit });
    expect(screen.getByTitle('Edit issue')).toBeInTheDocument();
  });

  it('edit button calls onEdit with issue id', () => {
    const onEdit = vi.fn();
    renderCard(mockIssue, vi.fn(), { onEdit });
    fireEvent.click(screen.getByTitle('Edit issue'));
    expect(onEdit).toHaveBeenCalledWith('issue-1');
  });

  it('edit button does not render when onEdit is not provided', () => {
    renderCard();
    expect(screen.queryByTitle('Edit issue')).not.toBeInTheDocument();
  });

  it('edit button has aria-label for accessibility', () => {
    const onEdit = vi.fn();
    renderCard(mockIssue, vi.fn(), { onEdit });
    expect(screen.getByLabelText('Edit issue')).toBeInTheDocument();
  });
});
