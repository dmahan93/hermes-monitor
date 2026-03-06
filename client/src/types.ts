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
  command: string;
  terminalId: string | null;
  branch: string | null;
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
  | { type: 'resize'; terminalId: string; cols: number; rows: number };

export type ServerMessage =
  | { type: 'stdout'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string; exitCode: number }
  | { type: 'error'; terminalId: string; message: string }
  | { type: 'issue:created'; issue: Issue }
  | { type: 'issue:updated'; issue: Issue }
  | { type: 'issue:deleted'; issueId: string };
