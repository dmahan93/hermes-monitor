import { useState, useCallback, useEffect } from 'react';
import type { Issue, IssueStatus, ServerMessage } from '../types';

const API = '/api';

export function useIssues(subscribe: (handler: (msg: ServerMessage) => void) => () => void) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchIssues = useCallback(async () => {
    try {
      const res = await fetch(`${API}/issues`);
      const data: Issue[] = await res.json();
      setIssues(data);
    } catch (err) {
      console.error('Failed to fetch issues:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIssues();
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
      } else if (msg.type === 'issue:deleted') {
        setIssues((prev) => prev.filter((i) => i.id !== msg.issueId));
      }
    });
    return unsub;
  }, [subscribe]);

  const createIssue = useCallback(async (title: string, description?: string, agent?: string, command?: string, branch?: string) => {
    try {
      const res = await fetch(`${API}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, agent, command, branch }),
      });
      const issue = await res.json();
      // Optimistically add the issue immediately (WS event will deduplicate)
      setIssues((prev) => {
        if (prev.some((i) => i.id === issue.id)) return prev;
        return [...prev, issue];
      });
      return issue;
    } catch (err) {
      console.error('Failed to create issue:', err);
      return null;
    }
  }, []);

  const updateIssue = useCallback(async (id: string, updates: Partial<Issue>) => {
    try {
      await fetch(`${API}/issues/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch (err) {
      console.error('Failed to update issue:', err);
    }
  }, []);

  const changeStatus = useCallback(async (id: string, status: IssueStatus) => {
    // Optimistic update
    setIssues((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status } : i))
    );
    try {
      await fetch(`${API}/issues/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      console.error('Failed to change issue status:', err);
      // Revert on failure — refetch
      fetchIssues();
    }
  }, [fetchIssues]);

  const deleteIssue = useCallback(async (id: string) => {
    // Optimistic removal
    setIssues((prev) => prev.filter((i) => i.id !== id));
    try {
      await fetch(`${API}/issues/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete issue:', err);
      fetchIssues();
    }
  }, [fetchIssues]);

  const startPlanning = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API}/issues/${id}/plan`, { method: 'POST' });
      if (!res.ok) return null;
      const issue = await res.json();
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? issue : i)));
      return issue;
    } catch (err) {
      console.error('Failed to start planning:', err);
      return null;
    }
  }, []);

  const stopPlanning = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API}/issues/${id}/plan`, { method: 'DELETE' });
      if (!res.ok) return null;
      const issue = await res.json();
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? issue : i)));
      return issue;
    } catch (err) {
      console.error('Failed to stop planning:', err);
      return null;
    }
  }, []);

  return { issues, loading, createIssue, updateIssue, changeStatus, deleteIssue, startPlanning, stopPlanning };
}
