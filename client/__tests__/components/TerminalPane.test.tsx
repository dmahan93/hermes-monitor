import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalPane } from '../../src/components/TerminalPane';
import type { TerminalInfo } from '../../src/types';

// Mock TerminalView since it needs xterm which doesn't work in jsdom
vi.mock('../../src/components/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid={`terminal-view-${terminalId}`}>mocked terminal</div>
  ),
}));

const mockTerminal: TerminalInfo = {
  id: 'test-123',
  title: 'Test Terminal',
  command: '/bin/bash',
  cols: 80,
  rows: 24,
  pid: 12345,
  createdAt: Date.now(),
};

describe('TerminalPane', () => {
  it('renders header with title', () => {
    render(
      <TerminalPane
        terminal={mockTerminal}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Test Terminal')).toBeInTheDocument();
  });

  it('shows pid', () => {
    render(
      <TerminalPane
        terminal={mockTerminal}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('pid:12345')).toBeInTheDocument();
  });

  it('close button calls onClose with terminal id', () => {
    const onClose = vi.fn();
    render(
      <TerminalPane
        terminal={mockTerminal}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTitle('Close terminal'));
    expect(onClose).toHaveBeenCalledWith('test-123');
  });

  it('renders terminal view', () => {
    render(
      <TerminalPane
        terminal={mockTerminal}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByTestId('terminal-view-test-123')).toBeInTheDocument();
  });

  it('renders drag handle', () => {
    render(
      <TerminalPane
        terminal={mockTerminal}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('⠿')).toBeInTheDocument();
  });

  it('does not show alert when not awaiting input', () => {
    render(
      <TerminalPane
        terminal={mockTerminal}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
        awaitingInput={false}
      />
    );
    expect(screen.queryByText('⏳ INPUT')).not.toBeInTheDocument();
  });

  it('shows alert badge when awaiting input', () => {
    render(
      <TerminalPane
        terminal={mockTerminal}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
        awaitingInput={true}
      />
    );
    expect(screen.getByText('⏳ INPUT')).toBeInTheDocument();
  });

  it('adds awaiting class to pane when awaiting input', () => {
    const { container } = render(
      <TerminalPane
        terminal={mockTerminal}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
        awaitingInput={true}
      />
    );
    expect(container.querySelector('.terminal-pane-awaiting')).not.toBeNull();
  });

  it('does not add awaiting class when not awaiting input', () => {
    const { container } = render(
      <TerminalPane
        terminal={mockTerminal}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
        awaitingInput={false}
      />
    );
    expect(container.querySelector('.terminal-pane-awaiting')).toBeNull();
  });
});
