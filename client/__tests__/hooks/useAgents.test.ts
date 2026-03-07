import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAgents } from '../../src/hooks/useAgents';
import { API_BASE } from '../../src/config';

const mockAgent = {
  id: 'agent-1',
  name: 'Test Agent',
  icon: '🤖',
  command: 'echo hello',
  planningCommand: 'echo plan',
  description: 'A test agent',
  installed: true,
};

describe('useAgents', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches agents on mount', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([mockAgent]),
    }) as any;

    const { result } = renderHook(() => useAgents());

    await waitFor(() => {
      expect(result.current).toHaveLength(1);
    });

    expect(result.current[0].id).toBe('agent-1');
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/agents`);
  });

  it('returns empty array on fetch error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAgents());

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    expect(result.current).toEqual([]);
    consoleSpy.mockRestore();
  });
});
