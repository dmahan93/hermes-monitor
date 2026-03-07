import type { ReactNode } from 'react';
import './Header.css';

interface HeaderProps {
  onAdd?: () => void;
  connected: boolean;
  terminalCount: number;
  issueCount?: number;
  awaitingInputCount?: number;
  children?: ReactNode;
}

export function Header({ onAdd, connected, terminalCount, issueCount, awaitingInputCount, children }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">HERMES MONITOR</h1>
        {children}
      </div>
      <div className="header-right">
        <span className="header-count">
          {terminalCount} terminal{terminalCount !== 1 ? 's' : ''}
          {issueCount !== undefined && ` · ${issueCount} issue${issueCount !== 1 ? 's' : ''}`}
        </span>
        {awaitingInputCount !== undefined && awaitingInputCount > 0 && (
          <span className="header-awaiting-input" title={`${awaitingInputCount} terminal${awaitingInputCount !== 1 ? 's' : ''} awaiting input`}>
            ⏳ {awaitingInputCount} awaiting input
          </span>
        )}
        {onAdd && (
          <button className="header-add-btn" onClick={onAdd}>
            [+ ADD TERMINAL]
          </button>
        )}
        <span className={`header-status ${connected ? 'connected' : 'disconnected'}`}>
          <span className="header-status-dot" />
          {connected ? 'connected' : 'disconnected'}
        </span>
      </div>
    </header>
  );
}
