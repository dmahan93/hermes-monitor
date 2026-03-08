import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewSwitcher } from '../../src/components/ViewSwitcher';

describe('ViewSwitcher', () => {
  it('renders all five buttons', () => {
    render(<ViewSwitcher mode="kanban" onChange={() => {}} />);
    expect(screen.getByText('[KANBAN]')).toBeInTheDocument();
    expect(screen.getByText('[TERMINALS]')).toBeInTheDocument();
    expect(screen.getByText(/PRs/)).toBeInTheDocument();
    expect(screen.getByText('[RESEARCH]')).toBeInTheDocument();
    expect(screen.getByText('[CONFIG]')).toBeInTheDocument();
  });

  it('highlights active mode with view-switcher-active class', () => {
    render(<ViewSwitcher mode="kanban" onChange={() => {}} />);
    expect(screen.getByText('[KANBAN]').className).toContain('view-switcher-active');
    expect(screen.getByText('[TERMINALS]').className).not.toContain('view-switcher-active');
  });

  it('calls onChange when clicking inactive mode', () => {
    const onChange = vi.fn();
    render(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText('[TERMINALS]'));
    expect(onChange).toHaveBeenCalledWith('terminals');
  });

  it('shows PR count when provided', () => {
    render(<ViewSwitcher mode="kanban" onChange={() => {}} prCount={3} />);
    expect(screen.getByText('[PRs 3]')).toBeInTheDocument();
  });

  it('calls onChange with prs when clicking PRs tab', () => {
    const onChange = vi.fn();
    render(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText(/PRs/));
    expect(onChange).toHaveBeenCalledWith('prs');
  });

  it('highlights config when active', () => {
    render(<ViewSwitcher mode="config" onChange={() => {}} />);
    expect(screen.getByText('[CONFIG]').className).toContain('view-switcher-active');
    expect(screen.getByText('[KANBAN]').className).not.toContain('view-switcher-active');
  });

  it('calls onChange with config when clicking CONFIG tab', () => {
    const onChange = vi.fn();
    render(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText('[CONFIG]'));
    expect(onChange).toHaveBeenCalledWith('config');
  });

  it('highlights research when active', () => {
    render(<ViewSwitcher mode="research" onChange={() => {}} />);
    expect(screen.getByText('[RESEARCH]').className).toContain('view-switcher-active');
    expect(screen.getByText('[KANBAN]').className).not.toContain('view-switcher-active');
  });

  it('calls onChange with research when clicking RESEARCH tab', () => {
    const onChange = vi.fn();
    render(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText('[RESEARCH]'));
    expect(onChange).toHaveBeenCalledWith('research');
  });
});
