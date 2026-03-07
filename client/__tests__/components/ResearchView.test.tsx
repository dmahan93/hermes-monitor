import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ResearchView } from '../../src/components/ResearchView';

// Mock TerminalView
vi.mock('../../src/components/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid={`terminal-view-${terminalId}`}>mocked terminal</div>
  ),
}));

const STORAGE_KEY = 'hermes:researchTerminalId';

function mockSubscribe() {
  const handlers: ((msg: any) => void)[] = [];
  const subscribe = (handler: (msg: any) => void) => {
    handlers.push(handler);
    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  };
  const emit = (msg: any) => handlers.forEach((h) => h(msg));
  return { subscribe, emit };
}

describe('ResearchView', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('shows loading state while initializing', () => {
    // Make fetch hang
    global.fetch = vi.fn(() => new Promise(() => {})) as any;
    const { subscribe } = mockSubscribe();

    render(<ResearchView send={() => {}} subscribe={subscribe} />);
    expect(screen.getByText(/Spawning research terminal/)).toBeInTheDocument();
  });

  it('creates a terminal and renders it when no saved ID exists', async () => {
    // No localStorage saved ID → goes straight to POST /api/terminals
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'research-1', title: 'Research', pid: 123 }),
    }) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-research-1')).toBeInTheDocument();
    });

    // Should persist the ID
    expect(localStorage.getItem(STORAGE_KEY)).toBe('research-1');
  });

  it('restores a saved terminal from localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'saved-term');
    // Has saved ID → calls GET /api/terminals to validate
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: 'saved-term' }, { id: 'other' }]),
    }) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-saved-term')).toBeInTheDocument();
    });

    // Should only call GET /api/terminals — no POST
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('creates new terminal when saved one no longer exists', async () => {
    localStorage.setItem(STORAGE_KEY, 'stale-term');
    global.fetch = vi.fn()
      // GET /api/terminals — stale-term not found
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'other-term' }]),
      })
      // POST /api/terminals — create new
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'new-term', title: 'Research', pid: 456 }),
      }) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-new-term')).toBeInTheDocument();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('new-term');
  });

  it('renders header with RESEARCH title', async () => {
    // No saved ID → POST creates terminal
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'r-1', title: 'Research', pid: 1 }),
    }) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByText(/RESEARCH/)).toBeInTheDocument();
    });
  });

  it('shows error state when terminal creation fails', async () => {
    // No saved ID → POST fails
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Failed' }),
    }) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to create terminal/)).toBeInTheDocument();
    });

    expect(screen.getByText('[NEW TERMINAL]')).toBeInTheDocument();
  });

  it('clears state when terminal is removed via WebSocket', async () => {
    // No saved ID → POST creates terminal
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'ws-term', title: 'Research', pid: 1 }),
    }) as any;

    const { subscribe, emit } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-ws-term')).toBeInTheDocument();
    });

    // Simulate terminal removal
    emit({ type: 'terminal:removed', terminalId: 'ws-term' });

    await waitFor(() => {
      expect(screen.queryByTestId('terminal-view-ws-term')).not.toBeInTheDocument();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('respawn button creates a new terminal', async () => {
    // No saved ID → POST creates terminal
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'first-term', title: 'Research', pid: 1 }),
    }) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-first-term')).toBeInTheDocument();
    });

    // Set up mock for respawn POST
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'respawn-term', title: 'Research', pid: 2 }),
    });

    fireEvent.click(screen.getByText('[RESPAWN]'));

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-respawn-term')).toBeInTheDocument();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('respawn-term');
  });
});
