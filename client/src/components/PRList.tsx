import { useState, useMemo } from 'react';
import { PRDetail } from './PRDetail';
import type { PullRequest } from '../types';

type PRView = 'open' | 'closed' | 'all';

interface PRListProps {
  prs: PullRequest[];
  onComment: (prId: string, body: string) => void;
  onVerdict: (prId: string, verdict: 'approved' | 'changes_requested') => void;
  onMerge: (prId: string) => Promise<{ error?: string }>;
  onFixConflicts: (prId: string) => void;
  onRelaunchReview: (prId: string) => void;
}

const STATUS_ICONS: Record<string, string> = {
  open: '○',
  reviewing: '⚗',
  approved: '✓',
  changes_requested: '✗',
  merged: '⎇',
  closed: '—',
};

const VIEWS: { id: PRView; label: string }[] = [
  { id: 'open', label: 'OPEN' },
  { id: 'closed', label: 'CLOSED' },
  { id: 'all', label: 'ALL' },
];

const VIEW_LABELS: Record<PRView, string> = {
  open: 'open',
  closed: 'closed',
  all: '',
};

export function filterPRs(prs: PullRequest[], view: PRView): PullRequest[] {
  switch (view) {
    case 'open':
      return prs.filter((pr) => pr.status !== 'merged' && pr.status !== 'closed');
    case 'closed':
      return prs.filter((pr) => pr.status === 'merged' || pr.status === 'closed');
    case 'all':
      return prs;
  }
}

export function PRList({ prs, onComment, onVerdict, onMerge, onFixConflicts, onRelaunchReview }: PRListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<PRView>('open');

  const counts = useMemo(() => {
    const result = {} as Record<PRView, number>;
    for (const v of VIEWS) result[v.id] = filterPRs(prs, v.id).length;
    return result;
  }, [prs]);

  const filtered = useMemo(() => filterPRs(prs, view), [prs, view]);

  const selectedPR = selectedId ? prs.find((p) => p.id === selectedId) : null;

  if (selectedPR) {
    return (
      <PRDetail
        pr={selectedPR}
        onBack={() => setSelectedId(null)}
        onComment={onComment}
        onVerdict={onVerdict}
        onMerge={onMerge}
        onFixConflicts={onFixConflicts}
        onRelaunchReview={onRelaunchReview}
      />
    );
  }

  return (
    <div className="pr-list">
      <div className="pr-list-header">
        <span className="pr-list-title">PULL REQUESTS</span>
        <span className="pr-list-count">{filtered.length}</span>
      </div>
      <div className="pr-view-tabs">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`pr-view-tab ${view === v.id ? 'pr-view-tab-active' : ''}`}
            onClick={() => setView(v.id)}
          >
            {v.label} <span className="pr-view-tab-count">{counts[v.id]}</span>
          </button>
        ))}
      </div>
      {prs.length === 0 ? (
        <div className="pr-list-empty">
          No pull requests yet.<br />
          Move an issue to <span className="accent">REVIEW</span> to create one.
        </div>
      ) : filtered.length === 0 ? (
        <div className="pr-list-empty">
          No {VIEW_LABELS[view]} pull requests.
        </div>
      ) : (
        <div className="pr-list-items">
          {filtered.map((pr) => (
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
