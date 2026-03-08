import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type {
  TerminalInfo,
  Issue,
  AgentPreset,
  MergeMode,
  PullRequest,
  ClientMessage,
  ServerMessage,
  IssueStatus,
  GridItem,
} from '../types';
import type { ViewMode } from '../routeConstants';
import { VALID_VIEWS, DEFAULT_VIEW } from '../routeConstants';
import { type AgentListSelection, selectionKey } from '../components/AgentTerminalList';
import { API_BASE } from '../config';
import { useWebSocket } from '../hooks/useWebSocket';
import { useTerminals } from '../hooks/useTerminals';
import { useIssues } from '../hooks/useIssues';
import { usePRs } from '../hooks/usePRs';
import { useAgents } from '../hooks/useAgents';
import { useGitGraph, type GitCommit, type GraphNode, type GitFileChange } from '../hooks/useGitGraph';
import { useErrorToast, type ErrorEntry } from '../hooks/useErrorToast';

// ── URL parsing helpers ──

/** Encode a dynamic URL segment safely */
function encodeSegment(s: string): string {
  return encodeURIComponent(s);
}

/** Parse the URL segments after /:repoId/ to derive view and detail IDs */
function parseRouteState(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  // segments[0] = repoId, segments[1] = resource, segments[2] = detail id

  let view: ViewMode = DEFAULT_VIEW;
  let issueId: string | null = null;
  let prId: string | null = null;
  let gitRoute = false;

  const resource = segments[1];

  if (resource === 'issues' && segments[2]) {
    issueId = decodeURIComponent(segments[2]);
    // Issue detail is a modal — underlying view is tracked by returnViewRef
  } else if (resource === 'prs' && segments[2]) {
    view = 'prs';
    prId = decodeURIComponent(segments[2]);
  } else if (resource === 'git') {
    gitRoute = true;
    // git route opens the git panel sidebar, underlying view is kanban
  } else if (resource && (VALID_VIEWS as readonly string[]).includes(resource)) {
    view = resource as ViewMode;
  }

  return { view, issueId, prId, gitRoute };
}

// ── Context value type ──

export interface AppContextValue {
  // WebSocket
  connected: boolean;
  reconnectCount: number;
  send: (msg: ClientMessage) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;

  // Terminals
  terminals: TerminalInfo[];
  layout: GridItem[];
  loading: boolean;
  updateLayout: (newLayout: GridItem[]) => void;

  // Issues
  issues: Issue[];
  updateIssue: (id: string, updates: Partial<Issue>) => Promise<void>;
  createSubtask: (parentId: string, title: string, description?: string, agent?: string, command?: string, branch?: string) => Promise<Issue | null>;

  // PRs
  prs: PullRequest[];
  addComment: (prId: string, body: string) => Promise<void>;
  setVerdict: (prId: string, verdict: 'approved' | 'changes_requested') => Promise<void>;
  mergePR: (prId: string) => Promise<{ error?: string; status?: string; prUrl?: string }>;
  confirmMerge: (prId: string) => Promise<{ error?: string }>;
  fixConflicts: (prId: string) => Promise<void>;
  relaunchReview: (prId: string) => Promise<void>;
  closePR: (prId: string) => Promise<{ error?: string }>;
  closeAllStalePRs: () => Promise<{ closed: Array<{ id: string; title: string }>; errors: Array<{ id: string; title: string; error: string }> }>;
  mergeMode: MergeMode;

  // Agents
  agents: AgentPreset[];
  agentsLoading: boolean;
  agentsError: string | null;

  // Git Graph
  gitGraph: {
    commits: GitCommit[];
    graph: GraphNode[];
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    selectedSha: string | null;
    files: GitFileChange[];
    filesLoading: boolean;
    selectCommit: (sha: string | null) => Promise<void>;
    diffFile: string | null;
    diffContent: string;
    diffLoading: boolean;
    diffSha: string | null;
    viewDiff: (sha: string, filePath: string) => Promise<void>;
    closeDiff: () => void;
    refresh: () => void;
  };

  // View routing (now derived from URL)
  view: ViewMode;
  setView: (mode: ViewMode) => void;
  // TODO: repoId is extracted from the URL but not yet passed to data hooks
  // (useIssues, useTerminals, usePRs, useGitGraph, useAgents). All repos
  // currently share the same backend data. When multi-repo support is added,
  // each hook should accept repoId and include it in API calls.
  repoId: string;

  // Git panel sidebar
  gitPanelOpen: boolean;
  setGitPanelOpen: (open: boolean) => void;

  // Kanban terminal pane
  expandedIssue: Issue | null;
  setExpandedIssueId: (id: string | null) => void;

  // Terminal view sidebar selection
  termViewSelection: AgentListSelection | null;
  setTermViewSelection: Dispatch<SetStateAction<AgentListSelection | null>>;
  termViewAgentIssue: Issue | null;
  handleTermViewSelect: (selection: AgentListSelection) => void;

  // Issue detail modal (now URL-driven)
  detailIssue: Issue | null;
  detailIssueId: string | null;
  setDetailIssueId: (id: string | null) => void;
  detailEditing: boolean;
  setDetailEditing: (editing: boolean) => void;
  detailSubtasks: Issue[];
  detailPR: PullRequest | undefined;
  closeDetail: () => void;

  // PR detail (URL-driven)
  selectedPrId: string | null;
  setSelectedPrId: (id: string | null) => void;

  // Error toasts
  errors: ErrorEntry[];
  addError: (message: string) => string | null;
  removeError: (id: string) => void;

  // Planning pane
  planningIssue: Issue | null;
  setPlanningIssueId: (id: string | null) => void;

  // Input tracking
  awaitingInputIds: Set<string>;

  // Research view
  researchMounted: boolean;
  setResearchTerminalId: (id: string | null) => void;

  // Filtered terminals/layout (research terminal excluded)
  gridTerminals: TerminalInfo[];
  gridLayout: GridItem[];

  // Computed flags
  showTaskTerminal: boolean;
  showPlanning: boolean;

  // Handlers
  handleAddTerminal: () => void;
  handleCloseTerminal: (id: string) => void;
  handleCreateIssue: (title: string, description: string, agent: string, command: string, branch: string, reviewerModel?: string) => void;
  handleStatusChange: (id: string, status: IssueStatus) => Promise<string | null>;
  handleDeleteIssue: (id: string) => Promise<void>;
  handleTerminalClick: (issueId: string) => void;
  handleIssueClick: (issueId: string) => void;
  handleEditIssue: (issueId: string) => void;
  handlePlanClick: (issueId: string) => Promise<void>;
  handlePromote: (issueId: string) => Promise<void>;
  handleStartPlanning: (issueId: string) => Promise<void>;
  handleStopPlanning: (issueId: string) => Promise<void>;
}

// NOTE: This is a single monolithic context. Currently only AppContent consumes
// it, so re-renders are scoped. If child components start using useApp() directly,
// every state change (awaitingInputIds, git graph updates, WS reconnects) will
// trigger re-renders of ALL consumers. When that happens, consider splitting into
// focused contexts (e.g., TerminalContext, IssueContext) or using selector patterns
// (use-context-selector, zustand) to avoid over-rendering.
const AppContext = createContext<AppContextValue | null>(null);

// ── Hook to consume the context ──

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <AppProvider>');
  return ctx;
}

// ── Helper ──

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

// ── Provider ──

export function AppProvider({ children }: { children: ReactNode }) {
  // ── Router hooks ──
  const location = useLocation();
  const navigate = useNavigate();
  const { repoId: rawRepoId } = useParams<{ repoId: string }>();
  const repoId = rawRepoId || 'default';

  // ── Derive view and detail IDs from URL ──
  const { view, issueId: urlIssueId, prId: urlPrId, gitRoute } = useMemo(
    () => parseRouteState(location.pathname),
    [location.pathname],
  );

  // ── Track the "return" view for closing detail modals ──
  // When we navigate to /repo/issues/:id, the URL no longer contains the
  // originating view. This ref remembers the last active view so we can
  // return to it when the detail is closed.
  const returnViewRef = useRef<ViewMode>(view);

  useEffect(() => {
    // Only update returnViewRef when we're on a real view (not issue detail)
    if (!urlIssueId) {
      returnViewRef.current = view;
    }
  }, [view, urlIssueId]);

  // ── Navigation-based setters ──

  // View switches use replace to avoid history pollution (#4).
  // Tab switches are lateral navigation, not forward/back.
  const setView = useCallback((mode: ViewMode) => {
    navigate(`/${encodeSegment(repoId)}/${mode}`, { replace: true });
  }, [navigate, repoId]);

  // Opening detail pushes to history (so back button closes it).
  // Closing detail replaces (returns to view without adding history).
  const setDetailIssueId = useCallback((id: string | null) => {
    if (id) {
      navigate(`/${encodeSegment(repoId)}/issues/${encodeSegment(id)}`);
    } else {
      // Navigate back to the view we came from, not the URL-derived view
      navigate(`/${encodeSegment(repoId)}/${returnViewRef.current}`, { replace: true });
    }
  }, [navigate, repoId]);

  const closeDetail = useCallback(() => {
    setDetailEditing(false);
    // Navigate back to the view we came from (stored in returnViewRef)
    navigate(`/${encodeSegment(repoId)}/${returnViewRef.current}`, { replace: true });
  }, [navigate, repoId]);

  const setSelectedPrId = useCallback((id: string | null) => {
    if (id) {
      navigate(`/${encodeSegment(repoId)}/prs/${encodeSegment(id)}`);
    } else {
      // Clearing PR selection replaces history (lateral navigation)
      navigate(`/${encodeSegment(repoId)}/prs`, { replace: true });
    }
  }, [navigate, repoId]);

  // ── Hook calls ──
  const { connected, reconnectCount, send, subscribe } = useWebSocket(getWsUrl());
  const { errors, addError, removeError } = useErrorToast();
  const { terminals, layout, loading, addTerminal, removeTerminal, updateLayout, refetch: refetchTerminals } = useTerminals(subscribe, addError);
  const { issues = [], createIssue, changeStatus, updateIssue, deleteIssue, startPlanning, stopPlanning, createSubtask } = useIssues(subscribe, addError);
  const { prs = [], addComment, setVerdict, mergePR, confirmMerge, fixConflicts, relaunchReview, closePR, closeAllStalePRs, refetch: refetchPRs } = usePRs(subscribe, addError);
  const { agents, loading: agentsLoading, error: agentsError } = useAgents();
  const [gitPanelOpen, setGitPanelOpen] = useState(() => {
    const stored = localStorage.getItem('hermes:gitPanelOpen');
    return stored !== null ? stored === 'true' : true;
  });
  const gitGraph = useGitGraph({ subscribe, active: gitPanelOpen });
  const [mergeMode, setMergeMode] = useState<MergeMode>('local');
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [termViewSelection, setTermViewSelection] = useState<AgentListSelection | null>(null);
  const [planningIssueId, setPlanningIssueId] = useState<string | null>(null);
  const [detailEditing, setDetailEditing] = useState(false);
  const [awaitingInputIds, setAwaitingInputIds] = useState<Set<string>>(new Set());
  const [researchMounted, setResearchMounted] = useState(false);
  const [researchTerminalId, setResearchTerminalId] = useState<string | null>(
    () => localStorage.getItem('hermes:researchTerminalId'),
  );

  // URL-derived detail IDs
  const detailIssueId = urlIssueId;
  const selectedPrId = urlPrId;

  // ── Side effects ──

  // Open git panel when navigating to /git route
  useEffect(() => {
    if (gitRoute) {
      setGitPanelOpen(true);
    }
  }, [gitRoute]);

  // Persist git panel state
  useEffect(() => {
    localStorage.setItem('hermes:gitPanelOpen', String(gitPanelOpen));
  }, [gitPanelOpen]);

  // Fetch mergeMode from config on mount
  useEffect(() => {
    fetch(`${API_BASE}/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data.mergeMode && ['local', 'github', 'both'].includes(data.mergeMode)) {
          setMergeMode(data.mergeMode);
        }
      })
      .catch(() => {});
  }, []);

  // Listen for config changes from ConfigView (custom event) to keep mergeMode in sync
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mergeMode && ['local', 'github', 'both'].includes(detail.mergeMode)) {
        setMergeMode(detail.mergeMode);
      }
    };
    window.addEventListener('hermes:config-updated', handler);
    return () => window.removeEventListener('hermes:config-updated', handler);
  }, []);

  // Lazy-mount ResearchView
  useEffect(() => {
    if (view === 'research') setResearchMounted(true);
  }, [view]);

  // Track which terminals are awaiting input
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === 'terminal:awaitingInput') {
        setAwaitingInputIds((prev) => {
          const next = new Set(prev);
          if (msg.awaitingInput) {
            next.add(msg.terminalId);
          } else {
            next.delete(msg.terminalId);
          }
          return next;
        });
      }
    });
    return unsub;
  }, [subscribe]);

  // Clear awaiting input state on WS reconnect
  useEffect(() => {
    if (connected) {
      setAwaitingInputIds(new Set());
    }
  }, [connected]);

  // Clean up awaiting input state when terminals are removed
  useEffect(() => {
    const terminalIds = new Set(terminals.map((t) => t.id));
    setAwaitingInputIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (terminalIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [terminals]);

  // Auto-close panes if issue loses its terminal
  const expandedIssue = useMemo(() => {
    if (!expandedIssueId) return null;
    return issues.find((i) => i.id === expandedIssueId) || null;
  }, [expandedIssueId, issues]);

  const prStatusToIssueStatus = useCallback((prStatus: string): 'in_progress' | 'review' | 'done' => {
    switch (prStatus) {
      case 'reviewing': return 'review';
      case 'approved':
      case 'merged':
      case 'closed': return 'done';
      default: return 'in_progress';
    }
  }, []);

  const termViewAgentIssue = useMemo(() => {
    if (!termViewSelection) return null;
    if (termViewSelection.kind === 'agent') {
      return issues.find((i) => i.id === termViewSelection.issueId) || null;
    }
    const pr = prs.find((p) => p.id === termViewSelection.prId);
    if (!pr || !pr.reviewerTerminalId) return null;
    return {
      id: pr.id,
      title: `Review: ${pr.title}`,
      description: '',
      status: prStatusToIssueStatus(pr.status),
      agent: 'hermes-reviewer',
      command: '',
      terminalId: pr.reviewerTerminalId,
      branch: pr.sourceBranch,
      parentId: null,
      reviewerModel: null,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    };
  }, [termViewSelection, issues, prs, prStatusToIssueStatus]);

  const planningIssue = useMemo(() => {
    if (!planningIssueId) return null;
    return issues.find((i) => i.id === planningIssueId) || null;
  }, [planningIssueId, issues]);

  useEffect(() => {
    if (expandedIssue && !expandedIssue.terminalId) {
      setExpandedIssueId(null);
    }
  }, [expandedIssue]);

  useEffect(() => {
    if (termViewAgentIssue && !termViewAgentIssue.terminalId) {
      setTermViewSelection(null);
    }
  }, [termViewAgentIssue]);

  useEffect(() => {
    if (planningIssueId && !planningIssue) {
      setPlanningIssueId(null);
    } else if (planningIssue && planningIssue.status !== 'backlog') {
      setPlanningIssueId(null);
    }
  }, [planningIssueId, planningIssue]);

  useEffect(() => {
    if (termViewSelection && !termViewAgentIssue) {
      setTermViewSelection(null);
    }
  }, [termViewSelection, termViewAgentIssue]);

  // Refetch terminals and PRs when issues change
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === 'issue:updated' || msg.type === 'issue:deleted') {
        setTimeout(() => {
          refetchTerminals();
          refetchPRs();
        }, 300);
      }
      if (msg.type === 'pr:created' || msg.type === 'pr:updated') {
        setTimeout(() => refetchTerminals(), 300);
      }
    });
    return unsub;
  }, [subscribe, refetchTerminals, refetchPRs]);

  // ── Handlers ──

  const handleAddTerminal = useCallback(() => {
    addTerminal();
  }, [addTerminal]);

  const handleCloseTerminal = useCallback((id: string) => {
    removeTerminal(id);
  }, [removeTerminal]);

  const handleCreateIssue = useCallback((title: string, description: string, agent: string, command: string, branch: string, reviewerModel?: string) => {
    createIssue(title, description || undefined, agent || undefined, command || undefined, branch || undefined, reviewerModel || undefined);
  }, [createIssue]);

  const handleStatusChange = useCallback(async (id: string, status: IssueStatus): Promise<string | null> => {
    const error = await changeStatus(id, status);
    refetchTerminals();
    refetchPRs();
    return error;
  }, [changeStatus, refetchTerminals, refetchPRs]);

  const handleDeleteIssue = useCallback(async (id: string) => {
    if (expandedIssueId === id) setExpandedIssueId(null);
    if (planningIssueId === id) setPlanningIssueId(null);
    await deleteIssue(id);
    refetchTerminals();
  }, [deleteIssue, refetchTerminals, expandedIssueId, planningIssueId]);

  const handleTerminalClick = useCallback((issueId: string) => {
    setExpandedIssueId((prev) => prev === issueId ? null : issueId);
  }, []);

  const handleIssueClick = useCallback((issueId: string) => {
    setDetailIssueId(issueId);
    setDetailEditing(false);
  }, [setDetailIssueId]);

  const handleEditIssue = useCallback((issueId: string) => {
    setDetailIssueId(issueId);
    setDetailEditing(true);
  }, [setDetailIssueId]);

  const handlePlanClick = useCallback(async (issueId: string) => {
    const issue = issues.find((i) => i.id === issueId);
    if (!issue) return;
    if (!issue.terminalId) {
      const result = await startPlanning(issueId);
      if (!result) {
        console.warn('Failed to start planning terminal for issue', issueId);
      }
      refetchTerminals();
    }
    setPlanningIssueId(issueId);
  }, [issues, startPlanning, refetchTerminals]);

  const handlePromote = useCallback(async (issueId: string) => {
    await changeStatus(issueId, 'todo');
    setPlanningIssueId(null);
    refetchTerminals();
  }, [changeStatus, refetchTerminals]);

  const handleStartPlanning = useCallback(async (issueId: string) => {
    await startPlanning(issueId);
    refetchTerminals();
  }, [startPlanning, refetchTerminals]);

  const handleStopPlanning = useCallback(async (issueId: string) => {
    await stopPlanning(issueId);
    refetchTerminals();
  }, [stopPlanning, refetchTerminals]);

  const handleTermViewSelect = useCallback((selection: AgentListSelection) => {
    setTermViewSelection((prev) =>
      prev && selectionKey(prev) === selectionKey(selection) ? null : selection,
    );
  }, []);

  // ── Detail pane derived data ──

  const detailIssue = useMemo(() => {
    if (!detailIssueId) return null;
    return issues.find((i) => i.id === detailIssueId) || null;
  }, [detailIssueId, issues]);

  const detailSubtasks = useMemo(() => {
    if (!detailIssueId) return [];
    return issues.filter((i) => i.parentId === detailIssueId);
  }, [detailIssueId, issues]);

  const detailPR = useMemo(() => {
    if (!detailIssueId) return undefined;
    return prs.find((p) => p.issueId === detailIssueId);
  }, [detailIssueId, prs]);

  // ── Filtered terminals/layout (exclude research terminal) ──

  const gridTerminals = useMemo(() => {
    if (!researchTerminalId) return terminals;
    return terminals.filter((t) => t.id !== researchTerminalId);
  }, [terminals, researchTerminalId]);

  const gridLayout = useMemo(() => {
    if (!researchTerminalId) return layout;
    return layout.filter((l) => l.i !== researchTerminalId);
  }, [layout, researchTerminalId]);

  // ── Computed flags ──

  const showTaskTerminal = !!(view === 'kanban' && expandedIssue && expandedIssue.terminalId);
  const showPlanning = !!(view === 'kanban' && planningIssue && planningIssue.status === 'backlog');

  // ── Context value ──

  const value = useMemo<AppContextValue>(() => ({
    // WebSocket
    connected,
    reconnectCount,
    send,
    subscribe,

    // Terminals
    terminals,
    layout,
    loading,
    updateLayout,

    // Issues
    issues,
    updateIssue,
    createSubtask,

    // PRs
    prs,
    addComment,
    setVerdict,
    mergePR,
    confirmMerge,
    fixConflicts,
    relaunchReview,
    closePR,
    closeAllStalePRs,
    mergeMode,

    // Agents
    agents,
    agentsLoading,
    agentsError,

    // Git Graph
    gitGraph,

    // View (URL-derived)
    view,
    setView,
    repoId,

    // Git panel
    gitPanelOpen,
    setGitPanelOpen,

    // Kanban terminal pane
    expandedIssue,
    setExpandedIssueId,

    // Terminal view sidebar
    termViewSelection,
    setTermViewSelection,
    termViewAgentIssue,
    handleTermViewSelect,

    // Issue detail (URL-driven)
    detailIssue,
    detailIssueId,
    setDetailIssueId,
    detailEditing,
    setDetailEditing,
    detailSubtasks,
    detailPR,
    closeDetail,

    // PR detail (URL-driven)
    selectedPrId,
    setSelectedPrId,

    // Error toasts
    errors,
    addError,
    removeError,

    // Planning
    planningIssue,
    setPlanningIssueId,

    // Input tracking
    awaitingInputIds,

    // Research
    researchMounted,
    setResearchTerminalId,

    // Filtered
    gridTerminals,
    gridLayout,

    // Computed
    showTaskTerminal,
    showPlanning,

    // Handlers
    handleAddTerminal,
    handleCloseTerminal,
    handleCreateIssue,
    handleStatusChange,
    handleDeleteIssue,
    handleTerminalClick,
    handleIssueClick,
    handleEditIssue,
    handlePlanClick,
    handlePromote,
    handleStartPlanning,
    handleStopPlanning,
  }), [
    connected, reconnectCount, send, subscribe,
    terminals, layout, loading, updateLayout,
    issues, updateIssue, createSubtask,
    prs, addComment, setVerdict, mergePR, confirmMerge, fixConflicts, relaunchReview, closePR, closeAllStalePRs, mergeMode,
    agents, agentsLoading, agentsError,
    gitGraph,
    view, setView, repoId,
    gitPanelOpen,
    expandedIssue,
    termViewSelection, termViewAgentIssue, handleTermViewSelect,
    detailIssue, detailIssueId, setDetailIssueId, detailEditing, detailSubtasks, detailPR, closeDetail,
    selectedPrId, setSelectedPrId,
    planningIssue,
    awaitingInputIds,
    researchMounted,
    researchTerminalId,
    gridTerminals, gridLayout,
    showTaskTerminal, showPlanning,
    handleAddTerminal, handleCloseTerminal, handleCreateIssue, handleStatusChange,
    handleDeleteIssue, handleTerminalClick, handleIssueClick, handleEditIssue,
    handlePlanClick, handlePromote, handleStartPlanning, handleStopPlanning,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
