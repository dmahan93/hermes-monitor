import { TerminalView } from './TerminalView';
import type { TerminalInfo, ServerMessage } from '../types';
import './TerminalPane.css';

interface TerminalPaneProps {
  terminal: TerminalInfo;
  send: (msg: any) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;
  onClose: (id: string) => void;
  awaitingInput?: boolean;
}

export function TerminalPane({ terminal, send, subscribe, onClose, awaitingInput }: TerminalPaneProps) {
  return (
    <div className={`terminal-pane${awaitingInput ? ' terminal-pane-awaiting' : ''}`}>
      <div className="terminal-pane-header">
        <span className="terminal-pane-drag-handle">⠿</span>
        <span className="terminal-pane-title">{terminal.title}</span>
        {awaitingInput && (
          <span className="terminal-pane-alert" title="Terminal is awaiting input">
            ⏳ INPUT
          </span>
        )}
        <span className="terminal-pane-pid">pid:{terminal.pid}</span>
        <button
          className="terminal-pane-close"
          onClick={() => onClose(terminal.id)}
          title="Close terminal"
        >
          ×
        </button>
      </div>
      <div className="terminal-pane-body">
        <TerminalView
          terminalId={terminal.id}
          send={send}
          subscribe={subscribe}
        />
      </div>
    </div>
  );
}
