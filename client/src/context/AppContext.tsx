import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  TerminalInfo,
  Issue,
  AgentPreset,
  PullRequest,
  ClientMessage,
  ServerMessage,
  IssueStatus,
  GridItem,
} from '../types';
import type { ViewMode } from '../components/ViewSwitcher';
import { type AgentListSelection, selectionKey } from '../components/AgentTerminalList';
import { useWebSocket } from '../hooks/useWebSocket';
import { useTerminals } from '../hooks/useTerminals';
import { useIssues } from '../hooks/useIssues';
import { usePRs } from '../hooks/usePRs';
import { useAgents } from '../hooks/useAgents';
import { useGitGraph, type GitCommit, type GraphNode, type GitFileChange } from '../hooks/useGitGraph';
import { useErrorToast, type ErrorEntry } from '../hooks/useErrorToast';

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
  mergePR: (prId: string) => Promise<{ error?: string }>;
  fixConflicts: (prId: string) => Promise<void>;
  relaunchReview: (prId: string) => Promise<void>;

  // Agents
  agents: AgentPreset[];

  // Git Graph
  gitGraph: {
    commits: GitCommit[];
    graph: GraphNode[];
    loading: boolean;
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
  };

  // View routing
  view: ViewMode;
  setView: (mode: ViewMode) => void;

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

  // Issue detail modal
  detailIssue: Issue | null;
  detailIssueId: string | null;
  setDetailIssueId: (id: string | null) => void;
  detailEditing: boolean;
  setDetailEditing: (editing: boolean) => void;
  detailSubtasks: Issue[];
  detailPR: PullRequest | undefined;
  closeDetail: () => void;

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
  handleCreateIssue: (title: string, description: string, agent: string, command: string, branch: string) => void;
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
  // ── Hook calls ──
  const { connected, reconnectCount, send, subscribe } = useWebSocket(getWsUrl());
  const { errors, addError, removeError } = useErrorToast();
  const { terminals, layout, loading, addTerminal, removeTerminal, updateLayout, refetch: refetchTerminals } = useTerminals(subscribe, addError);
  const { issues = [], createIssue, changeStatus, updateIssue, deleteIssue, startPlanning, stopPlanning, createSubtask } = useIssues(subscribe, addError);
  const { prs = [], addComment, setVerdict, mergePR, fixConflicts, relaunchReview, refetch: refetchPRs } = usePRs(subscribe, addError);
  const agents = useAgents();
  const gitGraph = useGitGraph();

  // ── Local state ──
  const [gitPanelOpen, setGitPanelOpen] = useState(() => {
    const stored = localStorage.getItem('hermes:gitPanelOpen');
    return stored !== null ? stored === 'true' : true;
  });
  const [view, setView] = useState<ViewMode>('kanban');
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [termViewSelection, setTermViewSelection] = useState<AgentListSelection | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [planningIssueId, setPlanningIssueId] = useState<string | null>(null);
  const [detailEditing, setDetailEditing] = useState(false);
  const [awaitingInputIds, setAwaitingInputIds] = useState<Set<string>>(new Set());
  const [researchMounted, setResearchMounted] = useState(false);
  const [researchTerminalId, setResearchTerminalId] = useState<string | null>(
    () => localStorage.getItem('hermes:researchTerminalId'),
  );

  // ── Side effects ──

  // Persist git panel state
  useEffect(() => {
    localStorage.setItem('hermes:gitPanelOpen', String(gitPanelOpen));
  }, [gitPanelOpen]);

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

  const handleCreateIssue = useCallback((title: string, description: string, agent: string, command: string, branch: string) => {
    createIssue(title, description || undefined, agent || undefined, command || undefined, branch || undefined);
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
  }, []);

  const handleEditIssue = useCallback((issueId: string) => {
    setDetailIssueId(issueId);
    setDetailEditing(true);
  }, []);

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

  const closeDetail = useCallback(() => {
    setDetailIssueId(null);
    setDetailEditing(false);
  }, []);

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
    fixConflicts,
    relaunchReview,

    // Agents
    agents,

    // Git Graph
    gitGraph,

    // View
    view,
    setView,

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

    // Issue detail
    detailIssue,
    detailIssueId,
    setDetailIssueId,
    detailEditing,
    setDetailEditing,
    detailSubtasks,
    detailPR,
    closeDetail,

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
    prs, addComment, setVerdict, mergePR, fixConflicts, relaunchReview,
    agents,
    gitGraph,
    view,
    gitPanelOpen,
    expandedIssue,
    termViewSelection, termViewAgentIssue, handleTermViewSelect,
    detailIssue, detailIssueId, detailEditing, detailSubtasks, detailPR, closeDetail,
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
