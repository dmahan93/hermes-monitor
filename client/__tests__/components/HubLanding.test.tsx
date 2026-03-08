import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HubLanding } from '../../src/components/HubLanding';
import type { RepoEntry } from '../../src/components/HubLanding';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function makeRepo(overrides: Partial<RepoEntry> = {}): RepoEntry {
  return {
    id: 'repo-1',
    name: 'my-project',
    path: '/home/user/my-project',
    port: 4001,
    pid: null,
    status: 'stopped',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <HubLanding />
    </MemoryRouter>,
  );
}

function mockFetchRepos(repos: RepoEntry[]) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => repos,
  } as Response);
}

describe('HubLanding', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Loading & header ──

  it('shows loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    renderLanding();
    expect(screen.getByText('Loading repositories...')).toBeInTheDocument();
  });

  it('shows header with title and subtitle', async () => {
    mockFetchRepos([]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('HERMES MONITOR HUB')).toBeInTheDocument();
    });
    expect(screen.getByText('Select a repository to manage')).toBeInTheDocument();
  });

  it('shows logo icon', async () => {
    mockFetchRepos([]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('⎇')).toBeInTheDocument();
    });
  });

  // ── Repo display ──

  it('shows empty state when no repos', async () => {
    mockFetchRepos([]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText(/No repositories registered/)).toBeInTheDocument();
    });
  });

  it('shows repo cards from API response', async () => {
    const repo = makeRepo({ name: 'My Project', path: '/home/user/my-project', status: 'running' });
    mockFetchRepos([repo]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('My Project')).toBeInTheDocument();
    });
    expect(screen.getByText('/home/user/my-project')).toBeInTheDocument();
  });

  it('shows error when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('Failed to load repositories')).toBeInTheDocument();
    });
  });

  // ── Status indicators ──

  it('shows green status dot for running repos', async () => {
    mockFetchRepos([makeRepo({ status: 'running' })]);
    renderLanding();
    await waitFor(() => {
      const dot = screen.getByTitle('Running');
      expect(dot).toHaveClass('hub-status-running');
    });
  });

  it('shows muted status dot for stopped repos', async () => {
    mockFetchRepos([makeRepo({ status: 'stopped' })]);
    renderLanding();
    await waitFor(() => {
      const dot = screen.getByTitle('Stopped');
      expect(dot).toHaveClass('hub-status-stopped');
    });
  });

  it('shows error status dot for errored repos', async () => {
    mockFetchRepos([makeRepo({ status: 'error' })]);
    renderLanding();
    await waitFor(() => {
      const dot = screen.getByTitle('Error');
      expect(dot).toHaveClass('hub-status-error');
    });
  });

  it('shows warning status dot for starting repos', async () => {
    mockFetchRepos([makeRepo({ status: 'starting' })]);
    renderLanding();
    await waitFor(() => {
      const dot = screen.getByTitle('Starting');
      expect(dot).toHaveClass('hub-status-starting');
    });
  });

  // ── Quick stats ──

  it('shows quick stats when repo is running', async () => {
    mockFetchRepos([makeRepo({ status: 'running', issueCount: 5, activeAgents: 2, prCount: 3 })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('5 issues')).toBeInTheDocument();
    });
    expect(screen.getByText('2 agents')).toBeInTheDocument();
    expect(screen.getByText('3 PRs')).toBeInTheDocument();
  });

  it('hides stats when repo is stopped', async () => {
    mockFetchRepos([makeRepo({ status: 'stopped', issueCount: 5, prCount: 3 })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeInTheDocument();
    });
    expect(screen.queryByText('5 issues')).not.toBeInTheDocument();
  });

  // ── Navigation ──

  it('navigates to repo on card click', async () => {
    mockFetchRepos([makeRepo({ id: 'test-repo' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('my-project'));
    expect(mockNavigate).toHaveBeenCalledWith('/test-repo');
  });

  it('navigates to settings on settings click', async () => {
    mockFetchRepos([makeRepo({ id: 'test-repo' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByTitle('Settings')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle('Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('/test-repo/config');
  });

  // ── Start/Stop toggle ──

  it('shows Start button for stopped repo', async () => {
    mockFetchRepos([makeRepo({ status: 'stopped' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('▶ Start')).toBeInTheDocument();
    });
  });

  it('shows Stop button for running repo', async () => {
    mockFetchRepos([makeRepo({ status: 'running' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('■ Stop')).toBeInTheDocument();
    });
  });

  it('calls PATCH to toggle repo status', async () => {
    const repo = makeRepo({ id: 'repo-1', status: 'stopped' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [repo] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...repo, status: 'running' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ ...repo, status: 'running' }] } as Response);

    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('▶ Start')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('▶ Start'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/repos/repo-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'running' }),
        }),
      );
    });
  });

  // ── Remove ──

  it('shows confirm dialog when remove is clicked', async () => {
    mockFetchRepos([makeRepo({ name: 'my-project' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByTitle('Remove')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle('Remove'));
    await waitFor(() => {
      expect(screen.getByText('Remove Repository')).toBeInTheDocument();
    });
    expect(screen.getByText(/Remove "my-project" from the hub/)).toBeInTheDocument();
  });

  it('calls DELETE when remove is confirmed', async () => {
    const repo = makeRepo({ id: 'repo-1' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [repo] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

    renderLanding();
    await waitFor(() => {
      expect(screen.getByTitle('Remove')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Remove'));
    await waitFor(() => {
      expect(screen.getByText('[REMOVE]')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('[REMOVE]'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/repos/repo-1',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // ── Add Repo ──

  it('shows add repo button', async () => {
    mockFetchRepos([]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('+ Add Repo')).toBeInTheDocument();
    });
  });

  it('toggles add repo form on button click', async () => {
    mockFetchRepos([]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('+ Add Repo')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('+ Add Repo'));
    expect(screen.getByTestId('add-repo-form')).toBeInTheDocument();
    expect(screen.getByLabelText('Repository path')).toBeInTheDocument();
    expect(screen.getByLabelText('Name (auto-detected)')).toBeInTheDocument();
  });

  it('auto-detects name from path', async () => {
    mockFetchRepos([]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('+ Add Repo')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('+ Add Repo'));

    const pathInput = screen.getByLabelText('Repository path');
    fireEvent.change(pathInput, { target: { value: '/home/user/awesome-project' } });

    const nameInput = screen.getByLabelText('Name (auto-detected)') as HTMLInputElement;
    expect(nameInput.value).toBe('awesome-project');
  });

  it('shows validation error for empty path', async () => {
    mockFetchRepos([]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('+ Add Repo')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('+ Add Repo'));
    fireEvent.click(screen.getByText('[REGISTER]'));

    expect(screen.getByText('Path is required')).toBeInTheDocument();
  });

  it('shows validation error for relative path', async () => {
    mockFetchRepos([]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('+ Add Repo')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('+ Add Repo'));

    const pathInput = screen.getByLabelText('Repository path');
    fireEvent.change(pathInput, { target: { value: 'relative/path' } });
    fireEvent.click(screen.getByText('[REGISTER]'));

    expect(screen.getByText('Path must be absolute (start with /)')).toBeInTheDocument();
  });

  it('submits add repo form via POST', async () => {
    const newRepo = makeRepo({ id: 'new-repo', name: 'new-project', path: '/home/user/new-project' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => newRepo, status: 201 } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [newRepo] } as Response);

    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('+ Add Repo')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+ Add Repo'));
    const pathInput = screen.getByLabelText('Repository path');
    fireEvent.change(pathInput, { target: { value: '/home/user/new-project' } });
    fireEvent.click(screen.getByText('[REGISTER]'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/repos',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ path: '/home/user/new-project', name: 'new-project' }),
        }),
      );
    });
  });

  it('shows server error from add repo response', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'path must be an existing directory' }),
      } as Response);

    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('+ Add Repo')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+ Add Repo'));
    const pathInput = screen.getByLabelText('Repository path');
    fireEvent.change(pathInput, { target: { value: '/nonexistent/path' } });
    fireEvent.click(screen.getByText('[REGISTER]'));

    await waitFor(() => {
      expect(screen.getByText('path must be an existing directory')).toBeInTheDocument();
    });
  });

  it('closes add form and refreshes on successful add', async () => {
    const newRepo = makeRepo({ id: 'new-repo', name: 'new-project', path: '/home/user/new-project' });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => newRepo, status: 201 } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [newRepo] } as Response);

    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('+ Add Repo')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+ Add Repo'));
    const pathInput = screen.getByLabelText('Repository path');
    fireEvent.change(pathInput, { target: { value: '/home/user/new-project' } });
    fireEvent.click(screen.getByText('[REGISTER]'));

    await waitFor(() => {
      expect(screen.getByText('new-project')).toBeInTheDocument();
    });
    // Form should be hidden
    expect(screen.queryByTestId('add-repo-form')).not.toBeInTheDocument();
  });

  // ── Multiple repos ──

  it('renders multiple repo cards in a grid', async () => {
    const repos = [
      makeRepo({ id: 'r1', name: 'repo-alpha', path: '/a', status: 'running' }),
      makeRepo({ id: 'r2', name: 'repo-beta', path: '/b', status: 'stopped' }),
      makeRepo({ id: 'r3', name: 'repo-gamma', path: '/c', status: 'error' }),
    ];
    mockFetchRepos(repos);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('repo-alpha')).toBeInTheDocument();
    });
    expect(screen.getByText('repo-beta')).toBeInTheDocument();
    expect(screen.getByText('repo-gamma')).toBeInTheDocument();
  });

  // ── Cancel button ──

  it('hides add form on cancel', async () => {
    mockFetchRepos([]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('+ Add Repo')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('+ Add Repo'));
    expect(screen.getByTestId('add-repo-form')).toBeInTheDocument();

    fireEvent.click(screen.getByText('✕ Cancel'));
    expect(screen.queryByTestId('add-repo-form')).not.toBeInTheDocument();
  });

  // ── Keyboard activation ──

  it('navigates on Enter key press on card', async () => {
    mockFetchRepos([makeRepo({ id: 'kb-repo' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeInTheDocument();
    });
    const card = screen.getByRole('button', { name: /my-project/i });
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/kb-repo');
  });

  it('navigates on Space key press on card', async () => {
    mockFetchRepos([makeRepo({ id: 'kb-repo' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('my-project')).toBeInTheDocument();
    });
    const card = screen.getByRole('button', { name: /my-project/i });
    fireEvent.keyDown(card, { key: ' ' });
    expect(mockNavigate).toHaveBeenCalledWith('/kb-repo');
  });

  // ── Starting status toggle ──

  it('shows Stop button for starting repo and sends stopped status', async () => {
    const repo = makeRepo({ id: 'repo-1', status: 'starting' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [repo] } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...repo, status: 'stopped' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ ...repo, status: 'stopped' }] } as Response);

    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('■ Stop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('■ Stop'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/repos/repo-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'stopped' }),
        }),
      );
    });
  });

  // ── Failed mutation error display ──

  it('shows error when PATCH toggle fails', async () => {
    const repo = makeRepo({ id: 'repo-1', status: 'stopped' });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [repo] } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      } as Response);

    renderLanding();
    await waitFor(() => {
      expect(screen.getByText('▶ Start')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('▶ Start'));

    await waitFor(() => {
      expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });
  });

  it('shows error when DELETE fails', async () => {
    const repo = makeRepo({ id: 'repo-1', status: 'stopped' });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => [repo] } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Delete failed' }),
      } as Response);

    renderLanding();
    await waitFor(() => {
      expect(screen.getByTitle('Remove')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Remove'));
    await waitFor(() => {
      expect(screen.getByText('[REMOVE]')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('[REMOVE]'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });
  });

  // ── Remove disabled for running repos ──

  it('disables Remove button for running repos', async () => {
    mockFetchRepos([makeRepo({ status: 'running' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByTitle('Stop the repo before removing')).toBeInTheDocument();
    });
    const removeBtn = screen.getByLabelText('Remove');
    expect(removeBtn).toBeDisabled();
  });

  it('disables Remove button for starting repos', async () => {
    mockFetchRepos([makeRepo({ status: 'starting' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByTitle('Stop the repo before removing')).toBeInTheDocument();
    });
    const removeBtn = screen.getByLabelText('Remove');
    expect(removeBtn).toBeDisabled();
  });

  it('enables Remove button for stopped repos', async () => {
    mockFetchRepos([makeRepo({ status: 'stopped' })]);
    renderLanding();
    await waitFor(() => {
      expect(screen.getByTitle('Remove')).toBeInTheDocument();
    });
    const removeBtn = screen.getByLabelText('Remove');
    expect(removeBtn).not.toBeDisabled();
  });
});
