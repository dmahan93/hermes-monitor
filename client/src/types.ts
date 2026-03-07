// Re-export shared types so existing client imports continue to work.
export type {
  TerminalInfo,
  IssueStatus,
  Issue,
  AgentPreset,
  PRStatus,
  Verdict,
  PRComment,
  Screenshot,
  PullRequest,
  ClientMessage,
  ServerMessage,
} from '@hermes-monitor/shared/types';

// ── Client-only types ──

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

import type { IssueStatus } from '@hermes-monitor/shared/types';

export const COLUMNS: { id: IssueStatus; label: string }[] = [
  { id: 'todo', label: 'TODO' },
  { id: 'in_progress', label: 'IN PROGRESS' },
  { id: 'review', label: 'REVIEW' },
  { id: 'done', label: 'DONE' },
];
