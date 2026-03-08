import './StatusBar.css';

interface StatusBarProps {
  terminalCount: number;
  issueCount?: number;
  awaitingInputCount?: number;
}

export function StatusBar({ terminalCount, issueCount, awaitingInputCount }: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span className="status-bar-item">
        ▸ {terminalCount} terminal{terminalCount !== 1 ? 's' : ''} active
        {issueCount !== undefined && ` · ${issueCount} issue${issueCount !== 1 ? 's' : ''}`}
      </span>
      {awaitingInputCount !== undefined && awaitingInputCount > 0 && (
        <span className="status-bar-item">
          <span className="status-bar-awaiting">
            ⏳ {awaitingInputCount} awaiting input
          </span>
        </span>
      )}
    </footer>
  );
}
