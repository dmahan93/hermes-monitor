import type { ReactNode } from 'react';
import './Header.css';

interface HeaderProps {
  onAdd?: () => void;
  onHome?: () => void;
  connected: boolean;
  children?: ReactNode;
}

export function Header({ onAdd, onHome, connected, children }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        {onHome && (
          <button
            className="header-hub-btn"
            onClick={onHome}
            title="Back to hub"
            aria-label="Back to hub"
          >
            ← HUB
          </button>
        )}
        <h1 className="header-title">HERMES MONITOR</h1>
        {children}
      </div>
      <div className="header-right">
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
