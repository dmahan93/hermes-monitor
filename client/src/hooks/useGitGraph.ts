import { useState, useEffect, useCallback, useRef } from 'react';

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

export function useGitGraph() {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [graph, setGraph] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
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

  // AbortController refs for cleanup on unmount
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight request and create a new controller
  function newAbort(): AbortSignal {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl.signal;
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const fetchLog = useCallback(async () => {
    const signal = newAbort();
    try {
      setLoading(true);
      const res = await fetch('/api/git/log?limit=80', { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GitLogResponse = await res.json();
      setCommits(data.commits);
      setGraph(data.graph);
      setError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const selectCommit = useCallback(async (sha: string | null) => {
    if (!sha || sha === selectedSha) {
      setSelectedSha(null);
      setFiles([]);
      return;
    }

    setSelectedSha(sha);
    setFilesLoading(true);
    const signal = newAbort();
    try {
      const res = await fetch(`/api/git/show/${sha}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GitShowResponse = await res.json();
      setFiles(data.files);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [selectedSha]);

  const viewDiff = useCallback(async (sha: string, filePath: string) => {
    setDiffLoading(true);
    setDiffFile(filePath);
    setDiffSha(sha);
    const signal = newAbort();
    try {
      const res = await fetch(`/api/git/diff/${sha}?file=${encodeURIComponent(filePath)}`, { signal });
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

  return {
    commits,
    graph,
    loading,
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
  };
}
