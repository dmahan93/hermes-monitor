import { useCallback, useState, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { TerminalGrid } from './components/TerminalGrid';
import { KanbanBoard } from './components/KanbanBoard';
import { IssueDetail } from './components/IssueDetail';
import { TaskTerminalPane } from './components/TaskTerminalPane';
import { AgentTerminalList, type AgentListSelection, selectionKey } from './components/AgentTerminalList';
import { PRList } from './components/PRList';
import { GitGraph } from './components/GitGraph';
import { DiffViewer } from './components/DiffViewer';
import { ViewSwitcher, type ViewMode } from './components/ViewSwitcher';
import { StatusBar } from './components/StatusBar';
import { useTerminals } from './hooks/useTerminals';
import { useIssues } from './hooks/useIssues';
import { usePRs } from './hooks/usePRs';
import { useAgents } from './hooks/useAgents';
import { useWebSocket } from './hooks/useWebSocket';
import { useGitGraph } from './hooks/useGitGraph';
import type { IssueStatus } from './types';
import './App.css';

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export default function App() {
  const { connected, send, subscribe } = useWebSocket(getWsUrl());
  const { terminals, layout, loading, addTerminal, removeTerminal, updateLayout, refetch: refetchTerminals } = useTerminals();
  const { issues = [], createIssue, changeStatus, updateIssue, deleteIssue } = useIssues(subscribe);
  const { prs = [], addComment, setVerdict, mergePR, fixConflicts, relaunchReview, refetch: refetchPRs } = usePRs(subscribe);
  const agents = useAgents();
  const gitGraph = useGitGraph();
  const [gitPanelOpen, setGitPanelOpen] = useState(() => {
    const stored = localStorage.getItem('hermes:gitPanelOpen');
    return stored !== null ? stored === 'true' : true;
  });

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('hermes:gitPanelOpen', String(gitPanelOpen));
  }, [gitPanelOpen]);
  const [view, setView] = useState<ViewMode>('kanban');
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [termViewSelection, setTermViewSelection] = useState<AgentListSelection | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [detailEditing, setDetailEditing] = useState(false);

  // Get the expanded issue for the kanban terminal pane
  const expandedIssue = useMemo(() => {
    if (!expandedIssueId) return null;
    return issues.find((i) => i.id === expandedIssueId) || null;
  }, [expandedIssueId, issues]);

  // Map PR status to a sensible Issue status for synthetic entries
  const prStatusToIssueStatus = useCallback((prStatus: string): 'in_progress' | 'review' | 'done' => {
    switch (prStatus) {
      case 'reviewing': return 'review';
      case 'approved':
      case 'merged':
      case 'closed': return 'done';
      default: return 'in_progress';
    }
  }, []);

  // Get the issue/PR for the terminal view sidebar selection
  const termViewAgentIssue = useMemo(() => {
    if (!termViewSelection) return null;
    if (termViewSelection.kind === 'agent') {
      return issues.find((i) => i.id === termViewSelection.issueId) || null;
    }
    // For reviewer terminals, build a synthetic Issue from the PR
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
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    };
  }, [termViewSelection, issues, prs, prStatusToIssueStatus]);

  // Auto-close panes if issue loses its terminal
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

  const handleAddTerminal = useCallback(() => {
    addTerminal();
  }, [addTerminal]);

  const handleCloseTerminal = useCallback((id: string) => {
    removeTerminal(id);
  }, [removeTerminal]);

  const handleCreateIssue = useCallback((title: string, description: string, agent: string, command: string, branch: string) => {
    createIssue(title, description || undefined, agent || undefined, command || undefined, branch || undefined);
  }, [createIssue]);

  const handleStatusChange = useCallback(async (id: string, status: IssueStatus) => {
    await changeStatus(id, status);
    refetchTerminals();
    refetchPRs();
  }, [changeStatus, refetchTerminals, refetchPRs]);

  const handleDeleteIssue = useCallback(async (id: string) => {
    if (expandedIssueId === id) setExpandedIssueId(null);
    await deleteIssue(id);
    refetchTerminals();
  }, [deleteIssue, refetchTerminals, expandedIssueId]);

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

  const detailIssue = useMemo(() => {
    if (!detailIssueId) return null;
    return issues.find((i) => i.id === detailIssueId) || null;
  }, [detailIssueId, issues]);

  const closeDetail = useCallback(() => {
    setDetailIssueId(null);
    setDetailEditing(false);
  }, []);

  const detailPR = useMemo(() => {
    if (!detailIssueId) return undefined;
    return prs.find((p) => p.issueId === detailIssueId);
  }, [detailIssueId, prs]);

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  const showTaskTerminal = view === 'kanban' && expandedIssue && expandedIssue.terminalId;

  return (
    <div className="app">
      <Header
        onAdd={view === 'terminals' ? handleAddTerminal : undefined}
        connected={connected}
        terminalCount={terminals.length}
        issueCount={issues.length}
      >
        <ViewSwitcher mode={view} onChange={setView} prCount={prs.length} />
      </Header>
      <div className="app-body">
        {/* Git Graph Left Sidebar */}
        <div className={`git-graph-sidebar ${gitPanelOpen ? 'git-graph-open' : 'git-graph-closed'}`}>
          {gitPanelOpen ? (
            <GitGraph
              commits={gitGraph.commits}
              graph={gitGraph.graph}
              loading={gitGraph.loading}
              error={gitGraph.error}
              selectedSha={gitGraph.selectedSha}
              files={gitGraph.files}
              filesLoading={gitGraph.filesLoading}
              onSelectCommit={gitGraph.selectCommit}
              onFileClick={gitGraph.viewDiff}
            />
          ) : (
            <button
              className="git-graph-toggle"
              onClick={() => setGitPanelOpen(true)}
              title="Open git graph"
              aria-label="Open git graph"
            >
              ⎇
            </button>
          )}
          {gitPanelOpen && (
            <button
              className="git-graph-collapse"
              onClick={() => setGitPanelOpen(false)}
              title="Collapse git graph"
              aria-label="Collapse git graph"
            >
              ◂
            </button>
          )}
        </div>

        {/* Main content area */}
        <main className="main">
          {/* Terminal view: sidebar + grid/expanded agent */}
          <div className={`view-panel ${view === 'terminals' ? 'view-active' : 'view-hidden'}`}>
            <div className="terminals-layout">
              <div className="terminals-main">
                {termViewAgentIssue && termViewAgentIssue.terminalId ? (
                  <TaskTerminalPane
                    issue={termViewAgentIssue}
                    send={send}
                    subscribe={subscribe}
                    onMinimize={() => setTermViewSelection(null)}
                  />
                ) : (
                  <TerminalGrid
                    terminals={terminals}
                    layout={layout}
                    onLayoutChange={updateLayout}
                    send={send}
                    subscribe={subscribe}
                    onClose={handleCloseTerminal}
                  />
                )}
              </div>
              <div className="terminals-sidebar">
                <AgentTerminalList
                  issues={issues}
                  prs={prs}
                  agents={agents}
                  activeTerminalId={termViewAgentIssue?.terminalId || null}
                  onSelect={(selection) => {
                    setTermViewSelection((prev) =>
                      prev && selectionKey(prev) === selectionKey(selection) ? null : selection
                    );
                  }}
                />
              </div>
            </div>
          </div>

          {/* Kanban view: board + optional split terminal */}
          <div className={`view-panel ${view === 'kanban' ? 'view-active' : 'view-hidden'}`}>
            <div className={`kanban-split ${showTaskTerminal ? 'split-open' : ''}`}>
              <div className="kanban-split-left">
                <KanbanBoard
                  issues={issues}
                  agents={agents}
                  onStatusChange={handleStatusChange}
                  onCreateIssue={handleCreateIssue}
                  onDeleteIssue={handleDeleteIssue}
                  onEditIssue={handleEditIssue}
                  onTerminalClick={handleTerminalClick}
                  onIssueClick={handleIssueClick}
                />
              </div>
              {showTaskTerminal && (
                <div className="kanban-split-right">
                  <TaskTerminalPane
                    issue={expandedIssue}
                    send={send}
                    subscribe={subscribe}
                    onMinimize={() => setExpandedIssueId(null)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* PR view */}
          <div className={`view-panel ${view === 'prs' ? 'view-active' : 'view-hidden'}`}>
            <PRList
              prs={prs}
              issues={issues}
              onComment={addComment}
              onVerdict={setVerdict}
              onMerge={mergePR}
              onFixConflicts={fixConflicts}
              onRelaunchReview={relaunchReview}
              onMoveToInProgress={(issueId) => handleStatusChange(issueId, 'in_progress')}
            />
          </div>
        </main>
      </div>
      <StatusBar connected={connected} terminalCount={terminals.length} issueCount={issues.length} />

      {/* Diff viewer overlay */}
      {gitGraph.diffFile && gitGraph.diffSha && (
        <DiffViewer
          sha={gitGraph.diffSha}
          file={gitGraph.diffFile}
          diff={gitGraph.diffContent}
          loading={gitGraph.diffLoading}
          onClose={gitGraph.closeDiff}
        />
      )}

      {detailIssue && (
        <IssueDetail
          key={`${detailIssueId}-${detailEditing}`}
          issue={detailIssue}
          agents={agents}
          pr={detailPR}
          initialEditing={detailEditing}
          onClose={closeDetail}
          onUpdate={(id, updates) => updateIssue(id, updates)}
          onStatusChange={(id, status) => { handleStatusChange(id, status); closeDetail(); }}
          onDelete={(id) => { handleDeleteIssue(id); closeDetail(); }}
          onTerminalClick={(issueId) => { closeDetail(); handleTerminalClick(issueId); }}
          onPRClick={() => { closeDetail(); setView('prs'); }}
        />
      )}
    </div>
  );
}
