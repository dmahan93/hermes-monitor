import type { Issue } from './issue-manager.js';
import type { PullRequest } from './pr-manager.js';

export interface TerminalInfo {
  id: string;
  title: string;
  command: string;
  cols: number;
  rows: number;
  pid: number;
  createdAt: number;
}

export interface CreateTerminalOptions {
  title?: string;
  command?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

// WebSocket messages: client -> server
export type ClientMessage =
  | { type: 'stdin'; terminalId: string; data: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number }
  | { type: 'replay'; terminalId: string };

// WebSocket messages: server -> client
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
