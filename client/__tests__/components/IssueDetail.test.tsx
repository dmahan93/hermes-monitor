import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { IssueDetail } from '../../src/components/IssueDetail';
import type { Issue, AgentPreset } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', planningCommand: 'hermes chat', description: 'Hermes agent' },
];

const mockIssue: Issue = {
  id: 'issue-1',
  title: 'Test issue title',
  description: 'Test issue description',
  status: 'todo',
  agent: 'hermes',
  command: '',
  terminalId: null,
  branch: null,
  parentId: null,
  reviewerModel: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

let defaultProps: {
  issue: typeof mockIssue;
  agents: typeof mockAgents;
  onClose: ReturnType<typeof vi.fn>;
  onUpdate: ReturnType<typeof vi.fn>;
  onStatusChange: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
};

describe('IssueDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps = {
      issue: mockIssue,
      agents: mockAgents,
      onClose: vi.fn(),
      onUpdate: vi.fn(),
      onStatusChange: vi.fn().mockResolvedValue(null),
      onDelete: vi.fn(),
    };
  });
  it('renders in view mode by default (initialEditing omitted)', () => {
    render(<IssueDetail {...defaultProps} />);
    expect(screen.getByText('Test issue title')).toBeInTheDocument();
    expect(screen.getByText('Test issue description')).toBeInTheDocument();
    expect(screen.getByText('[EDIT]')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Test issue title')).not.toBeInTheDocument();
  });

  it('renders in view mode when initialEditing is false', () => {
    render(<IssueDetail {...defaultProps} initialEditing={false} />);
    expect(screen.getByText('[EDIT]')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Test issue title')).not.toBeInTheDocument();
  });

  it('renders in editing mode when initialEditing is true', () => {
    render(<IssueDetail {...defaultProps} initialEditing={true} />);
    expect(screen.getByDisplayValue('Test issue title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Test issue description')).toBeInTheDocument();
    expect(screen.getByText('[SAVE]')).toBeInTheDocument();
    expect(screen.getByText('[CANCEL]')).toBeInTheDocument();
    expect(screen.queryByText('[EDIT]')).not.toBeInTheDocument();
  });

  it('switches from view mode to edit mode when EDIT is clicked', () => {
    render(<IssueDetail {...defaultProps} />);
    fireEvent.click(screen.getByText('[EDIT]'));
    expect(screen.getByDisplayValue('Test issue title')).toBeInTheDocument();
    expect(screen.getByText('[SAVE]')).toBeInTheDocument();
  });

  it('cancel restores original values and exits edit mode', () => {
    render(<IssueDetail {...defaultProps} initialEditing={true} />);
    const titleInput = screen.getByDisplayValue('Test issue title');
    fireEvent.change(titleInput, { target: { value: 'Changed title' } });
    expect(screen.getByDisplayValue('Changed title')).toBeInTheDocument();

    fireEvent.click(screen.getByText('[CANCEL]'));
    // Should be back in view mode with original title
    expect(screen.getByText('Test issue title')).toBeInTheDocument();
    expect(screen.getByText('[EDIT]')).toBeInTheDocument();
  });

  it('save calls onUpdate with updated values', () => {
    const onUpdate = vi.fn();
    render(<IssueDetail {...defaultProps} onUpdate={onUpdate} initialEditing={true} />);
    const titleInput = screen.getByDisplayValue('Test issue title');
    fireEvent.change(titleInput, { target: { value: 'Updated title' } });
    fireEvent.click(screen.getByText('[SAVE]'));
    expect(onUpdate).toHaveBeenCalledWith('issue-1', {
      title: 'Updated title',
      description: 'Test issue description',
    });
  });

  it('delete button calls onDelete with correct id', () => {
    render(<IssueDetail {...defaultProps} />);
    fireEvent.click(screen.getByText('[DELETE]'));
    expect(defaultProps.onDelete).toHaveBeenCalledWith('issue-1');
  });

  it('delete button has aria-label for accessibility', () => {
    render(<IssueDetail {...defaultProps} />);
    expect(screen.getByLabelText('Delete issue')).toBeInTheDocument();
  });

  // ── Status dropdown tests ──

  it('renders a status select dropdown with current value', () => {
    render(<IssueDetail {...defaultProps} />);
    const select = screen.getByLabelText('Change status') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('todo');
  });

  it('renders all 5 status options with correct values', () => {
    render(<IssueDetail {...defaultProps} />);
    const select = screen.getByLabelText('Change status');
    const options = within(select).getAllByRole('option') as HTMLOptionElement[];
    expect(options).toHaveLength(5);

    const values = options.map((o) => o.value);
    expect(values).toEqual(['backlog', 'todo', 'in_progress', 'review', 'done']);

    const labels = options.map((o) => o.textContent);
    expect(labels).toEqual(['BACKLOG', 'TODO', 'IN PROGRESS', 'REVIEW', 'DONE']);
  });

  it('calls onStatusChange with correct args when selection changes', async () => {
    render(<IssueDetail {...defaultProps} />);
    const select = screen.getByLabelText('Change status');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'in_progress' } });
    });
    expect(defaultProps.onStatusChange).toHaveBeenCalledWith('issue-1', 'in_progress');
  });

  it('displays error when status change fails', async () => {
    const onStatusChange = vi.fn().mockResolvedValue('Cannot move to done with open subtasks');
    render(<IssueDetail {...defaultProps} onStatusChange={onStatusChange} />);
    const select = screen.getByLabelText('Change status');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'done' } });
    });
    expect(screen.getByText('Cannot move to done with open subtasks')).toBeInTheDocument();
  });

  it('reflects different issue statuses in select value', () => {
    const statuses = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
    for (const status of statuses) {
      const { unmount } = render(
        <IssueDetail {...defaultProps} issue={{ ...mockIssue, status }} />
      );
      const select = screen.getByLabelText('Change status') as HTMLSelectElement;
      expect(select.value).toBe(status);
      unmount();
    }
  });

  it('applies status-specific CSS class to the select element', () => {
    const { unmount } = render(
      <IssueDetail {...defaultProps} issue={{ ...mockIssue, status: 'in_progress' }} />
    );
    const select = screen.getByLabelText('Change status');
    expect(select.className).toContain('issue-detail-status-select');
    expect(select.className).toContain('issue-status-wip');
    unmount();

    render(
      <IssueDetail {...defaultProps} issue={{ ...mockIssue, status: 'done' }} />
    );
    const select2 = screen.getByLabelText('Change status');
    expect(select2.className).toContain('issue-status-done');
  });

  it('shows reviewer terminal link when issue is in review with terminal', () => {
    const reviewIssue = { ...mockIssue, terminalId: 'term-reviewer', status: 'review' as const };
    render(<IssueDetail {...defaultProps} issue={reviewIssue} />);
    expect(screen.getByText(/reviewer active/)).toBeInTheDocument();
  });

  it('shows standard terminal link when issue is in_progress with terminal', () => {
    const activeIssue = { ...mockIssue, terminalId: 'term-1', status: 'in_progress' as const };
    render(<IssueDetail {...defaultProps} issue={activeIssue} />);
    expect(screen.getByText(/▸ active — click to view/)).toBeInTheDocument();
  });

  it('does not render old inline status buttons', () => {
    render(<IssueDetail {...defaultProps} />);
    // The old implementation rendered buttons like "→ BACKLOG", "→ TODO", etc.
    expect(screen.queryByText('→ BACKLOG')).not.toBeInTheDocument();
    expect(screen.queryByText('→ TODO')).not.toBeInTheDocument();
    expect(screen.queryByText('→ IN PROGRESS')).not.toBeInTheDocument();
    expect(screen.queryByText('→ REVIEW')).not.toBeInTheDocument();
    expect(screen.queryByText('→ DONE')).not.toBeInTheDocument();
  });

  it('disables select during pending status change', async () => {
    let resolveStatusChange!: (value: string | null) => void;
    const onStatusChange = vi.fn().mockImplementation(
      () => new Promise<string | null>((resolve) => { resolveStatusChange = resolve; })
    );
    render(<IssueDetail {...defaultProps} onStatusChange={onStatusChange} />);
    const select = screen.getByLabelText('Change status') as HTMLSelectElement;

    expect(select.disabled).toBe(false);

    // Trigger a status change (don't resolve yet)
    await act(async () => {
      fireEvent.change(select, { target: { value: 'done' } });
    });

    // Select should be disabled while pending
    expect(select.disabled).toBe(true);

    // Resolve the promise
    await act(async () => {
      resolveStatusChange(null);
    });

    // Select should be re-enabled
    expect(select.disabled).toBe(false);
  });
});
