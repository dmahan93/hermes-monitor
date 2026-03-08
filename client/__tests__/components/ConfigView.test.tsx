import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockConfig),
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
});
