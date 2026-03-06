import { TerminalView } from './TerminalView';
import type { Issue, ServerMessage } from '../types';

interface TaskTerminalPaneProps {
  issue: Issue;
  send: (msg: any) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;
  onMinimize: () => void;
}

export function TaskTerminalPane({ issue, send, subscribe, onMinimize }: TaskTerminalPaneProps) {
  if (!issue.terminalId) return null;

  return (
    <div className="task-terminal-pane">
      <div className="task-terminal-header">
        <span className="task-terminal-title">
          <span className="task-terminal-icon">▸</span>
          {issue.title}
        </span>
        <div className="task-terminal-actions">
          <span className="task-terminal-branch">{issue.branch || ''}</span>
          <button className="task-terminal-minimize" onClick={onMinimize} title="Minimize">
            [_]
          </button>
        </div>
      </div>
      <div className="task-terminal-body">
        <TerminalView
          terminalId={issue.terminalId}
          send={send}
          subscribe={subscribe}
        />
      </div>
    </div>
  );
}
