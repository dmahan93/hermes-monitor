import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../src/components/Header';

describe('Header', () => {
  it('renders title and add button', () => {
    render(<Header onAdd={() => {}} connected={true} terminalCount={0} />);
    expect(screen.getByText('HERMES MONITOR')).toBeInTheDocument();
    expect(screen.getByText('[+ ADD TERMINAL]')).toBeInTheDocument();
  });

  it('add button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<Header onAdd={onAdd} connected={true} terminalCount={0} />);
    fireEvent.click(screen.getByText('[+ ADD TERMINAL]'));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('shows terminal count', () => {
    render(<Header onAdd={() => {}} connected={true} terminalCount={3} />);
    expect(screen.getByText('3 terminals')).toBeInTheDocument();
  });

  it('shows singular for 1 terminal', () => {
    render(<Header onAdd={() => {}} connected={true} terminalCount={1} />);
    expect(screen.getByText('1 terminal')).toBeInTheDocument();
  });

  it('shows connected status', () => {
    render(<Header onAdd={() => {}} connected={true} terminalCount={0} />);
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('shows disconnected status', () => {
    render(<Header onAdd={() => {}} connected={false} terminalCount={0} />);
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });
});
