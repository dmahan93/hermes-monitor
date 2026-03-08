import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ViewSwitcher } from '../../src/components/ViewSwitcher';

/** Wrap ViewSwitcher in a MemoryRouter with a /:repoId/* route so useParams/useNavigate work */
function renderWithRouter(ui: React.ReactElement, { route = '/test-repo/kanban' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/:repoId/*" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ViewSwitcher', () => {
  it('renders all six buttons', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" />);
    expect(screen.getByText('[KANBAN]')).toBeInTheDocument();
    expect(screen.getByText('[TERMINALS]')).toBeInTheDocument();
    expect(screen.getByText(/PRs/)).toBeInTheDocument();
    expect(screen.getByText(/MANAGER/)).toBeInTheDocument();
    expect(screen.getByText('[RESEARCH]')).toBeInTheDocument();
    expect(screen.getByText('[CONFIG]')).toBeInTheDocument();
  });

  it('highlights active mode with view-switcher-active class', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" />);
    expect(screen.getByText('[KANBAN]').className).toContain('view-switcher-active');
    expect(screen.getByText('[TERMINALS]').className).not.toContain('view-switcher-active');
  });

  it('navigates when clicking inactive mode', () => {
    const onChange = vi.fn();
    renderWithRouter(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText('[TERMINALS]'));
    expect(onChange).toHaveBeenCalledWith('terminals');
  });

  it('shows PR count when provided', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" prCount={3} />);
    expect(screen.getByText('[PRs 3]')).toBeInTheDocument();
  });

  it('navigates to prs when clicking PRs tab', () => {
    const onChange = vi.fn();
    renderWithRouter(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText(/PRs/));
    expect(onChange).toHaveBeenCalledWith('prs');
  });

  it('highlights config when active', () => {
    renderWithRouter(<ViewSwitcher mode="config" />, { route: '/test-repo/config' });
    expect(screen.getByText('[CONFIG]').className).toContain('view-switcher-active');
    expect(screen.getByText('[KANBAN]').className).not.toContain('view-switcher-active');
  });

  it('navigates to config when clicking CONFIG tab', () => {
    const onChange = vi.fn();
    renderWithRouter(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText('[CONFIG]'));
    expect(onChange).toHaveBeenCalledWith('config');
  });

  it('highlights research when active', () => {
    renderWithRouter(<ViewSwitcher mode="research" />, { route: '/test-repo/research' });
    expect(screen.getByText('[RESEARCH]').className).toContain('view-switcher-active');
    expect(screen.getByText('[KANBAN]').className).not.toContain('view-switcher-active');
  });

  it('navigates to research when clicking RESEARCH tab', () => {
    const onChange = vi.fn();
    renderWithRouter(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText('[RESEARCH]'));
    expect(onChange).toHaveBeenCalledWith('research');
  });

  it('highlights manager when active', () => {
    renderWithRouter(<ViewSwitcher mode="manager" />, { route: '/test-repo/manager' });
    expect(screen.getByText(/MANAGER/).className).toContain('view-switcher-active');
    expect(screen.getByText('[KANBAN]').className).not.toContain('view-switcher-active');
  });

  it('navigates to manager when clicking MANAGER tab', () => {
    const onChange = vi.fn();
    renderWithRouter(<ViewSwitcher mode="kanban" onChange={onChange} />);
    fireEvent.click(screen.getByText(/MANAGER/));
    expect(onChange).toHaveBeenCalledWith('manager');
  });

  it('shows active agent count when provided', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" activeAgentCount={5} />);
    expect(screen.getByText(/MANAGER 5/)).toBeInTheDocument();
  });

  it('does not show agent count when zero', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" activeAgentCount={0} />);
    // Should just show [MANAGER] without a count
    expect(screen.getByText(/MANAGER/)).toBeInTheDocument();
    expect(screen.queryByText(/MANAGER 0/)).not.toBeInTheDocument();
  });
});
