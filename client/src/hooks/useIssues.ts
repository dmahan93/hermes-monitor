import { useState, useCallback, useEffect, useRef } from 'react';
import type { Issue, IssueStatus, ServerMessage } from '../types';
import { API_BASE } from '../config';

export function useIssues(subscribe: (handler: (msg: ServerMessage) => void) => () => void, onError?: (message: string) => void) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  // Store onError in a ref to avoid triggering re-renders and infinite fetch loops
  // when callers pass an unstable callback reference.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fetchIssues = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE}/issues`, { signal });
      if (!res.ok) throw new Error(`Failed to fetch issues (${res.status})`);
      const data: Issue[] = await res.json();
      setIssues(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Failed to fetch issues:', err);
      onErrorRef.current?.('Failed to fetch issues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchIssues(controller.signal);
    return () => controller.abort();
  }, [fetchIssues]);

  // Subscribe to real-time issue updates
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === 'issue:created') {
        // Deduplicate: only add if not already present (might have been added optimistically)
        setIssues((prev) => {
          if (prev.some((i) => i.id === msg.issue.id)) {
            // Update in place in case server changed anything
            return prev.map((i) => (i.id === msg.issue.id ? msg.issue : i));
          }
          return [...prev, msg.issue];
        });
      } else if (msg.type === 'issue:updated') {
        setIssues((prev) =>
          prev.map((i) => (i.id === msg.issue.id ? msg.issue : i))
        );
      } else if (msg.type === 'issue:progress') {
        setIssues((prev) =>
          prev.map((i) =>
            i.id === msg.issueId
              ? { ...i, progressMessage: msg.message, progressPercent: msg.percent, progressUpdatedAt: Date.now() }
              : i
          )
        );
      } else if (msg.type === 'issue:deleted') {
        setIssues((prev) => prev.filter((i) => i.id !== msg.issueId));
      }
    });
    return unsub;
  }, [subscribe]);

  const createIssue = useCallback(async (title: string, description?: string, agent?: string, command?: string, branch?: string, reviewerModel?: string) => {
    try {
      const res = await fetch(`${API_BASE}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, agent, command, branch, reviewerModel }),
      });
      if (!res.ok) throw new Error(`Failed to create issue (${res.status})`);
      const issue = await res.json();
      // Optimistically add the issue immediately (WS event will deduplicate)
      setIssues((prev) => {
        if (prev.some((i) => i.id === issue.id)) return prev;
        return [...prev, issue];
      });
      return issue;
    } catch (err) {
      console.error('Failed to create issue:', err);
      onErrorRef.current?.('Failed to create issue');
      return null;
    }
  }, []);

  const updateIssue = useCallback(async (id: string, updates: Partial<Issue>) => {
    try {
      const res = await fetch(`${API_BASE}/issues/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`Failed to update issue (${res.status})`);
    } catch (err) {
      console.error('Failed to update issue:', err);
      onErrorRef.current?.('Failed to update issue');
    }
  }, []);

  // changeStatus communicates errors via its return value (callers display inline errors),
  // so we intentionally do NOT call onErrorRef here to avoid double-displaying errors.
  const changeStatus = useCallback(async (id: string, status: IssueStatus): Promise<string | null> => {
    // Optimistic update
    setIssues((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status } : i))
    );
    try {
      const res = await fetch(`${API_BASE}/issues/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        // Server rejected the status change — revert optimistic update
        const body = await res.json().catch(() => ({ error: 'Status change failed' }));
        fetchIssues();
        return body.error || 'Status change failed';
      }
      return null;
    } catch (err) {
      console.error('Failed to change issue status:', err);
      // Revert on failure — refetch
      fetchIssues();
      return 'Network error — failed to change status';
    }
  }, [fetchIssues]);

  const deleteIssue = useCallback(async (id: string) => {
    // Optimistic removal — also cascade-remove subtasks to match server behavior
    setIssues((prev) => prev.filter((i) => i.id !== id && i.parentId !== id));
    try {
      const res = await fetch(`${API_BASE}/issues/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        // Server rejected deletion — throw to trigger catch block's refetch
        throw new Error(`Failed to delete issue (${res.status})`);
      }
    } catch (err) {
      console.error('Failed to delete issue:', err);
      onErrorRef.current?.('Failed to delete issue');
      // Revert on failure — refetch
      fetchIssues();
    }
  }, [fetchIssues]);

  const startPlanning = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/issues/${id}/plan`, { method: 'POST' });
      if (!res.ok) {
        onErrorRef.current?.('Failed to start planning');
        return null;
      }
      const issue = await res.json();
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? issue : i)));
      return issue;
    } catch (err) {
      console.error('Failed to start planning:', err);
      onErrorRef.current?.('Failed to start planning');
      return null;
    }
  }, []);

  const stopPlanning = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/issues/${id}/plan`, { method: 'DELETE' });
      if (!res.ok) {
        onErrorRef.current?.('Failed to stop planning');
        return null;
      }
      const issue = await res.json();
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? issue : i)));
      return issue;
    } catch (err) {
      console.error('Failed to stop planning:', err);
      onErrorRef.current?.('Failed to stop planning');
      return null;
    }
  }, []);

  const createSubtask = useCallback(async (parentId: string, title: string, description?: string, agent?: string, command?: string, branch?: string) => {
    try {
      const res = await fetch(`${API_BASE}/issues/${parentId}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, agent, command, branch }),
      });
      if (!res.ok) {
        onErrorRef.current?.('Failed to create subtask');
        return null;
      }
      const issue = await res.json();
      // Optimistically add the subtask immediately (WS event will deduplicate)
      setIssues((prev) => {
        if (prev.some((i) => i.id === issue.id)) return prev;
        return [...prev, issue];
      });
      return issue;
    } catch (err) {
      console.error('Failed to create subtask:', err);
      onErrorRef.current?.('Failed to create subtask');
      return null;
    }
  }, []);

  return { issues, loading, createIssue, updateIssue, changeStatus, deleteIssue, startPlanning, stopPlanning, createSubtask };
}
