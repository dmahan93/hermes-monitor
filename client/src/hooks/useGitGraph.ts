import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../config';

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

  const fetchLog = useCallback(async () => {
    const signal = newAbort(logAbortRef);
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/git/log?limit=80`, { signal });
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
