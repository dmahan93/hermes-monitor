import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from '../../src/components/StatusBar';

describe('StatusBar', () => {
  it('renders terminal count', () => {
    render(<StatusBar connected={true} terminalCount={3} />);
    expect(screen.getByText(/3 terminals active/)).toBeInTheDocument();
  });

  it('shows singular for 1 terminal', () => {
    render(<StatusBar connected={true} terminalCount={1} />);
    expect(screen.getByText(/1 terminal active/)).toBeInTheDocument();
  });

  it('shows connected ws status', () => {
    render(<StatusBar connected={true} terminalCount={0} />);
    expect(screen.getByText(/ws: ok/)).toBeInTheDocument();
  });

  it('shows disconnected ws status', () => {
    render(<StatusBar connected={false} terminalCount={0} />);
    expect(screen.getByText(/ws: lost/)).toBeInTheDocument();
  });

  it('shows issue count when provided', () => {
    render(<StatusBar connected={true} terminalCount={0} issueCount={5} />);
    expect(screen.getByText(/5 issues/)).toBeInTheDocument();
  });

  it('does not show awaiting input when count is 0', () => {
    render(<StatusBar connected={true} terminalCount={2} awaitingInputCount={0} />);
    expect(screen.queryByText(/awaiting input/)).not.toBeInTheDocument();
  });

  it('shows awaiting input when count is positive', () => {
    render(<StatusBar connected={true} terminalCount={2} awaitingInputCount={3} />);
    expect(screen.getByText(/3 awaiting input/)).toBeInTheDocument();
  });

  it('does not show awaiting input when not provided', () => {
    render(<StatusBar connected={true} terminalCount={2} />);
    expect(screen.queryByText(/awaiting input/)).not.toBeInTheDocument();
  });

  it('shows awaiting input count of 1', () => {
    render(<StatusBar connected={true} terminalCount={1} awaitingInputCount={1} />);
    expect(screen.getByText(/1 awaiting input/)).toBeInTheDocument();
  });
});
