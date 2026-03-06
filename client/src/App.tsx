import { useCallback, useState, useEffect } from 'react';
import { Header } from './components/Header';
import { TerminalGrid } from './components/TerminalGrid';
import { KanbanBoard } from './components/KanbanBoard';
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
  const { issues, createIssue, changeStatus, deleteIssue } = useIssues(subscribe);
  const { prs, addComment, setVerdict, mergePR } = usePRs(subscribe);
  const agents = useAgents();
  const [view, setView] = useState<ViewMode>('kanban');

  // Refetch terminals when issues or PRs change (status changes can spawn/kill terminals)
  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type === 'issue:updated' || msg.type === 'issue:deleted' ||
          msg.type === 'pr:created' || msg.type === 'pr:updated') {
        setTimeout(() => refetchTerminals(), 300);
      }
    });
    return unsub;
  }, [subscribe, refetchTerminals]);

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
  }, [changeStatus, refetchTerminals]);

  const handleDeleteIssue = useCallback(async (id: string) => {
    await deleteIssue(id);
    refetchTerminals();
  }, [deleteIssue, refetchTerminals]);

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

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
        {/* All views stay mounted — hidden with CSS to preserve terminal state */}
        <div className="view-panel" style={{ display: view === 'terminals' ? 'contents' : 'none' }}>
          <TerminalGrid
            terminals={terminals}
            layout={layout}
            onLayoutChange={updateLayout}
            send={send}
            subscribe={subscribe}
            onClose={handleCloseTerminal}
          />
        </div>
        <div className="view-panel" style={{ display: view === 'kanban' ? 'contents' : 'none' }}>
          <KanbanBoard
            issues={issues}
            agents={agents}
            onStatusChange={handleStatusChange}
            onCreateIssue={handleCreateIssue}
            onDeleteIssue={handleDeleteIssue}
          />
        </div>
        <div className="view-panel" style={{ display: view === 'prs' ? 'contents' : 'none' }}>
          <PRList
            prs={prs}
            onComment={addComment}
            onVerdict={setVerdict}
            onMerge={mergePR}
          />
        </div>
      </main>
      <StatusBar connected={connected} terminalCount={terminals.length} issueCount={issues.length} />
    </div>
  );
}
