import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_BASE } from '../config';
import type { ServerMessage } from '../types';

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
  refs: string[];
}

export interface GraphNode {
  hash: string;
  col: number;
  lines: GraphLine[];
  isHead: boolean;
}

export interface GraphLine {
  fromCol: number;
  toCol: number;
  type: 'straight' | 'merge-left' | 'merge-right' | 'branch-left' | 'branch-right';
}

export interface GitFileChange {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';
  additions: number;
  deletions: number;
}

interface GitLogResponse {
  commits: GitCommit[];
  graph: GraphNode[];
}

interface GitShowResponse {
  sha: string;
  files: GitFileChange[];
}

interface GitDiffResponse {
  sha: string;
  file: string | null;
  diff: string;
}

/** Polling interval for background git log refresh (ms). */
const POLL_INTERVAL_MS = 30_000;

export interface UseGitGraphOptions {
  /** WS subscribe function for event-driven refreshes. */
  subscribe?: (handler: (msg: ServerMessage) => void) => () => void;
  /** Whether the git panel is currently visible/active. */
  active?: boolean;
}

export function useGitGraph(options?: UseGitGraphOptions) {
  const { subscribe, active = true } = options ?? {};

  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [graph, setGraph] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected commit state
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [files, setFiles] = useState<GitFileChange[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // Diff state
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffSha, setDiffSha] = useState<string | null>(null);

  // Separate AbortController refs for each independent concern
  // (log, files, diff) so they don't cancel each other's in-flight requests.
  const logAbortRef = useRef<AbortController | null>(null);
  const filesAbortRef = useRef<AbortController | null>(null);
  const diffAbortRef = useRef<AbortController | null>(null);

  // Create a new AbortController for a specific concern, cancelling any
  // previous in-flight request for that same concern.
  function newAbort(ref: React.MutableRefObject<AbortController | null>): AbortSignal {
    ref.current?.abort();
    const ctrl = new AbortController();
    ref.current = ctrl;
    return ctrl.signal;
  }

  // Ref for deselect comparison — avoids putting selectedSha in dependency arrays
  const selectedShaRef = useRef(selectedSha);
  selectedShaRef.current = selectedSha;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      logAbortRef.current?.abort();
      filesAbortRef.current?.abort();
      diffAbortRef.current?.abort();
    };
  }, []);

  const fetchLog = useCallback(async (background = false) => {
    const signal = newAbort(logAbortRef);
    let aborted = false;
    try {
      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const res = await fetch(`${API_BASE}/git/log?limit=80`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GitLogResponse = await res.json();
      setCommits(data.commits);
      setGraph(data.graph);
      setError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') { aborted = true; return; }
      if (!background) {
        setError(err.message);
      }
    } finally {
      if (!aborted) {
        if (background) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  // Polling: refetch every 30s when the panel is active
  useEffect(() => {
    if (!active) return;

    const id = setInterval(() => {
      fetchLog(true);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [active, fetchLog]);

  // Debounced timer for WS-triggered refreshes.  A single ref ensures rapid
  // events (e.g. bulk merge) coalesce into one fetch instead of firing many
  // abort-restart cycles, and the timer is always cleaned up on unmount.
  const wsRefreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // WS-triggered refresh: refetch on pr:updated (merged) and issue:updated (done)
  useEffect(() => {
    if (!subscribe) return;

    const unsub = subscribe((msg) => {
      if (msg.type === 'pr:updated' && msg.pr.status === 'merged') {
        clearTimeout(wsRefreshTimer.current);
        wsRefreshTimer.current = setTimeout(() => fetchLog(true), 500);
      } else if (msg.type === 'issue:updated' && msg.issue.status === 'done') {
        clearTimeout(wsRefreshTimer.current);
        wsRefreshTimer.current = setTimeout(() => fetchLog(true), 500);
      }
    });

    return () => {
      unsub();
      clearTimeout(wsRefreshTimer.current);
    };
  }, [subscribe, fetchLog]);

  // Manual refresh callback (background, no full loading state)
  const refresh = useCallback(() => {
    fetchLog(true);
  }, [fetchLog]);

  const selectCommit = useCallback(async (sha: string | null) => {
    if (!sha || sha === selectedShaRef.current) {
      setSelectedSha(null);
      setFiles([]);
      return;
    }

    setSelectedSha(sha);
    setFilesLoading(true);
    const signal = newAbort(filesAbortRef);
    try {
      const res = await fetch(`${API_BASE}/git/show/${sha}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GitShowResponse = await res.json();
      setFiles(data.files);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  const viewDiff = useCallback(async (sha: string, filePath: string) => {
    setDiffLoading(true);
    setDiffFile(filePath);
    setDiffSha(sha);
    const signal = newAbort(diffAbortRef);
    try {
      const res = await fetch(`${API_BASE}/git/diff/${sha}?file=${encodeURIComponent(filePath)}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GitDiffResponse = await res.json();
      setDiffContent(data.diff);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setDiffContent('Failed to load diff');
    } finally {
      setDiffLoading(false);
    }
  }, []);

  const closeDiff = useCallback(() => {
    setDiffFile(null);
    setDiffContent('');
    setDiffSha(null);
  }, []);

  return useMemo(() => ({
    commits,
    graph,
    loading,
    refreshing,
    error,
    selectedSha,
    files,
    filesLoading,
    selectCommit,
    diffFile,
    diffContent,
    diffLoading,
    diffSha,
    viewDiff,
    closeDiff,
    refetch: fetchLog,
    refresh,
  }), [
    commits, graph, loading, refreshing, error,
    selectedSha, files, filesLoading, selectCommit,
    diffFile, diffContent, diffLoading, diffSha,
    viewDiff, closeDiff, fetchLog, refresh,
  ]);
}
