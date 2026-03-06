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
  cols?: number;
  rows?: number;
}

// WebSocket messages: client -> server
export type ClientMessage =
  | { type: 'stdin'; terminalId: string; data: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number };

// WebSocket messages: server -> client
export type ServerMessage =
  | { type: 'stdout'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string; exitCode: number }
  | { type: 'error'; terminalId: string; message: string }
  | { type: 'issue:created'; issue: any }
  | { type: 'issue:updated'; issue: any }
  | { type: 'issue:deleted'; issueId: string };
