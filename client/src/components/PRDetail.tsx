import { useState, useEffect } from 'react';
import { DiffViewer } from './DiffViewer';
import { MarkdownContent, ImageWithZoom } from './MarkdownContent';
import type { PullRequest, IssueStatus } from '../types';

interface Screenshot {
  filename: string;
  url: string;
}

interface PRDetailProps {
  pr: PullRequest;
  issueStatus?: IssueStatus;
  onBack: () => void;
  onComment: (prId: string, body: string) => void;
  onVerdict: (prId: string, verdict: 'approved' | 'changes_requested') => void;
  onMerge: (prId: string) => Promise<{ error?: string }>;
  onFixConflicts: (prId: string) => void;
  onRelaunchReview: (prId: string) => void;
  onMoveToInProgress: (issueId: string) => Promise<void>;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  open: { label: 'OPEN', className: 'status-open' },
  reviewing: { label: '⚗ REVIEWING', className: 'status-reviewing' },
  approved: { label: '✓ APPROVED', className: 'status-approved' },
  changes_requested: { label: '✗ CHANGES REQUESTED', className: 'status-changes' },
  merged: { label: '⎇ MERGED', className: 'status-merged' },
  closed: { label: 'CLOSED', className: 'status-closed' },
};

export function PRDetail({ pr, issueStatus, onBack, onComment, onVerdict, onMerge, onFixConflicts, onRelaunchReview, onMoveToInProgress }: PRDetailProps) {
  const [comment, setComment] = useState('');
  const [mergeCheck, setMergeCheck] = useState<{ checking: boolean; canMerge: boolean; hasConflicts: boolean }>({
    checking: true, canMerge: false, hasConflicts: false,
  });
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const status = STATUS_LABELS[pr.status] || STATUS_LABELS.open;

  // Fetch screenshots for this PR
  useEffect(() => {
    fetch(`/api/prs/${pr.id}/screenshots`)
      .then((res) => res.json())
      .then((data) => {
        setScreenshots(data.screenshots || []);
      })
      .catch(() => {
        setScreenshots([]);
      });
  }, [pr.id]);

  // Check merge status on open
  useEffect(() => {
    if (pr.status === 'merged' || pr.status === 'closed') {
      setMergeCheck({ checking: false, canMerge: false, hasConflicts: false });
      return;
    }
    setMergeCheck({ checking: true, canMerge: false, hasConflicts: false });
    fetch(`/api/prs/${pr.id}/merge-check`)
      .then((res) => res.json())
      .then((data) => {
        setMergeCheck({ checking: false, canMerge: data.canMerge, hasConflicts: data.hasConflicts });
      })
      .catch(() => {
        setMergeCheck({ checking: false, canMerge: false, hasConflicts: false });
      });
  }, [pr.id, pr.status]);

  const handleComment = () => {
    if (!comment.trim()) return;
    onComment(pr.id, comment.trim());
    setComment('');
  };

  return (
    <div className="pr-detail">
      <div className="pr-detail-header">
        <button className="pr-back-btn" onClick={onBack}>[← BACK]</button>
        <div className="pr-detail-title-row">
          <h2 className="pr-detail-title">{pr.title}</h2>
          <span className={`pr-status-badge ${status.className}`}>{status.label}</span>
        </div>
        <div className="pr-detail-meta">
          <span>⎇ {pr.sourceBranch} → {pr.targetBranch}</span>
          <span>{pr.changedFiles.length} file{pr.changedFiles.length !== 1 ? 's' : ''} changed</span>
        </div>
        {pr.description && (
          <MarkdownContent text={pr.description} className="pr-detail-desc" />
        )}
      </div>

      {screenshots.length > 0 && (
        <div className="pr-section">
          <h3 className="pr-section-title">SCREENSHOTS ({screenshots.length})</h3>
          <div className="pr-screenshot-gallery">
            {screenshots.map((s) => (
              <ImageWithZoom
                key={s.filename}
                src={s.url}
                alt={s.filename.replace(/\.[^.]+$/, '').replace(/[-_][a-f0-9]{8}$/, '').replace(/[-_]/g, ' ')}
                showCaption={true}
              />
            ))}
          </div>
        </div>
      )}

      <div className="pr-detail-actions">
        {pr.status !== 'merged' && pr.status !== 'closed' && (
          <>
            <button
              className="pr-action-btn pr-approve-btn"
              onClick={() => onVerdict(pr.id, 'approved')}
            >
              [✓ APPROVE]
            </button>
            <button
              className="pr-action-btn pr-reject-btn"
              onClick={() => onVerdict(pr.id, 'changes_requested')}
            >
              [✗ REQUEST CHANGES]
            </button>
            <button
              className="pr-action-btn pr-relaunch-btn"
              onClick={() => onRelaunchReview(pr.id)}
            >
              [⟳ RELAUNCH REVIEW]
            </button>
            {issueStatus === 'review' && (
              <button
                className="pr-action-btn pr-inprogress-btn"
                onClick={async () => { await onMoveToInProgress(pr.issueId); onBack(); }}
              >
                [← BACK TO IN PROGRESS]
              </button>
            )}
            {mergeCheck.checking ? (
              <span className="pr-merge-checking">checking merge…</span>
            ) : mergeCheck.hasConflicts ? (
              <button
                className="pr-action-btn pr-fix-btn"
                onClick={() => onFixConflicts(pr.id)}
              >
                [🔧 FIX CONFLICTS]
              </button>
            ) : pr.verdict === 'approved' ? (
              <button
                className="pr-action-btn pr-merge-btn"
                onClick={async () => {
                  setMergeError(null);
                  const result = await onMerge(pr.id);
                  if (result.error) setMergeError(result.error);
                }}
              >
                [⎇ MERGE]
              </button>
            ) : null}
          </>
        )}
        {mergeError && (
          <div className="pr-merge-error">
            {mergeError}
            {mergeError.includes('onflict') && (
              <button
                className="pr-action-btn pr-fix-btn"
                onClick={() => { setMergeError(null); onFixConflicts(pr.id); }}
                style={{ marginLeft: 8 }}
              >
                [🔧 FIX CONFLICTS]
              </button>
            )}
          </div>
        )}
      </div>

      <div className="pr-section">
        <h3 className="pr-section-title">DIFF</h3>
        <DiffViewer diff={pr.diff} />
      </div>

      <div className="pr-section">
        <h3 className="pr-section-title">REVIEW ({pr.comments.length})</h3>
        <div className="pr-comments">
          {pr.comments.map((c) => (
            <div key={c.id} className={`pr-comment ${c.author === 'hermes-reviewer' ? 'pr-comment-bot' : 'pr-comment-human'}`}>
              <div className="pr-comment-header">
                <span className="pr-comment-author">
                  {c.author === 'hermes-reviewer' ? '⚗ hermes-reviewer' : '👤 ' + c.author}
                </span>
                <span className="pr-comment-time">
                  {new Date(c.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="pr-comment-body">
                <MarkdownContent text={c.body} />
              </div>
            </div>
          ))}
          {pr.comments.length === 0 && (
            <div className="pr-no-comments">No reviews yet.</div>
          )}
        </div>

        <div className="pr-comment-form">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a review comment..."
            rows={3}
          />
          <button
            className="pr-action-btn"
            onClick={handleComment}
            disabled={!comment.trim()}
          >
            [POST COMMENT]
          </button>
        </div>
      </div>
    </div>
  );
}
