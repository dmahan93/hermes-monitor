interface StatusBarProps {
  connected: boolean;
  terminalCount: number;
}

export function StatusBar({ connected, terminalCount }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-bar-item">
        ▸ {terminalCount} active
      </span>
      <span className="status-bar-item">
        ws: {connected ? 'ok' : 'lost'}
      </span>
    </footer>
  );
}
