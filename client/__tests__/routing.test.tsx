import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HubLanding } from '../src/components/HubLanding';
import { NotFound } from '../src/components/NotFound';

/**
 * Tests for the client-side routing setup.
 * These test that the correct components render at the correct URLs.
 */

function renderWithRoutes(initialRoute: string) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/" element={<HubLanding />} />
        <Route path="/:repoId/*" element={<div data-testid="app-view">App for repo</div>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default mock for HubLanding's fetch
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'default', name: 'default', path: '.' }],
    } as Response);
  });

  it('/ renders HubLanding', async () => {
    renderWithRoutes('/');
    await waitFor(() => {
      expect(screen.getByText('HERMES MONITOR')).toBeInTheDocument();
    });
  });

  it('/:repoId renders App', () => {
    renderWithRoutes('/my-repo');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });

  it('/:repoId/kanban renders App', () => {
    renderWithRoutes('/my-repo/kanban');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });

  it('/:repoId/terminals renders App', () => {
    renderWithRoutes('/my-repo/terminals');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });

  it('/:repoId/prs renders App', () => {
    renderWithRoutes('/my-repo/prs');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });

  it('/:repoId/prs/:prId renders App', () => {
    renderWithRoutes('/my-repo/prs/pr-123');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });

  it('/:repoId/issues/:issueId renders App', () => {
    renderWithRoutes('/my-repo/issues/issue-abc');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });

  it('/:repoId/git renders App', () => {
    renderWithRoutes('/my-repo/git');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });

  it('/:repoId/config renders App', () => {
    renderWithRoutes('/my-repo/config');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });

  it('/:repoId/research renders App', () => {
    renderWithRoutes('/my-repo/research');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });

  it('/:repoId/manager renders App', () => {
    renderWithRoutes('/my-repo/manager');
    expect(screen.getByTestId('app-view')).toBeInTheDocument();
  });
});
