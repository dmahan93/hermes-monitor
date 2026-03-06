import { useCallback, useState } from 'react';
import { Header } from './components/Header';
import { TerminalGrid } from './components/TerminalGrid';
import { KanbanBoard } from './components/KanbanBoard';
import { ViewSwitcher, type ViewMode } from './components/ViewSwitcher';
import { StatusBar } from './components/StatusBar';
import { useTerminals } from './hooks/useTerminals';
import { useIssues } from './hooks/useIssues';
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
  const agents = useAgents();
  const [view, setView] = useState<ViewMode>('kanban');

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
    // Status changes can spawn/kill terminals — refetch terminal list
    refetchTerminals();
  }, [changeStatus, refetchTerminals]);

  const handleDeleteIssue = useCallback(async (id: string) => {
    await deleteIssue(id);
    // Deleting issue may kill its terminal — refetch
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
        <ViewSwitcher mode={view} onChange={setView} />
      </Header>
      <main className="main">
        {view === 'terminals' ? (
          <TerminalGrid
            terminals={terminals}
            layout={layout}
            onLayoutChange={updateLayout}
            send={send}
            subscribe={subscribe}
            onClose={handleCloseTerminal}
          />
        ) : (
          <KanbanBoard
            issues={issues}
            agents={agents}
            onStatusChange={handleStatusChange}
            onCreateIssue={handleCreateIssue}
            onDeleteIssue={handleDeleteIssue}
          />
        )}
      </main>
      <StatusBar connected={connected} terminalCount={terminals.length} issueCount={issues.length} />
    </div>
  );
}
