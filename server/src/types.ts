// Re-export shared types so existing server imports continue to work.
export type {
  TerminalInfo,
  ClientMessage,
  ServerMessage,
} from '@hermes-monitor/shared/types';

// Server-only type: options for creating a terminal
export interface CreateTerminalOptions {
  title?: string;
  command?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}

