interface StatusBarProps {
  connected: boolean;
  terminalCount: number;
  issueCount?: number;
}

export function StatusBar({ connected, terminalCount, issueCount }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-bar-item">
        ▸ {terminalCount} terminal{terminalCount !== 1 ? 's' : ''} active
        {issueCount !== undefined && ` · ${issueCount} issue${issueCount !== 1 ? 's' : ''}`}
      </span>
      <span className="status-bar-item">
        ws: {connected ? 'ok' : 'lost'}
      </span>
    </footer>
  );
}
