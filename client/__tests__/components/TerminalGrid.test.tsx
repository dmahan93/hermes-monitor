import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalGrid } from '../../src/components/TerminalGrid';
import type { TerminalInfo, GridItem } from '../../src/types';

// Mock TerminalView
vi.mock('../../src/components/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid={`terminal-view-${terminalId}`}>mocked terminal</div>
  ),
}));

// Mock react-grid-layout's WidthProvider since it needs DOM measurements
vi.mock('react-grid-layout', () => {
  const Responsive = ({ children, className }: any) => (
    <div className={className} data-testid="grid-layout">{children}</div>
  );
  const WidthProvider = (Component: any) => (props: any) => <Component {...props} width={1200} />;
  return { Responsive, WidthProvider, default: Responsive };
});

const makeTerminal = (id: string, title: string): TerminalInfo => ({
  id,
  title,
  command: '/bin/bash',
  cols: 80,
  rows: 24,
  pid: 1000 + parseInt(id),
  createdAt: Date.now(),
});

const makeLayout = (id: string, idx: number): GridItem => ({
  i: id,
  x: (idx % 2) * 6,
  y: Math.floor(idx / 2) * 4,
  w: 6,
  h: 4,
});

describe('TerminalGrid', () => {
  it('renders panes for each terminal', () => {
    const terminals = [makeTerminal('1', 'T1'), makeTerminal('2', 'T2')];
    const layout = [makeLayout('1', 0), makeLayout('2', 1)];

    render(
      <TerminalGrid
        terminals={terminals}
        layout={layout}
        onLayoutChange={() => {}}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('T1')).toBeInTheDocument();
    expect(screen.getByText('T2')).toBeInTheDocument();
  });

  it('handles empty state', () => {
    render(
      <TerminalGrid
        terminals={[]}
        layout={[]}
        onLayoutChange={() => {}}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/No terminals running/)).toBeInTheDocument();
  });

  it('shows add terminal hint in empty state', () => {
    render(
      <TerminalGrid
        terminals={[]}
        layout={[]}
        onLayoutChange={() => {}}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('[+ ADD TERMINAL]')).toBeInTheDocument();
  });
});
