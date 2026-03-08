import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Issue, PullRequest, AgentPreset, IssueStatus, ClientMessage, ServerMessage } from '../types';
import './ManagerView.css';

// ── Types ──

interface ManagerViewProps {
  issues: Issue[];
  prs: PullRequest[];
  agents: AgentPreset[];
  onStatusChange: (id: string, status: IssueStatus) => Promise<string | null>;
  onMerge: (prId: string) => Promise<{ error?: string }>;
  onRelaunchReview: (prId: string) => Promise<void>;
  onViewTerminal: (issueId: string) => void;
  onViewPR: () => void;
  send: (msg: ClientMessage) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;
  reconnectCount: number;
}

// ── Helpers ──

/** Strip ANSI escape codes from terminal output */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[()][AB012]|\x1b\[[\?]?[0-9;]*[hlm]|\r/g, '');
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h${remainMinutes > 0 ? `${remainMinutes}m` : ''}`;
}

function getAgentIcon(agents: AgentPreset[], agentId: string): string {
  const agent = agents.find((a) => a.id === agentId);
  return agent?.icon || '⚙';
}

function getAgentName(agents: AgentPreset[], agentId: string): string {
  const agent = agents.find((a) => a.id === agentId);
  return agent?.name || agentId;
}

type CardStatus = 'working' | 'review' | 'crashed' | 'todo';

function getCardStatus(issue: Issue): CardStatus {
  if (issue.status === 'in_progress' && issue.terminalId) return 'working';
  if (issue.status === 'in_progress' && !issue.terminalId) return 'crashed';
  if (issue.status === 'review') return 'review';
  return 'todo';
}

const PREVIEW_LINES = 3;

// ── Component ──

export function ManagerView({
  issues,
  prs,
  agents,
  onStatusChange,
  onMerge,
  onRelaunchReview,
  onViewTerminal,
  onViewPR,
  send,
  subscribe,
  reconnectCount,
}: ManagerViewProps) {
  const [now, setNow] = useState(Date.now());
  const [terminalPreviews, setTerminalPreviews] = useState<Map<string, string[]>>(new Map());
  const [merging, setMerging] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const replayedRef = useRef<Set<string>>(new Set());

  // Tick every 10s to update elapsed times
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(interval);
  }, []);

  // ── Derived data ──

  const activeIssues = useMemo(
    () => issues.filter((i) => i.status === 'in_progress' || i.status === 'review'),
    [issues],
  );

  const terminalIds = useMemo(
    () => activeIssues.map((i) => i.terminalId).filter(Boolean) as string[],
    [activeIssues],
  );

  // Subscribe to terminal stdout for previews
  useEffect(() => {
    if (terminalIds.length === 0) return;
    const idSet = new Set(terminalIds);
    const unsub = subscribe((msg: ServerMessage) => {
      if (msg.type === 'stdout' && idSet.has(msg.terminalId)) {
        setTerminalPreviews((prev) => {
          const next = new Map(prev);
          const text = stripAnsi(msg.data);
          const newLines = text.split('\n').filter((l) => l.trim().length > 0);
          if (newLines.length === 0) return prev;
          const existing = next.get(msg.terminalId) || [];
          const combined = [...existing, ...newLines].slice(-PREVIEW_LINES);
          next.set(msg.terminalId, combined);
          return next;
        });
      }
    });
    return unsub;
  }, [subscribe, terminalIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear replayed set on reconnect so all terminals get re-replayed
  useEffect(() => {
    replayedRef.current.clear();
  }, [reconnectCount]);

  // Request replay for terminals we haven't replayed yet
  useEffect(() => {
    for (const tid of terminalIds) {
      if (!replayedRef.current.has(tid)) {
        replayedRef.current.add(tid);
        send({ type: 'replay', terminalId: tid });
      }
    }
  }, [terminalIds, send, reconnectCount]);

  // ── Stats ──

  const stats = useMemo(() => {
    const total = issues.filter((i) => i.status !== 'backlog').length;
    const done = issues.filter((i) => i.status === 'done').length;
    const activeAgents = issues.filter((i) => i.status === 'in_progress' && i.terminalId).length;
    const crashedAgents = issues.filter((i) => i.status === 'in_progress' && !i.terminalId).length;
    const prsAwaitingMerge = prs.filter((p) => p.verdict === 'approved' && p.status !== 'merged' && p.status !== 'closed').length;

    // Average review rounds: count PRs with comments from reviewer
    const reviewedPRs = prs.filter((p) => p.comments.length > 0);
    const avgRounds = reviewedPRs.length > 0
      ? (reviewedPRs.reduce((sum, p) => {
          // Count verdicts by looking at comments and status changes
          // Simple heuristic: count unique reviewer comment sets
          return sum + Math.max(1, Math.ceil(p.comments.length / 3));
        }, 0) / reviewedPRs.length).toFixed(1)
      : '—';

    return { total, done, activeAgents, crashedAgents, prsAwaitingMerge, avgRounds };
  }, [issues, prs]);

  // ── PR Review Queue ──

  const reviewQueue = useMemo(
    () => prs.filter((p) =>
      p.status !== 'merged' && p.status !== 'closed' &&
      (p.verdict === 'approved' || p.verdict === 'changes_requested'),
    ),
    [prs],
  );

  const deadReviewers = useMemo(
    () => prs.filter((p) =>
      p.status === 'reviewing' && !p.reviewerTerminalId,
    ),
    [prs],
  );

  // ── Handlers ──

  const handleKill = useCallback(async (issueId: string) => {
    setActionError(null);
    try {
      const err = await onStatusChange(issueId, 'todo');
      if (err) setActionError(err);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }, [onStatusChange]);

  const handleRestart = useCallback(async (issueId: string) => {
    setActionError(null);
    try {
      const err = await onStatusChange(issueId, 'in_progress');
      if (err) setActionError(err);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }, [onStatusChange]);

  const handleMerge = useCallback(async (prId: string) => {
    setMerging((prev) => new Set(prev).add(prId));
    setActionError(null);
    try {
      const result = await onMerge(prId);
      if (result.error) setActionError(result.error);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging((prev) => {
        const next = new Set(prev);
        next.delete(prId);
        return next;
      });
    }
  }, [onMerge]);

  const handleSendBack = useCallback(async (prId: string) => {
    // Find the issue for this PR and move it back to in_progress
    const pr = prs.find((p) => p.id === prId);
    if (!pr) return;
    setActionError(null);
    try {
      const err = await onStatusChange(pr.issueId, 'in_progress');
      if (err) setActionError(err);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }, [prs, onStatusChange]);

  const handleMergeAllApproved = useCallback(async () => {
    setActionError(null);
    setBatchLoading(true);
    try {
      const approved = prs.filter((p) => p.verdict === 'approved' && p.status !== 'merged' && p.status !== 'closed');
      for (const pr of approved) {
        const result = await onMerge(pr.id);
        if (result.error) {
          setActionError(`Failed to merge ${pr.title}: ${result.error}`);
          break;
        }
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchLoading(false);
    }
  }, [prs, onMerge]);

  const handleRestartAllCrashed = useCallback(async () => {
    setActionError(null);
    setBatchLoading(true);
    try {
      const crashed = issues.filter((i) => i.status === 'in_progress' && !i.terminalId);
      for (const issue of crashed) {
        // Move to todo first then back to in_progress to re-trigger spawn
        const err1 = await onStatusChange(issue.id, 'todo');
        if (err1) {
          setActionError(`Failed to restart ${issue.title}: ${err1}`);
          break;
        }
        const err2 = await onStatusChange(issue.id, 'in_progress');
        if (err2) {
          setActionError(`Failed to restart ${issue.title}: ${err2}`);
          break;
        }
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchLoading(false);
    }
  }, [issues, onStatusChange]);

  const handleRelaunchDeadReviewers = useCallback(async () => {
    setActionError(null);
    setBatchLoading(true);
    try {
      for (const pr of deadReviewers) {
        await onRelaunchReview(pr.id);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBatchLoading(false);
    }
  }, [deadReviewers, onRelaunchReview]);

  // ── Render ──

  return (
    <div className="manager-view">
      {/* Stats Bar */}
      <div className="manager-stats">
        <div className="manager-stat">
          <span className="manager-stat-label">TICKETS</span>
          <span className="manager-stat-value">{stats.done}/{stats.total}</span>
        </div>
        <div className="manager-stat">
          <span className="manager-stat-label">ACTIVE</span>
          <span className="manager-stat-value manager-stat-active">{stats.activeAgents}</span>
        </div>
        {stats.crashedAgents > 0 && (
          <div className="manager-stat">
            <span className="manager-stat-label">CRASHED</span>
            <span className="manager-stat-value manager-stat-crashed">{stats.crashedAgents}</span>
          </div>
        )}
        <div className="manager-stat">
          <span className="manager-stat-label">AWAIT MERGE</span>
          <span className="manager-stat-value manager-stat-merge">{stats.prsAwaitingMerge}</span>
        </div>
        <div className="manager-stat">
          <span className="manager-stat-label">AVG ROUNDS</span>
          <span className="manager-stat-value">{stats.avgRounds}</span>
        </div>
      </div>

      {/* Batch Actions */}
      <div className="manager-batch">
        <button
          className="manager-batch-btn manager-batch-merge"
          onClick={handleMergeAllApproved}
          disabled={stats.prsAwaitingMerge === 0 || batchLoading}
          title="Merge all approved PRs"
        >
          ⎇ MERGE ALL APPROVED ({stats.prsAwaitingMerge})
        </button>
        <button
          className="manager-batch-btn manager-batch-restart"
          onClick={handleRestartAllCrashed}
          disabled={stats.crashedAgents === 0 || batchLoading}
          title="Restart all crashed agents"
        >
          ↻ RESTART ALL CRASHED ({stats.crashedAgents})
        </button>
        <button
          className="manager-batch-btn manager-batch-relaunch"
          onClick={handleRelaunchDeadReviewers}
          disabled={deadReviewers.length === 0 || batchLoading}
          title="Relaunch all dead reviewer terminals"
        >
          ⚗ RELAUNCH DEAD REVIEWERS ({deadReviewers.length})
        </button>
      </div>

      {actionError && (
        <div className="manager-error" onClick={() => setActionError(null)}>
          ✗ {actionError}
        </div>
      )}

      {/* Agent Status Dashboard */}
      <div className="manager-section">
        <div className="manager-section-title">AGENT STATUS</div>
        {activeIssues.length === 0 ? (
          <div className="manager-empty">No active agents.</div>
        ) : (
          <div className="manager-grid">
            {activeIssues.map((issue) => {
              const cardStatus = getCardStatus(issue);
              const elapsed = formatElapsed(now - issue.updatedAt);
              const preview = issue.terminalId ? terminalPreviews.get(issue.terminalId) : undefined;
              const pr = prs.find((p) => p.issueId === issue.id);

              return (
                <div key={issue.id} className={`manager-card manager-card-${cardStatus}`}>
                  <div className="manager-card-header">
                    <span className="manager-card-icon">{getAgentIcon(agents, issue.agent)}</span>
                    <span className="manager-card-title" title={issue.title}>
                      {issue.title}
                    </span>
                    <span className={`manager-card-status manager-status-${cardStatus}`}>
                      {cardStatus === 'working' ? '●' : cardStatus === 'review' ? '◎' : cardStatus === 'crashed' ? '✗' : '○'}
                    </span>
                  </div>
                  <div className="manager-card-meta">
                    <span className="manager-card-agent">{getAgentName(agents, issue.agent)}</span>
                    {issue.reviewerModel && (
                      <span className="manager-card-reviewer" title={`Reviewer: ${issue.reviewerModel}`}>
                        ⚖ {issue.reviewerModel.split('/').pop()}
                      </span>
                    )}
                    <span className="manager-card-elapsed">{elapsed}</span>
                  </div>
                  {issue.progressMessage && (
                    <div className="manager-card-progress">
                      {issue.progressPercent != null && `[${issue.progressPercent}%] `}
                      {issue.progressMessage}
                    </div>
                  )}
                  {preview && preview.length > 0 && (
                    <div className="manager-card-preview">
                      {preview.map((line, i) => (
                        <div key={i} className="manager-card-preview-line">
                          {line.length > 80 ? line.slice(0, 80) + '…' : line}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="manager-card-actions">
                    {issue.status === 'in_progress' && (
                      <button
                        className="manager-action manager-action-kill"
                        onClick={() => handleKill(issue.id)}
                        title="Stop agent"
                      >
                        KILL
                      </button>
                    )}
                    {(cardStatus === 'crashed' || issue.status === 'review') && (
                      <button
                        className="manager-action manager-action-restart"
                        onClick={() => handleRestart(issue.id)}
                        title="Restart agent"
                      >
                        RESTART
                      </button>
                    )}
                    {issue.terminalId && (
                      <button
                        className="manager-action manager-action-terminal"
                        onClick={() => onViewTerminal(issue.id)}
                        title="View terminal"
                      >
                        TERMINAL
                      </button>
                    )}
                    {pr && (
                      <button
                        className="manager-action manager-action-pr"
                        onClick={onViewPR}
                        title="View PR"
                      >
                        PR
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* PR Review Queue */}
      <div className="manager-section">
        <div className="manager-section-title">PR REVIEW QUEUE</div>
        {reviewQueue.length === 0 ? (
          <div className="manager-empty">No PRs awaiting action.</div>
        ) : (
          <div className="manager-pr-queue">
            {reviewQueue.map((pr) => {
              const issue = issues.find((i) => i.id === pr.issueId);
              return (
                <div key={pr.id} className={`manager-pr-item manager-pr-${pr.verdict}`}>
                  <div className="manager-pr-info">
                    <span className={`manager-pr-verdict verdict-${pr.verdict}`}>
                      {pr.verdict === 'approved' ? '✓' : '✗'}
                    </span>
                    <span className="manager-pr-title" title={pr.title}>{pr.title}</span>
                    <span className="manager-pr-meta">
                      ⎇ {pr.sourceBranch} · {pr.changedFiles.length} files
                      {issue && <> · {issue.agent}</>}
                    </span>
                  </div>
                  <div className="manager-pr-actions">
                    {pr.verdict === 'approved' && (
                      <button
                        className="manager-action manager-action-merge"
                        onClick={() => handleMerge(pr.id)}
                        disabled={merging.has(pr.id)}
                      >
                        {merging.has(pr.id) ? 'MERGING…' : 'MERGE'}
                      </button>
                    )}
                    {pr.verdict === 'changes_requested' && (
                      <button
                        className="manager-action manager-action-sendback"
                        onClick={() => handleSendBack(pr.id)}
                      >
                        SEND BACK
                      </button>
                    )}
                    <button
                      className="manager-action manager-action-pr"
                      onClick={onViewPR}
                    >
                      VIEW
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
