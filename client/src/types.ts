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

// WebSocket messages
export type ClientMessage =
  | { type: 'stdin'; terminalId: string; data: string }
  | { type: 'resize'; terminalId: string; cols: number; rows: number };

export type ServerMessage =
  | { type: 'stdout'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string; exitCode: number }
  | { type: 'error'; terminalId: string; message: string };
