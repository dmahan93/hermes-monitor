interface StatusBarProps {
  connected: boolean;
  terminalCount: number;
  issueCount?: number;
  awaitingInputCount?: number;
}

export function StatusBar({ connected, terminalCount, issueCount, awaitingInputCount }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-bar-item">
        ▸ {terminalCount} terminal{terminalCount !== 1 ? 's' : ''} active
        {issueCount !== undefined && ` · ${issueCount} issue${issueCount !== 1 ? 's' : ''}`}
      </span>
      <span className="status-bar-item">
        {awaitingInputCount !== undefined && awaitingInputCount > 0 && (
          <>
            <span className="status-bar-awaiting">
              ⏳ {awaitingInputCount} awaiting input
            </span>
            {' · '}
          </>
        )}
        ws: {connected ? 'ok' : 'lost'}
      </span>
    </footer>
  );
}
