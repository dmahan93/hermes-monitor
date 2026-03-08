import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useState, type ReactElement } from 'react';
import { ViewSwitcher } from '../../src/components/ViewSwitcher';

/** Track location changes to verify navigation */
function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

/** Wrap ViewSwitcher in a MemoryRouter with a /:repoId/* route so useParams/useNavigate work */
function renderWithRouter(ui: ReactElement, { route = '/test-repo/kanban' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/:repoId/*" element={<>{ui}<LocationDisplay /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ViewSwitcher', () => {
  it('renders all five buttons', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" />);
    expect(screen.getByText('[KANBAN]')).toBeInTheDocument();
    expect(screen.getByText('[TERMINALS]')).toBeInTheDocument();
    expect(screen.getByText(/PRs/)).toBeInTheDocument();
    expect(screen.getByText(/MANAGER/)).toBeInTheDocument();
    expect(screen.getByText('[CONFIG]')).toBeInTheDocument();
  });

  it('highlights active mode with view-switcher-active class', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" />);
    expect(screen.getByText('[KANBAN]').className).toContain('view-switcher-active');
    expect(screen.getByText('[TERMINALS]').className).not.toContain('view-switcher-active');
  });

  it('navigates to the clicked view', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" />);
    fireEvent.click(screen.getByText('[TERMINALS]'));
    expect(screen.getByTestId('location').textContent).toBe('/test-repo/terminals');
  });

  it('shows PR count when provided', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" prCount={3} />);
    expect(screen.getByText('[PRs 3]')).toBeInTheDocument();
  });

  it('navigates to prs when clicking PRs tab', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" />);
    fireEvent.click(screen.getByText(/PRs/));
    expect(screen.getByTestId('location').textContent).toBe('/test-repo/prs');
  });

  it('highlights config when active', () => {
    renderWithRouter(<ViewSwitcher mode="config" />, { route: '/test-repo/config' });
    expect(screen.getByText('[CONFIG]').className).toContain('view-switcher-active');
    expect(screen.getByText('[KANBAN]').className).not.toContain('view-switcher-active');
  });

  it('navigates to config when clicking CONFIG tab', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" />);
    fireEvent.click(screen.getByText('[CONFIG]'));
    expect(screen.getByTestId('location').textContent).toBe('/test-repo/config');
  });

  it('highlights manager when active', () => {
    renderWithRouter(<ViewSwitcher mode="manager" />, { route: '/test-repo/manager' });
    expect(screen.getByText(/MANAGER/).className).toContain('view-switcher-active');
    expect(screen.getByText('[KANBAN]').className).not.toContain('view-switcher-active');
  });

  it('navigates to manager when clicking MANAGER tab', () => {
    renderWithRouter(<ViewSwitcher mode="kanban" />);
    fireEvent.click(screen.getByText(/MANAGER/));
    expect(screen.getByTestId('location').textContent).toBe('/test-repo/manager');
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
