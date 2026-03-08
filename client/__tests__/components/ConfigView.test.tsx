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
});
