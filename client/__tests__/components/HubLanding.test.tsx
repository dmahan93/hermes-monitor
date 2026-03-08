import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HubLanding } from '../../src/components/HubLanding';

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <HubLanding />
    </MemoryRouter>,
  );
}

describe('HubLanding', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    // Mock fetch that never resolves
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    renderWithRouter();
    expect(screen.getByText('Loading repositories...')).toBeInTheDocument();
  });

  it('shows repos from API response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'my-repo', name: 'My Repo', path: '/home/user/my-repo', issueCount: 5, prCount: 2 },
      ],
    } as Response);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('My Repo')).toBeInTheDocument();
    });
    expect(screen.getByText('/home/user/my-repo')).toBeInTheDocument();
    expect(screen.getByText('5 issues')).toBeInTheDocument();
    expect(screen.getByText('2 PRs')).toBeInTheDocument();
  });

  it('falls back to default repo when API errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('default')).toBeInTheDocument();
    });
  });

  it('shows header with title', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('HERMES MONITOR')).toBeInTheDocument();
    });
    expect(screen.getByText('Select a repository to manage')).toBeInTheDocument();
  });

  it('shows empty state when no repos', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    renderWithRouter();

    await waitFor(() => {
      expect(screen.getByText('No repositories found.')).toBeInTheDocument();
    });
  });

  it('renders repo links with correct hrefs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'test-repo', name: 'Test', path: '/tmp/test' },
      ],
    } as Response);

    renderWithRouter();

    await waitFor(() => {
      const link = screen.getByText('Test').closest('a');
      expect(link).toHaveAttribute('href', '/test-repo');
    });
  });
});
