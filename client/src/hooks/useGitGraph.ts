import { useState, useEffect, useCallback } from 'react';

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

  const fetchLog = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/git/log?limit=80');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GitLogResponse = await res.json();
      setCommits(data.commits);
      setGraph(data.graph);
      setError(null);
    } catch (err: any) {
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
    try {
      const res = await fetch(`/api/git/show/${sha}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GitShowResponse = await res.json();
      setFiles(data.files);
    } catch {
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [selectedSha]);

  const viewDiff = useCallback(async (sha: string, filePath: string) => {
    setDiffLoading(true);
    setDiffFile(filePath);
    setDiffSha(sha);
    try {
      const res = await fetch(`/api/git/diff/${sha}?file=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GitDiffResponse = await res.json();
      setDiffContent(data.diff);
    } catch {
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
