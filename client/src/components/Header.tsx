interface HeaderProps {
  onAdd: () => void;
  connected: boolean;
  terminalCount: number;
}

export function Header({ onAdd, connected, terminalCount }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">HERMES MONITOR</h1>
        <span className="header-count">{terminalCount} terminal{terminalCount !== 1 ? 's' : ''}</span>
      </div>
      <div className="header-right">
        <button className="header-add-btn" onClick={onAdd}>
          [+ ADD TERMINAL]
        </button>
        <span className={`header-status ${connected ? 'connected' : 'disconnected'}`}>
          <span className="header-status-dot" />
          {connected ? 'connected' : 'disconnected'}
        </span>
      </div>
    </header>
  );
}
