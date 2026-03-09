import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FolderPicker } from '../../src/components/FolderPicker';

/** Helper to mock a successful browse response */
function mockBrowseResponse(data: {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string; isGitRepo: boolean }>;
}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  } as Response);
}

/** Standard browse response for /home/user */
const HOME_RESPONSE = {
  path: '/home/user',
  parent: '/home',
  entries: [
    { name: 'projects', path: '/home/user/projects', isGitRepo: false },
    { name: 'my-repo', path: '/home/user/my-repo', isGitRepo: true },
    { name: 'docs', path: '/home/user/docs', isGitRepo: false },
  ],
};

describe('FolderPicker', () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    onSelect.mockReset();
    onClose.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Initial loading ──

  it('shows loading state initially', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('fetches home directory when no initialPath', async () => {
    const fetchSpy = mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('my-repo')).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/hub/browse');
  });

  it('fetches initialPath when provided', async () => {
    const fetchSpy = mockBrowseResponse({
      path: '/home/user/projects',
      parent: '/home/user',
      entries: [],
    });
    render(
      <FolderPicker
        onSelect={onSelect}
        onClose={onClose}
        initialPath="/home/user/projects"
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('No subdirectories')).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/hub/browse?path=%2Fhome%2Fuser%2Fprojects',
    );
  });

  // ── Directory listing ──

  it('displays directory entries', async () => {
    mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });
    expect(screen.getByText('my-repo')).toBeInTheDocument();
    expect(screen.getByText('docs')).toBeInTheDocument();
  });

  it('marks git repos with a badge', async () => {
    mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('my-repo')).toBeInTheDocument();
    });
    // The git badge should be present
    expect(screen.getByText('git')).toBeInTheDocument();
  });

  it('shows empty state when no subdirectories', async () => {
    mockBrowseResponse({
      path: '/home/user/empty',
      parent: '/home/user',
      entries: [],
    });
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('No subdirectories')).toBeInTheDocument();
    });
  });

  // ── Navigation ──

  it('navigates into a directory on click', async () => {
    const fetchSpy = mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });

    // Mock the next browse response
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        path: '/home/user/projects',
        parent: '/home/user',
        entries: [
          { name: 'web-app', path: '/home/user/projects/web-app', isGitRepo: true },
        ],
      }),
    } as Response);

    fireEvent.click(screen.getByText('projects'));
    await waitFor(() => {
      expect(screen.getByText('web-app')).toBeInTheDocument();
    });
  });

  it('navigates up via parent (..) entry', async () => {
    const fetchSpy = mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('..')).toBeInTheDocument();
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        path: '/home',
        parent: '/',
        entries: [
          { name: 'user', path: '/home/user', isGitRepo: false },
        ],
      }),
    } as Response);

    fireEvent.click(screen.getByText('..'));
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/browse?path=%2Fhome',
      );
    });
  });

  it('does not show parent entry when at root', async () => {
    mockBrowseResponse({
      path: '/',
      parent: null,
      entries: [
        { name: 'home', path: '/home', isGitRepo: false },
      ],
    });
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('home')).toBeInTheDocument();
    });
    expect(screen.queryByText('..')).not.toBeInTheDocument();
  });

  // ── Selection ──

  it('calls onSelect when Select button is clicked', async () => {
    mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('my-repo')).toBeInTheDocument();
    });

    const selectBtn = screen.getByTitle('Select my-repo');
    fireEvent.click(selectBtn);
    expect(onSelect).toHaveBeenCalledWith('/home/user/my-repo');
  });

  it('calls onSelect with current directory on footer button click', async () => {
    mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('[SELECT THIS FOLDER]')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('[SELECT THIS FOLDER]'));
    expect(onSelect).toHaveBeenCalledWith('/home/user');
  });

  // ── Close ──

  it('calls onClose when close button is clicked', async () => {
    mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Browse Folders')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Close folder picker'));
    expect(onClose).toHaveBeenCalled();
  });

  // ── Breadcrumbs ──

  it('renders breadcrumb navigation', async () => {
    mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Browse Folders')).toBeInTheDocument();
    });
    // Root crumb
    expect(screen.getByTitle('Root')).toBeInTheDocument();
    // "user" is the last segment, rendered as current (not clickable)
    expect(screen.getByText('user')).toBeInTheDocument();
  });

  it('navigates to breadcrumb segment on click', async () => {
    const fetchSpy = mockBrowseResponse({
      path: '/home/user/projects/web',
      parent: '/home/user/projects',
      entries: [],
    });
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('No subdirectories')).toBeInTheDocument();
    });

    // Click on "home" breadcrumb (which links to /home)
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        path: '/home',
        parent: '/',
        entries: [],
      }),
    } as Response);

    const homeButton = screen.getByTitle('/home');
    fireEvent.click(homeButton);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/browse?path=%2Fhome',
      );
    });
  });

  // ── Manual path input ──

  it('shows manual path input on pencil click', async () => {
    mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Browse Folders')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Type a path manually'));
    expect(screen.getByPlaceholderText('/path/to/directory')).toBeInTheDocument();
  });

  it('navigates to typed path on Go click', async () => {
    const fetchSpy = mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Browse Folders')).toBeInTheDocument();
    });

    // Show manual input
    fireEvent.click(screen.getByLabelText('Type a path manually'));
    const input = screen.getByPlaceholderText('/path/to/directory');

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        path: '/tmp/test',
        parent: '/tmp',
        entries: [],
      }),
    } as Response);

    fireEvent.change(input, { target: { value: '/tmp/test' } });
    fireEvent.click(screen.getByText('Go'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/browse?path=%2Ftmp%2Ftest',
      );
    });
  });

  it('navigates to typed path on Enter key', async () => {
    const fetchSpy = mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Browse Folders')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Type a path manually'));
    const input = screen.getByPlaceholderText('/path/to/directory');

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        path: '/var/log',
        parent: '/var',
        entries: [],
      }),
    } as Response);

    fireEvent.change(input, { target: { value: '/var/log' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/browse?path=%2Fvar%2Flog',
      );
    });
  });

  it('hides manual input on Escape key', async () => {
    mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Browse Folders')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Type a path manually'));
    const input = screen.getByPlaceholderText('/path/to/directory');
    expect(input).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByPlaceholderText('/path/to/directory')).not.toBeInTheDocument();
  });

  // ── Error handling ──

  it('shows error when browse fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Path does not exist' }),
    } as Response);
    render(
      <FolderPicker
        onSelect={onSelect}
        onClose={onClose}
        initialPath="/nonexistent"
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Path does not exist');
    });
  });

  it('shows fallback error when json parsing fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    } as Response);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to browse (500)');
    });
  });

  it('shows error when fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'));
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network failure');
    });
  });

  // ── Keyboard accessibility ──

  it('supports keyboard navigation on parent entry', async () => {
    const fetchSpy = mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('..')).toBeInTheDocument();
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        path: '/home',
        parent: '/',
        entries: [],
      }),
    } as Response);

    const parentEntry = screen.getByText('..').closest('[role="button"]')!;
    fireEvent.keyDown(parentEntry, { key: 'Enter' });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/browse?path=%2Fhome',
      );
    });
  });

  it('supports keyboard navigation on directory entry', async () => {
    const fetchSpy = mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument();
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        path: '/home/user/projects',
        parent: '/home/user',
        entries: [],
      }),
    } as Response);

    const entryInfo = screen.getByText('projects').closest('[role="button"]')!;
    fireEvent.keyDown(entryInfo, { key: ' ' });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hub/browse?path=%2Fhome%2Fuser%2Fprojects',
      );
    });
  });

  // ── data-testid ──

  it('has data-testid on root element', async () => {
    mockBrowseResponse(HOME_RESPONSE);
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByTestId('folder-picker')).toBeInTheDocument();
    });
  });

  // ── Select this folder disabled while loading ──

  it('disables select current folder button while loading', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}));
    render(<FolderPicker onSelect={onSelect} onClose={onClose} />);
    const btn = screen.getByText('[SELECT THIS FOLDER]');
    expect(btn).toBeDisabled();
  });
});
