import { useState, useEffect } from 'react';
import type { AgentPreset } from '../types';

const API = '/api';

export function useAgents() {
  const [agents, setAgents] = useState<AgentPreset[]>([]);

  useEffect(() => {
    fetch(`${API}/agents`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch agents');
        return res.json();
      })
      .then(setAgents)
      .catch((err) => console.error('Failed to fetch agents:', err));
  }, []);

  return agents;
}
