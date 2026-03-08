import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgents } from '../../src/hooks/useAgents';
import { API_BASE } from '../../src/config';

const mockAgent = {
  id: 'agent-1',
  name: 'Hermes',
  icon: '🔮',
  command: 'hermes-agent',
  planningCommand: 'hermes-agent --plan',
  description: 'A test agent',
  installed: true,
};

describe('useAgents', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches agents on mount', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([mockAgent]),
    }) as any;

    const { result } = renderHook(() => useAgents());

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.agents).toHaveLength(1);
    });

    expect(result.current.agents[0].id).toBe('agent-1');
    expect(result.current.agents[0].name).toBe('Hermes');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/agents`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  // --- Error-path tests ---

  it('stays as empty array when fetch returns non-ok and sets error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    }) as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAgents());

    // Give time for the fetch promise chain to resolve
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    expect(result.current.agents).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Failed to fetch agents (500)');
    expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch agents:', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('stays as empty array on network error and sets error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAgents());

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    expect(result.current.agents).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Network error');
    expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch agents:', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('error message includes status code', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: 'Forbidden' }),
    }) as any;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useAgents());

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    const errorArg = consoleSpy.mock.calls[0][1] as Error;
    expect(errorArg.message).toContain('403');
    consoleSpy.mockRestore();
  });
});
