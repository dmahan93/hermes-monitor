import { useState } from 'react';
import type { Issue, AgentPreset, PullRequest } from '../types';
import './AgentTerminalList.css';

export type AgentListFilter = 'all' | 'agents' | 'reviewers';

export type AgentListSelection =
  | { kind: 'agent'; issueId: string }
  | { kind: 'reviewer'; prId: string };

/** Derive a comparable key from a selection for toggle/equality checks */
export const selectionKey = (s: AgentListSelection): string =>
  s.kind === 'agent' ? `agent:${s.issueId}` : `reviewer:${s.prId}`;

interface AgentTerminalListProps {
  issues: Issue[];
  prs: PullRequest[];
  agents: AgentPreset[];
  activeTerminalId: string | null;
  onSelect: (selection: AgentListSelection) => void;
}

const FILTERS: { id: AgentListFilter; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'agents', label: 'AGENTS' },
  { id: 'reviewers', label: 'REVIEWERS' },
];

export function AgentTerminalList({ issues, prs, agents, activeTerminalId, onSelect }: AgentTerminalListProps) {
  const [filter, setFilter] = useState<AgentListFilter>('all');

  // Only show issues where the agent is actively running (in_progress).
  // Issues in 'review' or 'done' may retain a stale terminalId but the agent has finished.
  const activeIssues = issues.filter((i) => i.terminalId && i.status === 'in_progress');
  // Only show PRs where a reviewer or conflict-fixer is actively running.
  // 'reviewing' = review agent running; 'open' = conflict-fixer agent running.
  // Completed statuses (approved, changes_requested, merged, closed) are filtered out.
  const activeReviewers = prs.filter(
    (p) => p.reviewerTerminalId && (p.status === 'reviewing' || p.status === 'open'),
  );

  const showAgents = filter === 'all' || filter === 'agents';
  const showReviewers = filter === 'all' || filter === 'reviewers';

  const hasItems = (showAgents && activeIssues.length > 0) || (showReviewers && activeReviewers.length > 0);

  return (
    <div className="agent-list">
      <div className="agent-list-header">
        <span>TERMINALS</span>
        <div className="agent-list-tabs" role="tablist" aria-label="Terminal filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`agent-list-tab ${filter === f.id ? 'agent-list-tab-active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {!hasItems ? (
        <div className="agent-list-empty">
          {filter === 'agents' && 'No agents running.'}
          {filter === 'reviewers' && 'No reviewers running.'}
          {filter === 'all' && 'No agents or reviewers running.'}
        </div>
      ) : (
        <div className="agent-list-items">
          {showAgents && activeIssues.map((issue) => {
            const agent = agents.find((a) => a.id === issue.agent);
            const isActive = activeTerminalId === issue.terminalId;
            return (
              <button
                key={issue.id}
                className={`agent-list-item ${isActive ? 'agent-list-item-active' : ''}`}
                onClick={() => onSelect({ kind: 'agent', issueId: issue.id })}
              >
                <span className="agent-list-icon">{agent?.icon || '▸'}</span>
                <div className="agent-list-item-info">
                  <span className="agent-list-item-title">{issue.title}</span>
                  <span className="agent-list-item-meta">
                    {issue.status} · {issue.branch || 'no branch'}
                  </span>
                </div>
                <span className="agent-list-status">▸</span>
              </button>
            );
          })}
          {showReviewers && activeReviewers.map((pr) => {
            const isActive = activeTerminalId === pr.reviewerTerminalId;
            return (
              <button
                key={`review-${pr.id}`}
                className={`agent-list-item ${isActive ? 'agent-list-item-active' : ''}`}
                onClick={() => onSelect({ kind: 'reviewer', prId: pr.id })}
              >
                <span className="agent-list-icon">⚖</span>
                <div className="agent-list-item-info">
                  <span className="agent-list-item-title">{pr.title}</span>
                  <span className="agent-list-item-meta">
                    {pr.status} · {pr.sourceBranch}
                  </span>
                </div>
                <span className="agent-list-status agent-list-status-reviewer">⚖</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
