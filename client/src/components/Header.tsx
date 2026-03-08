import type { ReactNode } from 'react';
import './Header.css';

interface HeaderProps {
  onAdd?: () => void;
  connected: boolean;
  children?: ReactNode;
}

export function Header({ onAdd, connected, children }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
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
