import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskTerminalPane } from '../../src/components/TaskTerminalPane';
import type { Issue } from '../../src/types';

// Mock TerminalView
vi.mock('../../src/components/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid={`terminal-view-${terminalId}`}>mocked terminal</div>
  ),
}));

const mockIssue: Issue = {
  id: 'issue-1',
  title: 'Fix the bug',
  description: '',
  status: 'in_progress',
  agent: 'hermes',
  command: '',
  terminalId: 'term-1',
  branch: 'issue/abc-fix-the-bug',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('TaskTerminalPane', () => {
  it('renders with issue title', () => {
    render(
      <TaskTerminalPane
        issue={mockIssue}
        send={() => {}}
        subscribe={() => () => {}}
        onMinimize={() => {}}
      />
    );
    expect(screen.getByText('Fix the bug')).toBeInTheDocument();
  });

  it('renders terminal view for the issue', () => {
    render(
      <TaskTerminalPane
        issue={mockIssue}
        send={() => {}}
        subscribe={() => () => {}}
        onMinimize={() => {}}
      />
    );
    expect(screen.getByTestId('terminal-view-term-1')).toBeInTheDocument();
  });

  it('minimize button calls onMinimize', () => {
    const onMinimize = vi.fn();
    render(
      <TaskTerminalPane
        issue={mockIssue}
        send={() => {}}
        subscribe={() => () => {}}
        onMinimize={onMinimize}
      />
    );
    fireEvent.click(screen.getByTitle('Minimize'));
    expect(onMinimize).toHaveBeenCalledOnce();
  });

  it('returns null when issue has no terminalId', () => {
    const issueNoTerm = { ...mockIssue, terminalId: null };
    const { container } = render(
      <TaskTerminalPane
        issue={issueNoTerm}
        send={() => {}}
        subscribe={() => () => {}}
        onMinimize={() => {}}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('does not show alert when not awaiting input', () => {
    render(
      <TaskTerminalPane
        issue={mockIssue}
        send={() => {}}
        subscribe={() => () => {}}
        onMinimize={() => {}}
        awaitingInput={false}
      />
    );
    expect(screen.queryByText('⏳ INPUT')).not.toBeInTheDocument();
  });

  it('shows alert badge when awaiting input', () => {
    render(
      <TaskTerminalPane
        issue={mockIssue}
        send={() => {}}
        subscribe={() => () => {}}
        onMinimize={() => {}}
        awaitingInput={true}
      />
    );
    expect(screen.getByText('⏳ INPUT')).toBeInTheDocument();
  });

  it('adds awaiting class when awaiting input', () => {
    const { container } = render(
      <TaskTerminalPane
        issue={mockIssue}
        send={() => {}}
        subscribe={() => () => {}}
        onMinimize={() => {}}
        awaitingInput={true}
      />
    );
    expect(container.querySelector('.terminal-pane-awaiting')).not.toBeNull();
  });
});
