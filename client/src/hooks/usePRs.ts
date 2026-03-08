import { useState, useCallback, useEffect, useRef } from 'react';
import type { PullRequest, ServerMessage } from '../types';
import { API_BASE } from '../config';

export function usePRs(subscribe: (handler: (msg: ServerMessage) => void) => () => void, onError?: (message: string) => void) {
  const [prs, setPRs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Store onError in a ref to avoid triggering re-renders and infinite fetch loops
  // when callers pass an unstable callback reference.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fetchPRs = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE}/prs`, { signal });
      if (!res.ok) throw new Error(`Failed to fetch PRs (${res.status})`);
      const data: PullRequest[] = await res.json();
      setPRs(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Failed to fetch PRs:', err);
      onErrorRef.current?.('Failed to fetch PRs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchPRs(controller.signal);
    return () => controller.abort();
  }, [fetchPRs]);

  // Real-time updates
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === 'pr:created') {
        setPRs((prev) => {
          if (prev.some((p) => p.id === msg.pr.id)) return prev;
          return [...prev, msg.pr];
        });
      } else if (msg.type === 'pr:updated') {
        setPRs((prev) =>
          prev.map((p) => (p.id === msg.pr.id ? msg.pr : p))
        );
      }
    });
    return unsub;
  }, [subscribe]);

  const addComment = useCallback(async (prId: string, body: string) => {
    try {
      const res = await fetch(`${API_BASE}/prs/${prId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'human', body }),
      });
      if (!res.ok) throw new Error(`Failed to add comment (${res.status})`);
    } catch (err) {
      console.error('Failed to add comment:', err);
      onErrorRef.current?.('Failed to add comment');
    }
  }, []);

  const setVerdict = useCallback(async (prId: string, verdict: 'approved' | 'changes_requested') => {
    try {
      const res = await fetch(`${API_BASE}/prs/${prId}/verdict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      });
      if (!res.ok) throw new Error(`Failed to set verdict (${res.status})`);
    } catch (err) {
      console.error('Failed to set verdict:', err);
      onErrorRef.current?.('Failed to set verdict');
    }
  }, []);

  const mergePR = useCallback(async (prId: string): Promise<{ error?: string; status?: string; prUrl?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/prs/${prId}/merge`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return { error: data?.error || 'Merge failed' };
      }
      const data = await res.json().catch(() => ({}));
      return { status: data.status, prUrl: data.prUrl };
    } catch (err) {
      console.error('Failed to merge PR:', err);
      return { error: 'Network error' };
    }
  }, []);

  const confirmMerge = useCallback(async (prId: string): Promise<{ error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/prs/${prId}/confirm-merge`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return { error: data?.error || 'Confirm merge failed' };
      }
      return {};
    } catch (err) {
      console.error('Failed to confirm merge:', err);
      return { error: 'Network error' };
    }
  }, []);

  const fixConflicts = useCallback(async (prId: string) => {
    try {
      const res = await fetch(`${API_BASE}/prs/${prId}/fix-conflicts`, { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to fix conflicts (${res.status})`);
    } catch (err) {
      console.error('Failed to fix conflicts:', err);
      onErrorRef.current?.('Failed to fix conflicts');
    }
  }, []);

  const relaunchReview = useCallback(async (prId: string) => {
    try {
      const res = await fetch(`${API_BASE}/prs/${prId}/relaunch-review`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        console.error('Failed to relaunch review:', data?.error || res.statusText);
        onErrorRef.current?.('Failed to relaunch review');
      }
    } catch (err) {
      console.error('Failed to relaunch review:', err);
      onErrorRef.current?.('Failed to relaunch review');
    }
  }, []);

  const closePR = useCallback(async (prId: string): Promise<{ error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/prs/${prId}/close`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return { error: data?.error || 'Failed to close PR' };
      }
      return {};
    } catch (err) {
      console.error('Failed to close PR:', err);
      return { error: 'Network error' };
    }
  }, []);

  const closeAllStalePRs = useCallback(async (): Promise<{ closed: Array<{ id: string; title: string }>; errors: Array<{ id: string; title: string; error: string }> }> => {
    try {
      const res = await fetch(`${API_BASE.replace('/api', '/api/batch')}/close-stale-prs`, { method: 'POST' });
      if (!res.ok) {
        return { closed: [], errors: [{ id: '', title: '', error: 'Request failed' }] };
      }
      return await res.json();
    } catch (err) {
      console.error('Failed to close stale PRs:', err);
      return { closed: [], errors: [{ id: '', title: '', error: 'Network error' }] };
    }
  }, []);

  return { prs, loading, addComment, setVerdict, mergePR, confirmMerge, fixConflicts, relaunchReview, closePR, closeAllStalePRs, refetch: fetchPRs };
}
