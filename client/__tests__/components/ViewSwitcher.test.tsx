import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewSwitcher } from '../../src/components/ViewSwitcher';

describe('ViewSwitcher', () => {
  it('renders both buttons', () => {
    render(<ViewSwitcher mode="kanban" onChange={() => {}} />);
    expect(screen.getByText('[KANBAN]')).toBeInTheDocument();
    expect(screen.getByText('[TERMINALS]')).toBeInTheDocument();
  });

  it('highlights active mode', () => {
    render(<ViewSwitcher mode="kanban" onChange={() => {}} />);
    expect(screen.getByText('[KANBAN]').className).toContain('active');
    expect(screen.getByText('[TERMINALS]').className).not.toContain('active');
  });

  it('calls onChange when clicking inactive mode', () => {
    const onChange = vi.fn();
    render(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText('[TERMINALS]'));
    expect(onChange).toHaveBeenCalledWith('terminals');
  });
});
