import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../../src/components/Header';

describe('Header', () => {
  it('renders title', () => {
    render(<Header connected={true} />);
    expect(screen.getByText('HERMES MONITOR')).toBeInTheDocument();
  });

  it('add button calls onAdd when provided', () => {
    const onAdd = vi.fn();
    render(<Header onAdd={onAdd} connected={true} />);
    fireEvent.click(screen.getByText('[+ ADD TERMINAL]'));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('hides add button when onAdd not provided', () => {
    render(<Header connected={true} />);
    expect(screen.queryByText('[+ ADD TERMINAL]')).not.toBeInTheDocument();
  });

  it('shows connected status', () => {
    render(<Header connected={true} />);
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('shows disconnected status', () => {
    render(<Header connected={false} />);
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(
      <Header connected={true}>
        <span data-testid="child">child content</span>
      </Header>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('does not display terminal or issue counts', () => {
    render(<Header connected={true} />);
    expect(screen.queryByText(/terminal/)).not.toBeInTheDocument();
    expect(screen.queryByText(/issue/)).not.toBeInTheDocument();
  });

  it('does not display awaiting input badge', () => {
    render(<Header connected={true} />);
    expect(screen.queryByText(/awaiting input/)).not.toBeInTheDocument();
  });
});
