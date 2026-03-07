import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
    const onTerminalIdChange = vi.fn();
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'research-1', title: 'Research', pid: 123 }),
    }) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} onTerminalIdChange={onTerminalIdChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-research-1')).toBeInTheDocument();
    });

    // Should persist the ID
    expect(localStorage.getItem(STORAGE_KEY)).toBe('research-1');
    // Should notify parent
    expect(onTerminalIdChange).toHaveBeenCalledWith('research-1');
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
    const onTerminalIdChange = vi.fn();
    // No saved ID → POST creates terminal
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'ws-term', title: 'Research', pid: 1 }),
    }) as any;

    const { subscribe, emit } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} onTerminalIdChange={onTerminalIdChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-ws-term')).toBeInTheDocument();
    });

    // Simulate terminal removal
    act(() => {
      emit({ type: 'terminal:removed', terminalId: 'ws-term' });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('terminal-view-ws-term')).not.toBeInTheDocument();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // Should notify parent that terminal is gone
    expect(onTerminalIdChange).toHaveBeenCalledWith(null);
  });

  it('respawn button deletes old terminal before creating new one', async () => {
    // No saved ID → POST creates terminal
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'first-term', title: 'Research', pid: 1 }),
    }) as any;

    const onTerminalIdChange = vi.fn();
    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} onTerminalIdChange={onTerminalIdChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-first-term')).toBeInTheDocument();
    });

    // Set up mocks for respawn: DELETE old + POST new
    (global.fetch as any)
      // DELETE /api/terminals/first-term
      .mockResolvedValueOnce({ ok: true })
      // POST /api/terminals
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'respawn-term', title: 'Research', pid: 2 }),
      });

    fireEvent.click(screen.getByText('[RESPAWN]'));

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-respawn-term')).toBeInTheDocument();
    });

    // Verify the DELETE was called for the old terminal
    const fetchCalls = (global.fetch as any).mock.calls;
    const deleteCall = fetchCalls.find(
      (call: any[]) => call[0] === '/api/terminals/first-term' && call[1]?.method === 'DELETE'
    );
    expect(deleteCall).toBeDefined();

    expect(localStorage.getItem(STORAGE_KEY)).toBe('respawn-term');
    expect(onTerminalIdChange).toHaveBeenCalledWith('respawn-term');
  });

  it('shows error when network fails during validation instead of creating duplicate', async () => {
    localStorage.setItem(STORAGE_KEY, 'existing-term');
    // Network error on GET /api/terminals
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error')) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByText(/Could not reach server/)).toBeInTheDocument();
    });

    // Should NOT have called POST to create a new terminal
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Should keep the saved ID in localStorage (not clear it)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('existing-term');
  });

  it('guards against double-click on RESPAWN', async () => {
    // No saved ID → POST creates terminal
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'dbl-term', title: 'Research', pid: 1 }),
    }) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-dbl-term')).toBeInTheDocument();
    });

    // Set up a slow response to simulate in-flight request
    let resolveDelete: () => void;
    const deletePromise = new Promise<void>((resolve) => { resolveDelete = resolve; });

    (global.fetch as any)
      .mockImplementationOnce(() => deletePromise.then(() => ({ ok: true })))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'new-dbl-term', title: 'Research', pid: 2 }),
      });

    const respawnBtn = screen.getByText('[RESPAWN]');

    // Double-click
    fireEvent.click(respawnBtn);
    fireEvent.click(respawnBtn);

    // Resolve the DELETE
    await act(async () => { resolveDelete!(); });

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-new-dbl-term')).toBeInTheDocument();
    });

    // Only 1 DELETE + 1 POST should have been called after the initial create (3 total)
    // Initial POST (1) + DELETE old (2) + POST new (3) = 3
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('guards against double-click on NEW TERMINAL button', async () => {
    // No saved ID → POST fails
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Failed' }),
    }) as any;

    const { subscribe } = mockSubscribe();
    render(<ResearchView send={() => {}} subscribe={subscribe} />);

    await waitFor(() => {
      expect(screen.getByText('[NEW TERMINAL]')).toBeInTheDocument();
    });

    // Set up slow POST for double-click test
    let resolvePost: () => void;
    const postPromise = new Promise<void>((resolve) => { resolvePost = resolve; });

    (global.fetch as any)
      .mockImplementationOnce(() => postPromise.then(() => ({
        ok: true,
        json: () => Promise.resolve({ id: 'retry-term', title: 'Research', pid: 3 }),
      })));

    const newBtn = screen.getByText('[NEW TERMINAL]');

    // Double-click
    fireEvent.click(newBtn);
    fireEvent.click(newBtn);

    // Resolve the POST
    await act(async () => { resolvePost!(); });

    await waitFor(() => {
      expect(screen.getByTestId('terminal-view-retry-term')).toBeInTheDocument();
    });

    // Initial failed POST (1) + single retry POST (2) = 2 total
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
