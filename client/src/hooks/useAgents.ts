import { useState, useEffect } from 'react';
import type { AgentPreset } from '../types';
import { API_BASE } from '../config';

export function useAgents() {
  const [agents, setAgents] = useState<AgentPreset[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchAgents = async () => {
      try {
        const res = await fetch(`${API_BASE}/agents`, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to fetch agents (${res.status})`);
        const data: AgentPreset[] = await res.json();
        setAgents(data);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to fetch agents:', err);
      }
    };
    fetchAgents();
    return () => controller.abort();
  }, []);

  return agents;
}
