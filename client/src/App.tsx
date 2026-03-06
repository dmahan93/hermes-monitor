import { useCallback } from 'react';
import { Header } from './components/Header';
import { TerminalGrid } from './components/TerminalGrid';
import { StatusBar } from './components/StatusBar';
import { useTerminals } from './hooks/useTerminals';
import { useWebSocket } from './hooks/useWebSocket';
import './App.css';

function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export default function App() {
  const { terminals, layout, loading, addTerminal, removeTerminal, updateLayout } = useTerminals();
  const { connected, send, subscribe } = useWebSocket(getWsUrl());

  const handleAdd = useCallback(() => {
    addTerminal();
  }, [addTerminal]);

  const handleClose = useCallback((id: string) => {
    removeTerminal(id);
  }, [removeTerminal]);

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
        onAdd={handleAdd}
        connected={connected}
        terminalCount={terminals.length}
      />
      <main className="main">
        <TerminalGrid
          terminals={terminals}
          layout={layout}
          onLayoutChange={updateLayout}
          send={send}
          subscribe={subscribe}
          onClose={handleClose}
        />
      </main>
      <StatusBar connected={connected} terminalCount={terminals.length} />
    </div>
  );
}
