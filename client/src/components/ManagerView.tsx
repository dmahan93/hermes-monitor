import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TerminalView } from './TerminalView';
import type { Issue, PullRequest, AgentPreset, IssueStatus, ClientMessage, ServerMessage } from '../types';
import { API_BASE } from '../config';
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

const MANAGER_TERMINAL_STORAGE_KEY = 'hermes:managerTerminalId';
const MANAGER_TERMINAL_HEIGHT_KEY = 'hermes:managerTerminalHeight';
const DEFAULT_TERMINAL_HEIGHT = 320;
const MIN_TERMINAL_HEIGHT = 120;
const MAX_TERMINAL_HEIGHT = 800;

const MANAGER_TERMINAL_COMMAND =
  'bash -c \'echo "=== Hermes Monitor Manager ==="; echo "See MANAGER.md for commands"; echo ""; exec bash\'';

const DEFAULT_PORT = 4000;

// Shell command templates — port is replaced dynamically at call time via withPort()
const STATUS_COMMAND_TEMPLATE =
  'echo "=== ISSUES ===" && curl -s localhost:__PORT__/api/issues | python3 -c "\nimport json,sys; issues=json.loads(sys.stdin.read(),strict=False)\ndone=len([i for i in issues if i[\'status\']==\'done\'])\nactive=[i for i in issues if i[\'status\'] not in (\'done\',)]\nprint(f\'Score: {done}/{len(issues)}, {len(active)} active\')\nfor i in active: print(f\'  [{i[\"status\"]:12}] {i[\"title\"][:55]}\')\n" && echo "" && echo "=== PRs ===" && curl -s localhost:__PORT__/api/prs | python3 -c "\nimport json,sys; [print(f\'  {p[\"id\"][:8]} [{p[\"status\"]:18}] {p[\"verdict\"]:18} {p[\"title\"][:50]}\')\nfor p in json.loads(sys.stdin.read(),strict=False)\nif p[\'status\'] not in (\'merged\',)]\n" && echo "" && echo "=== TERMINALS ===" && curl -s localhost:__PORT__/api/terminals | python3 -c "\nimport json,sys; terms=json.loads(sys.stdin.read())\nprint(f\'{len(terms)} alive\')\nfor t in terms: print(f\'  {t[\"title\"][:55]}\')\n"\n';

const MERGE_ALL_COMMAND_TEMPLATE =
  'curl -s localhost:__PORT__/api/prs | python3 -c "import json,sys; [print(p[\'id\']) for p in json.loads(sys.stdin.read(),strict=False) if p[\'verdict\']==\'approved\' and p[\'status\'] not in (\'merged\',\'closed\')]" | while read id; do echo "Merging $id..."; curl -s -X POST "localhost:__PORT__/api/prs/$id/merge"; echo ""; done\n';

const RESTART_CRASHED_COMMAND_TEMPLATE =
  'curl -s localhost:__PORT__/api/issues | python3 -c "import json,sys; [print(i[\'id\']) for i in json.loads(sys.stdin.read(),strict=False) if i[\'status\']==\'in_progress\' and not i.get(\'terminalId\')]" | while read id; do echo "Restarting $id..."; curl -s -X PATCH "localhost:__PORT__/api/issues/$id/status" -H \'Content-Type: application/json\' -d \'{\\"status\\":\\"todo\\"}\'; curl -s -X PATCH "localhost:__PORT__/api/issues/$id/status" -H \'Content-Type: application/json\' -d \'{\\"status\\":\\"in_progress\\"}\'; echo ""; done\n';


function withPort(template: string, port: number): string {
  return template.replace(/__PORT__/g, String(port));
}
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

  // ── Manager Terminal State ──
  const [managerTerminalId, setManagerTerminalId] = useState<string | null>(null);
  const [managerTerminalOpen, setManagerTerminalOpen] = useState(false);
  const [managerTerminalLoading, setManagerTerminalLoading] = useState(false);
  const [managerTerminalError, setManagerTerminalError] = useState<string | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const saved = localStorage.getItem(MANAGER_TERMINAL_HEIGHT_KEY);
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isNaN(parsed) ? DEFAULT_TERMINAL_HEIGHT : Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, parsed));
  });
  const managerInitRef = useRef(false);
  const managerCreatingRef = useRef(false);
  const serverPortRef = useRef(DEFAULT_PORT);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ y: 0, height: 0 });
  const terminalHeightRef = useRef(terminalHeight);
  const resizeListenersRef = useRef<{ move: ((e: MouseEvent) => void) | null; up: (() => void) | null }>({ move: null, up: null });

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

  // ── Manager Terminal Helpers ──

  /** Fetch /config and update serverPortRef. Returns config or null on failure. */
  const fetchServerConfig = useCallback(async (): Promise<{ repoPath?: string; serverPort?: number } | null> => {
    try {
      const configRes = await fetch(`${API_BASE}/config`);
      if (configRes.ok) {
        const cfg = await configRes.json();
        if (cfg.serverPort) {
          serverPortRef.current = cfg.serverPort;
        }
        return cfg;
      }
    } catch {
      // Config fetch failure is non-fatal — port stays at default
    }
    return null;
  }, []);

  const validateManagerTerminal = useCallback(async (id: string): Promise<boolean> => {
    const res = await fetch(`${API_BASE}/terminals`);
    if (!res.ok) throw new Error('Failed to fetch terminals');
    const terminals = await res.json();
    return terminals.some((t: { id: string }) => t.id === id);
  }, []);

  const createManagerTerminal = useCallback(async (): Promise<string | null> => {
    try {
      // Fetch config for repoPath (serverPort already updated by fetchServerConfig in init)
      let cwd: string | undefined;
      try {
        const cfg = await fetchServerConfig();
        cwd = cfg?.repoPath;
      } catch {
        // If config fetch fails, create terminal without cwd
      }

      const res = await fetch(`${API_BASE}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Manager Terminal',
          command: MANAGER_TERMINAL_COMMAND,
          ...(cwd ? { cwd } : {}),
        }),
      });
      if (!res.ok) throw new Error('Failed to create terminal');
      const term = await res.json();
      return term.id;
    } catch (err: any) {
      setManagerTerminalError(err.message || 'Failed to create manager terminal');
      return null;
    }
  }, [fetchServerConfig]);

  // Initialize or restore manager terminal when first opened
  const initManagerTerminal = useCallback(async () => {
    if (managerInitRef.current || managerCreatingRef.current) return;
    managerCreatingRef.current = true;
    setManagerTerminalLoading(true);
    setManagerTerminalError(null);

    try {
      // Always fetch config first so serverPortRef is current on both
      // the restore path and the create path
      await fetchServerConfig();

      // Try to restore from localStorage
      const savedId = localStorage.getItem(MANAGER_TERMINAL_STORAGE_KEY);
      if (savedId) {
        try {
          const exists = await validateManagerTerminal(savedId);
          if (exists) {
            setManagerTerminalId(savedId);
            managerInitRef.current = true;
            setManagerTerminalLoading(false);
            managerCreatingRef.current = false;
            return;
          }
        } catch {
          // Network error — don't create a duplicate
          setManagerTerminalError('Could not reach server to validate terminal.');
          setManagerTerminalLoading(false);
          managerCreatingRef.current = false;
          return;
        }
        // Stale — clear it
        localStorage.removeItem(MANAGER_TERMINAL_STORAGE_KEY);
      }

      // Create a new one
      const newId = await createManagerTerminal();
      if (newId) {
        localStorage.setItem(MANAGER_TERMINAL_STORAGE_KEY, newId);
        setManagerTerminalId(newId);
        managerInitRef.current = true;
      }
    } finally {
      setManagerTerminalLoading(false);
      managerCreatingRef.current = false;
    }
  }, [fetchServerConfig, validateManagerTerminal, createManagerTerminal]);

  // Listen for terminal removal
  useEffect(() => {
    if (!managerTerminalId) return;
    const unsub = subscribe((msg) => {
      if (msg.type === 'terminal:removed' && msg.terminalId === managerTerminalId) {
        localStorage.removeItem(MANAGER_TERMINAL_STORAGE_KEY);
        setManagerTerminalId(null);
        managerInitRef.current = false;
      }
    });
    return unsub;
  }, [managerTerminalId, subscribe]);

  // Toggle terminal open/closed
  const handleToggleTerminal = useCallback(() => {
    setManagerTerminalOpen((prev) => !prev);
  }, []);

  // Initialize on first open — separated from state updater per React contract
  useEffect(() => {
    if (managerTerminalOpen && !managerInitRef.current) {
      initManagerTerminal();
    }
  }, [managerTerminalOpen, initManagerTerminal]);

  // Send a command string to the terminal via WS stdin
  const sendToTerminal = useCallback((command: string) => {
    if (!managerTerminalId) return;
    send({ type: 'stdin', terminalId: managerTerminalId, data: command });
  }, [managerTerminalId, send]);

  // Keep terminalHeightRef in sync for use in resize handler
  useEffect(() => {
    terminalHeightRef.current = terminalHeight;
  }, [terminalHeight]);

  // ── Resize Handlers ──

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    resizeStartRef.current = { y: e.clientY, height: terminalHeightRef.current };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingRef.current) return;
      // Dragging up increases height (y decreases)
      const delta = resizeStartRef.current.y - moveEvent.clientY;
      const newHeight = Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, resizeStartRef.current.height + delta));
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      resizingRef.current = false;
      // Persist height directly — no side effect in state updater
      localStorage.setItem(MANAGER_TERMINAL_HEIGHT_KEY, String(terminalHeightRef.current));
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      resizeListenersRef.current = { move: null, up: null };
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    resizeListenersRef.current = { move: handleMouseMove, up: handleMouseUp };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Clean up resize listeners if component unmounts mid-drag
  useEffect(() => {
    return () => {
      const { move, up } = resizeListenersRef.current;
      if (move) document.removeEventListener('mousemove', move);
      if (up) document.removeEventListener('mouseup', up);
      resizingRef.current = false;
    };
  }, []);

  // ── Render ──

  return (
    <div className="manager-view">
      {/* Scrollable dashboard content */}
      <div className="manager-content">
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

      {/* Manager Terminal Section */}
      <div className="manager-terminal-section">
        {/* Toggle bar */}
        <button
          className="manager-terminal-toggle"
          onClick={handleToggleTerminal}
        >
          <span className="manager-terminal-toggle-icon">
            {managerTerminalOpen ? '▾' : '▸'}
          </span>
          <span className="manager-terminal-toggle-label">MANAGER TERMINAL</span>
          {managerTerminalLoading && (
            <span className="manager-terminal-toggle-status">spawning…</span>
          )}
        </button>

        {managerTerminalOpen && (
          <>
            {/* Resize Handle */}
            <div
              className="manager-terminal-resize-handle"
              onMouseDown={handleResizeStart}
              title="Drag to resize"
            />

            {/* Quick Actions Toolbar */}
            <div className="manager-terminal-toolbar">
              <button
                className="manager-terminal-action"
                onClick={() => sendToTerminal(withPort(STATUS_COMMAND_TEMPLATE, serverPortRef.current))}
                disabled={!managerTerminalId}
                title="Check status of all issues, PRs, and terminals"
              >
                ◉ CHECK STATUS
              </button>
              <button
                className="manager-terminal-action"
                onClick={() => sendToTerminal(withPort(MERGE_ALL_COMMAND_TEMPLATE, serverPortRef.current))}
                disabled={!managerTerminalId}
                title="Merge all approved PRs via CLI"
              >
                ⎇ MERGE ALL
              </button>
              <button
                className="manager-terminal-action"
                onClick={() => sendToTerminal(withPort(RESTART_CRASHED_COMMAND_TEMPLATE, serverPortRef.current))}
                disabled={!managerTerminalId}
                title="Restart all crashed agents via CLI"
              >
                ↻ RESTART CRASHED
              </button>
            </div>

            {/* Terminal Pane */}
            <div className="manager-terminal-pane" style={{ height: terminalHeight }}>
              {managerTerminalLoading && (
                <div className="manager-terminal-loading">Spawning manager terminal…</div>
              )}
              {managerTerminalError && (
                <div className="manager-terminal-error">
                  <span>{managerTerminalError}</span>
                  <button
                    className="manager-terminal-retry"
                    onClick={() => { managerInitRef.current = false; initManagerTerminal(); }}
                  >
                    [RETRY]
                  </button>
                </div>
              )}
              {managerTerminalId && !managerTerminalLoading && (
                <TerminalView
                  terminalId={managerTerminalId}
                  send={send}
                  subscribe={subscribe}
                  reconnectCount={reconnectCount}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
