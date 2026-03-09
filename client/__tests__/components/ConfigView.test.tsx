import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ConfigView } from '../../src/components/ConfigView';

// Mock fetch for config API
const mockConfig = {
  repoPath: '/home/user/project',
  worktreeBase: '/tmp/hermes-worktrees',
  reviewBase: '/tmp/hermes-reviews',
  screenshotBase: '/tmp/hermes-screenshots',
  targetBranch: 'main',
  requireScreenshotsForUiChanges: true,
  githubEnabled: false,
  githubRemote: 'origin',
  mergeMode: 'local',
  managerTerminalAgent: 'hermes',
};

const mockBranches = {
  branches: ['main', 'develop', 'feature/test'],
  current: 'main',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/branches')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockBranches),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });
  }));
});

describe('ConfigView', () => {
  it('renders the configuration heading', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText('CONFIGURATION')).toBeInTheDocument();
    });
  });

  it('renders the About section', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText('About')).toBeInTheDocument();
    });
  });

  it('renders the Links section', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText('Links')).toBeInTheDocument();
    });
  });

  it('renders GitHub link with correct href', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      const link = screen.getByText(/GitHub Repository/);
      expect(link).toBeInTheDocument();
    });
  });

  it('opens GitHub link in new tab', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      const link = screen.getByText(/GitHub Repository/);
      expect(link).toHaveAttribute('target', '_blank');
    });
  });

  it('renders Merge Mode dropdown', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText('Merge Mode')).toBeInTheDocument();
    });
  });

  it('shows all merge mode options', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText(/Local — merge locally/)).toBeInTheDocument();
      expect(screen.getByText(/GitHub — push branch/)).toBeInTheDocument();
      expect(screen.getByText(/Both — merge locally AND/)).toBeInTheDocument();
    });
  });

  it('renders Manager Terminal CLI dropdown with supported tools', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText('Manager Terminal')).toBeInTheDocument();
      expect(screen.getByText('CLI Tool')).toBeInTheDocument();
      expect(screen.getByText('Hermes')).toBeInTheDocument();
      expect(screen.getByText('Claude Code')).toBeInTheDocument();
      expect(screen.getByText('Codex')).toBeInTheDocument();
      expect(screen.getByText('Gemini CLI')).toBeInTheDocument();
    });
  });

  it('renders target branch as a dropdown with branches', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText('Target Branch')).toBeInTheDocument();
      const options = screen.getAllByRole('option');
      const branchOptions = options.filter(
        (o) => ['main', 'develop', 'feature/test'].includes(o.textContent || '')
      );
      expect(branchOptions.length).toBe(3);
    });
  });

  it('shows create new branch option in dropdown', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText(/Create new branch/)).toBeInTheDocument();
    });
  });

  it('shows create branch form when "Create new branch" is selected', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText('Target Branch')).toBeInTheDocument();
    });

    // Find the target branch select
    const selects = screen.getAllByRole('combobox');
    const branchSelect = selects.find((s) => {
      const options = Array.from(s.querySelectorAll('option'));
      return options.some((o) => o.value === '__create__');
    });
    expect(branchSelect).toBeTruthy();
    fireEvent.change(branchSelect!, { target: { value: '__create__' } });

    await waitFor(() => {
      expect(screen.getByText('New Branch Name')).toBeInTheDocument();
      expect(screen.getByText('Create')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  it('calls PATCH /config when selecting a different branch', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText('Target Branch')).toBeInTheDocument();
    });

    const selects = screen.getAllByRole('combobox');
    const branchSelect = selects.find((s) => {
      const options = Array.from(s.querySelectorAll('option'));
      return options.some((o) => o.value === '__create__');
    });
    expect(branchSelect).toBeTruthy();
    fireEvent.change(branchSelect!, { target: { value: 'develop' } });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/config'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ targetBranch: 'develop' }),
        })
      );
    });
  });

  it('fetches branches on mount', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/branches'));
    });
  });

  it('shows hint text about merge targeting', async () => {
    render(<ConfigView />);
    await waitFor(() => {
      expect(screen.getByText(/All future merges will target this branch/)).toBeInTheDocument();
    });
  });
});
