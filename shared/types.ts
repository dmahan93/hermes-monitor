// ── Shared type definitions for hermes-monitor ──
// Single source of truth imported by both server and client.

// ── Terminal ──

export interface TerminalInfo {
  id: string;
  title: string;
  command: string;
  cols: number;
  rows: number;
  pid: number;
  createdAt: number;
}

// ── Issues ──

export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  agent: string;        // agent preset id
  command: string;       // resolved command (from preset or custom)
  terminalId: string | null;
  branch: string | null;
  parentId: string | null;  // if set, this issue is a subtask of the parent
  submitterNotes?: string;  // transient: notes from agent when submitting for review
  progressMessage?: string | null;   // transient: agent progress status (not persisted)
  progressPercent?: number | null;   // transient: agent progress 0-100 (not persisted)
  progressUpdatedAt?: number | null; // transient: when progress was last reported
  screenshotBypassReason?: string;  // transient: why screenshots were bypassed (auto-detected or agent-provided)
  createdAt: number;
  updatedAt: number;
}

// ── Agents ──

export interface AgentPreset {
  id: string;
  name: string;
  icon: string;
  command: string;          // template with {{var}} placeholders (execution)
  planningCommand: string;  // template for interactive planning sessions
  description: string;
  installed?: boolean;      // populated at runtime
}

// ── Config ──

export type MergeMode = 'local' | 'github' | 'both';

// ── Pull Requests ──

export type PRStatus = 'open' | 'reviewing' | 'approved' | 'changes_requested' | 'merged' | 'closed';
export type Verdict = 'pending' | 'approved' | 'changes_requested';

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
  screenshotBypassReason?: string;  // why screenshots were bypassed (auto-detected or agent-provided)
  sourceBranch: string;
  targetBranch: string;
  repoPath: string;
  status: PRStatus;
  diff: string;
  changedFiles: string[];
  verdict: Verdict;
  reviewerTerminalId: string | null;
  comments: PRComment[];
  githubPrUrl?: string;
  screenshots?: Screenshot[];
  screenshotCount?: number;
  createdAt: number;
  updatedAt: number;
}

// ── WebSocket messages ──

// Client → Server
export type ClientMessage =
  | { type: 'stdin'; terminalId: string; data: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number }
  | { type: 'replay'; terminalId: string };

// Server → Client
export type ServerMessage =
  | { type: 'stdout'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string; exitCode: number }
  | { type: 'terminal:created'; terminal: TerminalInfo }
  | { type: 'terminal:removed'; terminalId: string }
  | { type: 'error'; terminalId: string; message: string }
  | { type: 'terminal:awaitingInput'; terminalId: string; awaitingInput: boolean }
  | { type: 'issue:created'; issue: Issue }
  | { type: 'issue:updated'; issue: Issue }
  | { type: 'issue:deleted'; issueId: string }
  | { type: 'issue:progress'; issueId: string; message: string | null; percent: number | null }
  | { type: 'pr:created'; pr: PullRequest }
  | { type: 'pr:updated'; pr: PullRequest };
