import { useState, useMemo } from 'react';
import { PRDetail } from './PRDetail';
import type { PullRequest, Issue, MergeMode } from '../types';
import { useConfirm } from '../hooks/useConfirm';
import './PRList.css';

type PRView = 'open' | 'closed' | 'all';

interface PRListProps {
  prs: PullRequest[];
  issues: Issue[];
  mergeMode?: MergeMode;
  onComment: (prId: string, body: string) => void;
  onVerdict: (prId: string, verdict: 'approved' | 'changes_requested') => void;
  onMerge: (prId: string) => Promise<{ error?: string; status?: string; prUrl?: string }>;
  onConfirmMerge: (prId: string) => Promise<{ error?: string }>;
  onFixConflicts: (prId: string) => void;
  onRelaunchReview: (prId: string) => void;
  onClosePR: (prId: string) => Promise<{ error?: string }>;
  onCloseAllStale?: () => Promise<{ closed: Array<{ id: string; title: string }>; errors: Array<{ id: string; title: string; error: string }> }>;
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

export function PRList({ prs = [], issues, mergeMode = 'local', onComment, onVerdict, onMerge, onConfirmMerge, onFixConflicts, onRelaunchReview, onClosePR, onCloseAllStale, onMoveToInProgress }: PRListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<PRView>('open');
  const [closingAll, setClosingAll] = useState(false);
  const { confirm, ConfirmDialogElement } = useConfirm();

  const counts = useMemo(() => {
    const result = {} as Record<PRView, number>;
    for (const v of VIEWS) result[v.id] = filterPRs(prs, v.id).length;
    return result;
  }, [prs]);

  const filtered = useMemo(() => filterPRs(prs, view), [prs, view]);

  // Count stale PRs: open PRs whose linked issue is done or missing
  const stalePRCount = useMemo(() => {
    return prs.filter((pr) => {
      if (pr.status === 'merged' || pr.status === 'closed') return false;
      const issue = issues.find((i) => i.id === pr.issueId);
      return !issue || issue.status === 'done';
    }).length;
  }, [prs, issues]);

  const selectedPR = selectedId ? prs.find((p) => p.id === selectedId) : null;
  const selectedIssue = selectedPR ? issues.find((i) => i.id === selectedPR.issueId) : null;

  const handleClosePR = async (e: React.MouseEvent, prId: string, prTitle: string) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: 'CLOSE PR',
      message: `Close this PR? It will be marked as closed.\n\n"${prTitle}"`,
      confirmText: '[CLOSE]',
      variant: 'warning',
    });
    if (!confirmed) return;
    await onClosePR(prId);
  };

  const handleCloseAllStale = async () => {
    if (!onCloseAllStale || closingAll) return;
    const confirmed = await confirm({
      title: 'CLOSE STALE PRS',
      message: `Close all ${stalePRCount} stale PR${stalePRCount !== 1 ? 's' : ''}? These are open PRs whose linked issue is already done or deleted.`,
      confirmText: '[CLOSE ALL]',
      variant: 'warning',
    });
    if (!confirmed) return;
    setClosingAll(true);
    try {
      await onCloseAllStale();
    } finally {
      setClosingAll(false);
    }
  };

  if (selectedPR) {
    return (
      <PRDetail
        pr={selectedPR}
        issueStatus={selectedIssue?.status}
        mergeMode={mergeMode}
        onBack={() => setSelectedId(null)}
        onComment={onComment}
        onVerdict={onVerdict}
        onMerge={onMerge}
        onConfirmMerge={onConfirmMerge}
        onFixConflicts={onFixConflicts}
        onRelaunchReview={onRelaunchReview}
        onClosePR={onClosePR}
        onMoveToInProgress={onMoveToInProgress}
      />
    );
  }

  return (
    <div className="pr-list">
      {ConfirmDialogElement}
      <div className="pr-list-header">
        <div className="pr-list-header-left">
          <span className="pr-list-title">PULL REQUESTS</span>
          <span className="pr-list-count">{filtered.length}</span>
        </div>
        {onCloseAllStale && stalePRCount > 0 && (
          <button
            className="pr-close-stale-btn"
            onClick={handleCloseAllStale}
            disabled={closingAll}
            title={`Close ${stalePRCount} stale PR${stalePRCount !== 1 ? 's' : ''} (linked issue done or deleted)`}
          >
            {closingAll ? '[× CLOSING…]' : `[× CLOSE ${stalePRCount} STALE]`}
          </button>
        )}
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
                  {(pr.screenshotCount ?? 0) > 0 && (
                    <> · 📷 {pr.screenshotCount}</>
                  )}
                  {pr.githubPrUrl && (
                    <> · 🐙 GitHub</>
                  )}
                </span>
              </div>
              <span className={`pr-list-verdict verdict-${pr.verdict}`}>
                {pr.verdict === 'approved' ? '✓' : pr.verdict === 'changes_requested' ? '✗' : '…'}
              </span>
              {pr.status !== 'merged' && pr.status !== 'closed' && (
                <span
                  className="pr-list-close-btn"
                  role="button"
                  aria-label={`Close PR: ${pr.title}`}
                  onClick={(e) => handleClosePR(e, pr.id, pr.title)}
                  title="Close PR"
                >
                  ×
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
