import { useCallback, useState, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { TerminalGrid } from './components/TerminalGrid';
import { KanbanBoard } from './components/KanbanBoard';
import { IssueDetail } from './components/IssueDetail';
import { TaskTerminalPane } from './components/TaskTerminalPane';
import { AgentTerminalList } from './components/AgentTerminalList';
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
import './App.css';

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export default function App() {
  const { connected, send, subscribe } = useWebSocket(getWsUrl());
  const { terminals, layout, loading, addTerminal, removeTerminal, updateLayout, refetch: refetchTerminals } = useTerminals();
  const { issues, createIssue, changeStatus, updateIssue, deleteIssue } = useIssues(subscribe);
  const { prs, addComment, setVerdict, mergePR, refetch: refetchPRs } = usePRs(subscribe);
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
  const [termViewAgentId, setTermViewAgentId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);

  // Get the expanded issue for the terminal pane
  const expandedIssue = useMemo(() => {
    if (!expandedIssueId) return null;
    return issues.find((i) => i.id === expandedIssueId) || null;
  }, [expandedIssueId, issues]);

  // Get the agent issue for the terminal view pane
  const termViewAgentIssue = useMemo(() => {
    if (!termViewAgentId) return null;
    return issues.find((i) => i.id === termViewAgentId) || null;
  }, [termViewAgentId, issues]);

  // Auto-close panes if issue loses its terminal
  useEffect(() => {
    if (expandedIssue && !expandedIssue.terminalId) {
      setExpandedIssueId(null);
    }
  }, [expandedIssue]);

  useEffect(() => {
    if (termViewAgentIssue && !termViewAgentIssue.terminalId) {
      setTermViewAgentId(null);
    }
  }, [termViewAgentIssue]);

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

  const handleStatusChange = useCallback(async (id: string, status: any) => {
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
  }, []);

  const detailIssue = useMemo(() => {
    if (!detailIssueId) return null;
    return issues.find((i) => i.id === detailIssueId) || null;
  }, [detailIssueId, issues]);

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
            >
              ⎇
            </button>
          )}
          {gitPanelOpen && (
            <button
              className="git-graph-collapse"
              onClick={() => setGitPanelOpen(false)}
              title="Collapse git graph"
            >
              ◂
            </button>
          )}
        </div>

        {/* Main content area */}
        <main className="main">
          <div className={`view-panel ${view === 'terminals' ? 'view-active' : 'view-hidden'}`}>
            <div className="terminals-layout">
              <div className="terminals-sidebar">
                <AgentTerminalList
                  issues={issues}
                  agents={agents}
                  activeTerminalId={termViewAgentIssue?.terminalId || null}
                  onSelect={(issueId) => setTermViewAgentId((prev) => prev === issueId ? null : issueId)}
                />
              </div>
              <div className="terminals-main">
                {termViewAgentIssue && termViewAgentIssue.terminalId ? (
                  <TaskTerminalPane
                    issue={termViewAgentIssue}
                    send={send}
                    subscribe={subscribe}
                    onMinimize={() => setTermViewAgentId(null)}
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
            </div>
          </div>
          <div className={`view-panel ${view === 'kanban' ? 'view-active' : 'view-hidden'}`}>
            <div className={`kanban-split ${showTaskTerminal ? 'split-open' : ''}`}>
              <div className="kanban-split-left">
                <KanbanBoard
                  issues={issues}
                  agents={agents}
                  onStatusChange={handleStatusChange}
                  onCreateIssue={handleCreateIssue}
                  onDeleteIssue={handleDeleteIssue}
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
          <div className={`view-panel ${view === 'prs' ? 'view-active' : 'view-hidden'}`}>
            <PRList
              prs={prs}
              onComment={addComment}
              onVerdict={setVerdict}
              onMerge={mergePR}
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
          issue={detailIssue}
          agents={agents}
          pr={detailPR}
          onClose={() => setDetailIssueId(null)}
          onUpdate={(id, updates) => updateIssue(id, updates)}
          onStatusChange={(id, status) => { handleStatusChange(id, status); setDetailIssueId(null); }}
          onDelete={(id) => { handleDeleteIssue(id); setDetailIssueId(null); }}
          onTerminalClick={(issueId) => { setDetailIssueId(null); handleTerminalClick(issueId); }}
          onPRClick={() => { setDetailIssueId(null); setView('prs'); }}
        />
      )}
    </div>
  );
}
