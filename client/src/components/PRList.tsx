import { useState } from 'react';
import { PRDetail } from './PRDetail';
import type { PullRequest, Issue } from '../types';

interface PRListProps {
  prs: PullRequest[];
  issues: Issue[];
  onComment: (prId: string, body: string) => void;
  onVerdict: (prId: string, verdict: 'approved' | 'changes_requested') => void;
  onMerge: (prId: string) => void;
  onRelaunchReview: (prId: string) => void;
  onMoveToInProgress: (issueId: string) => Promise<void>;
}

const STATUS_ICONS: Record<string, string> = {
  open: '○',
  reviewing: '⚗',
  approved: '✓',
  changes_requested: '✗',
  merged: '⎇',
  closed: '—',
};

export function PRList({ prs, issues, onComment, onVerdict, onMerge, onRelaunchReview, onMoveToInProgress }: PRListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedPR = selectedId ? prs.find((p) => p.id === selectedId) : null;
  const selectedIssue = selectedPR ? issues.find((i) => i.id === selectedPR.issueId) : null;

  if (selectedPR) {
    return (
      <PRDetail
        pr={selectedPR}
        issueStatus={selectedIssue?.status}
        onBack={() => setSelectedId(null)}
        onComment={onComment}
        onVerdict={onVerdict}
        onMerge={onMerge}
        onRelaunchReview={onRelaunchReview}
        onMoveToInProgress={onMoveToInProgress}
      />
    );
  }

  return (
    <div className="pr-list">
      <div className="pr-list-header">
        <span className="pr-list-title">PULL REQUESTS</span>
        <span className="pr-list-count">{prs.length}</span>
      </div>
      {prs.length === 0 ? (
        <div className="pr-list-empty">
          No pull requests yet.<br />
          Move an issue to <span className="accent">REVIEW</span> to create one.
        </div>
      ) : (
        <div className="pr-list-items">
          {prs.map((pr) => (
            <button
              key={pr.id}
              className="pr-list-item"
              onClick={() => setSelectedId(pr.id)}
            >
              <span className={`pr-list-icon status-${pr.status}`}>
                {STATUS_ICONS[pr.status] || '○'}
              </span>
              <div className="pr-list-item-info">
                <span className="pr-list-item-title">{pr.title}</span>
                <span className="pr-list-item-meta">
                  ⎇ {pr.sourceBranch} · {pr.changedFiles.length} files · {pr.comments.length} comments
                </span>
              </div>
              <span className={`pr-list-verdict verdict-${pr.verdict}`}>
                {pr.verdict === 'approved' ? '✓' : pr.verdict === 'changes_requested' ? '✗' : '…'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
