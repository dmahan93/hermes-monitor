import { useState, useEffect, useCallback } from 'react';
import type { ModelInfo } from '../types';
import { API_BASE } from '../config';

export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchModels = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE}/models`, { signal });
      if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`);
      const data: ModelInfo[] = await res.json();
      setModels(data);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Failed to fetch models:', err);
      setError('Failed to load models');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchModels(controller.signal);
    return () => controller.abort();
  }, [fetchModels]);

  return { models, loading, error };
}
