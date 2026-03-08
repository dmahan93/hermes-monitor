import { useState, useEffect, useCallback } from 'react';
import type { ModelInfo } from '../types';
import { API_BASE } from '../config';

/** Module-level cache so multiple components sharing useModels() don't duplicate requests. */
let cachedModels: ModelInfo[] | null = null;
let cachePromise: Promise<ModelInfo[]> | null = null;

async function fetchModelsOnce(signal?: AbortSignal): Promise<ModelInfo[]> {
  if (cachedModels) return cachedModels;
  if (!cachePromise) {
    cachePromise = fetch(`${API_BASE}/models`, { signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch models (${res.status})`);
        return res.json() as Promise<ModelInfo[]>;
      })
      .then((data) => {
        cachedModels = data;
        return data;
      })
      .catch((err) => {
        cachePromise = null; // allow retry on failure
        throw err;
      });
  }
  return cachePromise;
}

export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>(cachedModels || []);
  const [loading, setLoading] = useState(!cachedModels);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchModelsOnce(signal);
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
    if (cachedModels) {
      setModels(cachedModels);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    doFetch(controller.signal);
    return () => controller.abort();
  }, [doFetch]);

  return { models, loading, error };
}
