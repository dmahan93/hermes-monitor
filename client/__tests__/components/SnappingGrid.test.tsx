import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TerminalGrid } from '../../src/components/TerminalGrid';
import type { TerminalInfo, GridItem } from '../../src/types';

// Mock TerminalView
vi.mock('../../src/components/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid={`terminal-view-${terminalId}`}>mocked</div>
  ),
}));

// Mock react-grid-layout to capture props
let capturedProps: any = {};
vi.mock('react-grid-layout', () => {
  const Responsive = (props: any) => {
    capturedProps = props;
    return <div data-testid="grid" className={props.className}>{props.children}</div>;
  };
  const WidthProvider = (Component: any) => (props: any) => <Component {...props} width={1200} />;
  return { Responsive, WidthProvider, default: Responsive };
});

const makeTerminal = (id: string): TerminalInfo => ({
  id, title: `T-${id}`, command: '/bin/bash', cols: 80, rows: 24,
  pid: 1000, createdAt: Date.now(),
});

const makeLayout = (id: string, idx: number): GridItem => ({
  i: id, x: (idx % 2) * 6, y: Math.floor(idx / 2) * 4, w: 6, h: 4,
});

describe('Snapping Grid', () => {
  it('uses vertical compaction for snapping', () => {
    render(
      <TerminalGrid
        terminals={[makeTerminal('1')]}
        layout={[makeLayout('1', 0)]}
        onLayoutChange={() => {}}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
      />
    );
    expect(capturedProps.compactType).toBe('vertical');
  });

  it('has responsive breakpoints for grid columns', () => {
    render(
      <TerminalGrid
        terminals={[makeTerminal('1')]}
        layout={[makeLayout('1', 0)]}
        onLayoutChange={() => {}}
        send={() => {}}
        subscribe={() => () => {}}
        onClose={() => {}}
      />
    );
    // Should have multiple breakpoints for responsive snapping
    expect(Object.keys(capturedProps.cols).length).toBeGreaterThanOrEqual(2);
    expect(capturedProps.cols.lg).toBe(12);
  });
});
