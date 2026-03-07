export interface TerminalInfo {
  id: string;
  title: string;
  command: string;
  cols: number;
  rows: number;
  pid: number;
  createdAt: number;
}

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Issue types
export type IssueStatus = 'todo' | 'in_progress' | 'review' | 'done';

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  agent: string;
  command: string;
  terminalId: string | null;
  branch: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentPreset {
  id: string;
  name: string;
  icon: string;
  command: string;
  description: string;
  installed?: boolean;
}

// PR types
export type PRStatus = 'open' | 'reviewing' | 'approved' | 'changes_requested' | 'merged' | 'closed';

export interface PRComment {
  id: string;
  prId: string;
  author: string;
  body: string;
  file?: string;
  line?: number;
  createdAt: number;
}

export interface Screenshot {
  filename: string;
  url: string;
}

export interface PullRequest {
  id: string;
  issueId: string;
  title: string;
  description: string;
  submitterNotes: string;
  sourceBranch: string;
  targetBranch: string;
  repoPath: string;
  status: PRStatus;
  diff: string;
  changedFiles: string[];
  verdict: string;
  reviewerTerminalId: string | null;
  comments: PRComment[];
  screenshots?: Screenshot[];
  screenshotCount?: number;
  createdAt: number;
  updatedAt: number;
}

export const COLUMNS: { id: IssueStatus; label: string }[] = [
  { id: 'todo', label: 'TODO' },
  { id: 'in_progress', label: 'IN PROGRESS' },
  { id: 'review', label: 'REVIEW' },
  { id: 'done', label: 'DONE' },
];

// WebSocket messages
export type ClientMessage =
  | { type: 'stdin'; terminalId: string; data: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number }
  | { type: 'replay'; terminalId: string };

export type ServerMessage =
  | { type: 'stdout'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string; exitCode: number }
  | { type: 'terminal:removed'; terminalId: string }
  | { type: 'error'; terminalId: string; message: string }
  | { type: 'terminal:awaitingInput'; terminalId: string; awaitingInput: boolean }
  | { type: 'issue:created'; issue: Issue }
  | { type: 'issue:updated'; issue: Issue }
  | { type: 'issue:deleted'; issueId: string }
  | { type: 'pr:created'; pr: PullRequest }
  | { type: 'pr:updated'; pr: PullRequest };
