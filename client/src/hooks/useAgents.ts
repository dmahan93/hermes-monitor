import { useState, useEffect } from 'react';
import type { AgentPreset } from '../types';
import { API_BASE } from '../config';

export function useAgents() {
  const [agents, setAgents] = useState<AgentPreset[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/agents`)
      .then((res) => res.json())
      .then(setAgents)
      .catch((err) => console.error('Failed to fetch agents:', err));
  }, []);

  return agents;
}
