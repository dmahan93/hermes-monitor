import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../src/components/Header';

describe('Header', () => {
  it('renders title', () => {
    render(<Header connected={true} terminalCount={0} />);
    expect(screen.getByText('HERMES MONITOR')).toBeInTheDocument();
  });

  it('add button calls onAdd when provided', () => {
    const onAdd = vi.fn();
    render(<Header onAdd={onAdd} connected={true} terminalCount={0} />);
    fireEvent.click(screen.getByText('[+ ADD TERMINAL]'));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('hides add button when onAdd not provided', () => {
    render(<Header connected={true} terminalCount={0} />);
    expect(screen.queryByText('[+ ADD TERMINAL]')).not.toBeInTheDocument();
  });

  it('shows terminal count', () => {
    render(<Header connected={true} terminalCount={3} />);
    expect(screen.getByText(/3 terminals/)).toBeInTheDocument();
  });

  it('shows singular for 1 terminal', () => {
    render(<Header connected={true} terminalCount={1} />);
    expect(screen.getByText(/1 terminal/)).toBeInTheDocument();
  });

  it('shows connected status', () => {
    render(<Header connected={true} terminalCount={0} />);
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('shows disconnected status', () => {
    render(<Header connected={false} terminalCount={0} />);
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });

  it('shows issue count when provided', () => {
    render(<Header connected={true} terminalCount={0} issueCount={5} />);
    expect(screen.getByText(/5 issues/)).toBeInTheDocument();
  });

  it('renders children', () => {
    render(
      <Header connected={true} terminalCount={0}>
        <span data-testid="child">child content</span>
      </Header>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
