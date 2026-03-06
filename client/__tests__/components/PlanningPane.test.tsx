import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanningPane } from '../../src/components/PlanningPane';
import type { Issue, AgentPreset, ClientMessage, ServerMessage } from '../../src/types';

// Mock TerminalView since it requires xterm/DOM APIs
vi.mock('../../src/components/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid="terminal-view">Terminal: {terminalId}</div>
  ),
}));

const mockAgents: AgentPreset[] = [
  { id: 'hermes', name: 'Hermes', icon: '⚗', command: '', description: 'Hermes agent', installed: true },
];

const makeIssue = (overrides: Partial<Issue> = {}): Issue => ({
  id: 'issue-1',
  title: 'Plan this feature',
  description: 'Feature details here',
  status: 'backlog',
  agent: 'hermes',
  command: '',
  terminalId: null,
  branch: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

function renderPane(issueOverrides: Partial<Issue> = {}, propOverrides: Record<string, any> = {}) {
  const issue = makeIssue(issueOverrides);
  const defaultProps = {
    issue,
    agents: mockAgents,
    send: vi.fn() as (msg: ClientMessage) => void,
    subscribe: vi.fn(() => () => {}) as (handler: (msg: ServerMessage) => void) => () => void,
    onUpdate: vi.fn(async () => {}),
    onPromote: vi.fn(),
    onStartPlanning: vi.fn(),
    onStopPlanning: vi.fn(),
    onClose: vi.fn(),
    ...propOverrides,
  };
  const result = render(<PlanningPane {...defaultProps} />);
  return { ...result, props: defaultProps, issue };
}

describe('PlanningPane', () => {
  it('renders issue title in header', () => {
    renderPane();
    expect(screen.getByText(/Plan this feature/)).toBeInTheDocument();
  });

  it('renders title and description in form fields', () => {
    renderPane();
    const titleInput = screen.getByDisplayValue('Plan this feature');
    const descInput = screen.getByDisplayValue('Feature details here');
    expect(titleInput).toBeInTheDocument();
    expect(descInput).toBeInTheDocument();
  });

  it('renders agent info', () => {
    renderPane();
    expect(screen.getByText(/Hermes/)).toBeInTheDocument();
  });

  it('renders branch info when present', () => {
    renderPane({ branch: 'feat/planning' });
    expect(screen.getByText(/feat\/planning/)).toBeInTheDocument();
  });

  it('back button calls onClose', () => {
    const { props } = renderPane();
    fireEvent.click(screen.getByText('← BOARD'));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('editing title marks form as dirty and shows save button', () => {
    renderPane();
    expect(screen.queryByText('[SAVE CHANGES]')).not.toBeInTheDocument();

    const titleInput = screen.getByDisplayValue('Plan this feature');
    fireEvent.change(titleInput, { target: { value: 'Updated title' } });

    expect(screen.getByText('[SAVE CHANGES]')).toBeInTheDocument();
  });

  it('editing description marks form as dirty', () => {
    renderPane();
    const descInput = screen.getByDisplayValue('Feature details here');
    fireEvent.change(descInput, { target: { value: 'New description' } });
    expect(screen.getByText('[SAVE CHANGES]')).toBeInTheDocument();
  });

  it('save button calls onUpdate with trimmed values', async () => {
    const { props } = renderPane();
    const titleInput = screen.getByDisplayValue('Plan this feature');
    fireEvent.change(titleInput, { target: { value: '  Updated title  ' } });

    fireEvent.click(screen.getByText('[SAVE CHANGES]'));
    expect(props.onUpdate).toHaveBeenCalledWith('issue-1', {
      title: 'Updated title',
      description: 'Feature details here',
    });
  });

  it('save hides the save button after completion', async () => {
    const { props } = renderPane();
    const titleInput = screen.getByDisplayValue('Plan this feature');
    fireEvent.change(titleInput, { target: { value: 'Changed' } });

    expect(screen.getByText('[SAVE CHANGES]')).toBeInTheDocument();
    fireEvent.click(screen.getByText('[SAVE CHANGES]'));

    await waitFor(() => {
      expect(screen.queryByText('[SAVE CHANGES]')).not.toBeInTheDocument();
    });
  });

  it('promote button calls onPromote', () => {
    const { props } = renderPane();
    fireEvent.click(screen.getByText('[→ MOVE TO TODO]'));
    expect(props.onPromote).toHaveBeenCalledWith('issue-1');
  });

  it('promote saves unsaved changes first', async () => {
    const { props } = renderPane();
    const titleInput = screen.getByDisplayValue('Plan this feature');
    fireEvent.change(titleInput, { target: { value: 'Updated before promote' } });

    fireEvent.click(screen.getByText('[→ MOVE TO TODO]'));

    await waitFor(() => {
      expect(props.onUpdate).toHaveBeenCalledWith('issue-1', {
        title: 'Updated before promote',
        description: 'Feature details here',
      });
    });
    expect(props.onPromote).toHaveBeenCalledWith('issue-1');
  });

  it('promote does not call onUpdate when not dirty', () => {
    const { props } = renderPane();
    fireEvent.click(screen.getByText('[→ MOVE TO TODO]'));
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onPromote).toHaveBeenCalledWith('issue-1');
  });

  // Terminal states
  it('shows START TERMINAL button when no terminal', () => {
    renderPane({ terminalId: null });
    expect(screen.getByText('[START TERMINAL]')).toBeInTheDocument();
    expect(screen.getByText(/no planning terminal active/)).toBeInTheDocument();
  });

  it('start terminal button calls onStartPlanning', () => {
    const { props } = renderPane({ terminalId: null });
    fireEvent.click(screen.getByText('[START TERMINAL]'));
    expect(props.onStartPlanning).toHaveBeenCalledWith('issue-1');
  });

  it('renders terminal view when terminalId is present', () => {
    renderPane({ terminalId: 'term-abc' });
    expect(screen.getByTestId('terminal-view')).toBeInTheDocument();
    expect(screen.getByText('Terminal: term-abc')).toBeInTheDocument();
  });

  it('stop terminal button calls onStopPlanning', () => {
    const { props } = renderPane({ terminalId: 'term-abc' });
    fireEvent.click(screen.getByTitle('Stop planning terminal'));
    expect(props.onStopPlanning).toHaveBeenCalledWith('issue-1');
  });

  it('renders planning terminal header when terminal is active', () => {
    renderPane({ terminalId: 'term-1' });
    expect(screen.getByText('▸ planning terminal')).toBeInTheDocument();
  });

  // State sync
  it('syncs with external prop changes when not dirty', () => {
    const issue = makeIssue();
    const { rerender, props } = renderPane();

    const updatedIssue = { ...issue, title: 'Externally updated', description: 'New desc' };
    rerender(<PlanningPane {...props} issue={updatedIssue} />);

    expect(screen.getByDisplayValue('Externally updated')).toBeInTheDocument();
    expect(screen.getByDisplayValue('New desc')).toBeInTheDocument();
  });

  it('does not overwrite local edits with external updates when dirty', () => {
    const issue = makeIssue();
    const { rerender, props } = renderPane();

    // Make local edit
    const titleInput = screen.getByDisplayValue('Plan this feature');
    fireEvent.change(titleInput, { target: { value: 'My local edit' } });

    // External update arrives
    const updatedIssue = { ...issue, title: 'External update' };
    rerender(<PlanningPane {...props} issue={updatedIssue} />);

    // Local edit should be preserved
    expect(screen.getByDisplayValue('My local edit')).toBeInTheDocument();
  });

  it('shows hint text in empty terminal state', () => {
    renderPane({ terminalId: null });
    expect(screen.getByText(/opens a shell for exploring/)).toBeInTheDocument();
  });
});
