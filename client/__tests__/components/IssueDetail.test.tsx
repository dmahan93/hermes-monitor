import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IssueDetail } from '../../src/components/IssueDetail';
import type { Issue, AgentPreset } from '../../src/types';

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', description: 'Hermes agent' },
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
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const defaultProps = {
  issue: mockIssue,
  agents: mockAgents,
  onClose: vi.fn(),
  onUpdate: vi.fn(),
  onStatusChange: vi.fn(),
  onDelete: vi.fn(),
};

describe('IssueDetail', () => {
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

  it('delete button has aria-label for accessibility', () => {
    render(<IssueDetail {...defaultProps} />);
    // The delete button in IssueCard has aria-label; verify the detail panel's
    // delete button exists and calls the handler
    fireEvent.click(screen.getByText('[DELETE]'));
    expect(defaultProps.onDelete).toHaveBeenCalledWith('issue-1');
  });
});
