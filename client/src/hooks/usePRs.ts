import { useState, useCallback, useEffect } from 'react';
import type { PullRequest, ServerMessage } from '../types';
import { API_BASE } from '../config';

export function usePRs(subscribe: (handler: (msg: ServerMessage) => void) => () => void) {
  const [prs, setPRs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPRs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/prs`);
      const data: PullRequest[] = await res.json();
      setPRs(data);
    } catch (err) {
      console.error('Failed to fetch PRs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPRs();
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
      await fetch(`${API_BASE}/prs/${prId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: 'human', body }),
      });
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  }, []);

  const setVerdict = useCallback(async (prId: string, verdict: 'approved' | 'changes_requested') => {
    try {
      await fetch(`${API_BASE}/prs/${prId}/verdict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      });
    } catch (err) {
      console.error('Failed to set verdict:', err);
    }
  }, []);

  const mergePR = useCallback(async (prId: string): Promise<{ error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/prs/${prId}/merge`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        return { error: data?.error || 'Merge failed' };
      }
      return {};
    } catch (err) {
      console.error('Failed to merge PR:', err);
      return { error: 'Network error' };
    }
  }, []);

  const fixConflicts = useCallback(async (prId: string) => {
    try {
      await fetch(`${API_BASE}/prs/${prId}/fix-conflicts`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to fix conflicts:', err);
    }
  }, []);

  const relaunchReview = useCallback(async (prId: string) => {
    try {
      const res = await fetch(`${API_BASE}/prs/${prId}/relaunch-review`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        console.error('Failed to relaunch review:', data?.error || res.statusText);
      }
    } catch (err) {
      console.error('Failed to relaunch review:', err);
    }
  }, []);

  return { prs, loading, addComment, setVerdict, mergePR, fixConflicts, relaunchReview, refetch: fetchPRs };
}
