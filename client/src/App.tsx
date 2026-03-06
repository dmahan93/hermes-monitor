import { useCallback, useState, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { TerminalGrid } from './components/TerminalGrid';
import { KanbanBoard } from './components/KanbanBoard';
import { IssueDetail } from './components/IssueDetail';
import { TaskTerminalPane } from './components/TaskTerminalPane';
import { PRList } from './components/PRList';
import { ViewSwitcher, type ViewMode } from './components/ViewSwitcher';
import { StatusBar } from './components/StatusBar';
import { useTerminals } from './hooks/useTerminals';
import { useIssues } from './hooks/useIssues';
import { usePRs } from './hooks/usePRs';
import { useAgents } from './hooks/useAgents';
import { useWebSocket } from './hooks/useWebSocket';
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
  const [view, setView] = useState<ViewMode>('kanban');
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);

  // Get the expanded issue for the terminal pane
  const expandedIssue = useMemo(() => {
    if (!expandedIssueId) return null;
    return issues.find((i) => i.id === expandedIssueId) || null;
  }, [expandedIssueId, issues]);

  // Auto-close pane if issue loses its terminal
  useEffect(() => {
    if (expandedIssue && !expandedIssue.terminalId) {
      setExpandedIssueId(null);
    }
  }, [expandedIssue]);

  // Refetch terminals and PRs when issues change (status changes spawn/kill terminals and create PRs)
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

  const handleAddTerminal = useCallback(() => { addTerminal(); }, [addTerminal]);
  const handleCloseTerminal = useCallback((id: string) => { removeTerminal(id); }, [removeTerminal]);

  const handleCreateIssue = useCallback((title: string, description: string, agent: string, command: string, branch: string) => {
    createIssue(title, description || undefined, agent || undefined, command || undefined, branch || undefined);
  }, [createIssue]);

  const handleStatusChange = useCallback(async (id: string, status: any) => {
    await changeStatus(id, status);
    // Status changes can spawn/kill terminals and create PRs
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

  // Get detail issue and its PR
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
      <main className="main">
        {/* Terminal grid — always mounted, visibility toggled */}
        <div className={`view-panel ${view === 'terminals' ? 'view-active' : 'view-hidden'}`}>
          <TerminalGrid
            terminals={terminals}
            layout={layout}
            onLayoutChange={updateLayout}
            send={send}
            subscribe={subscribe}
            onClose={handleCloseTerminal}
          />
        </div>

        {/* Kanban — with optional split terminal pane */}
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

        {/* PRs */}
        <div className={`view-panel ${view === 'prs' ? 'view-active' : 'view-hidden'}`}>
          <PRList
            prs={prs}
            onComment={addComment}
            onVerdict={setVerdict}
            onMerge={mergePR}
          />
        </div>
      </main>
      <StatusBar connected={connected} terminalCount={terminals.length} issueCount={issues.length} />

      {/* Issue Detail Modal */}
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
