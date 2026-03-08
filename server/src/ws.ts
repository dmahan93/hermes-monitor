import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { TerminalManager } from './terminal-manager.js';
import type { ClientMessage, ServerMessage } from './types.js';

/**
 * Broadcast a JSON message to all connected WebSocket clients.
 * Shared helper used by both terminal events (ws.ts) and
 * issue/PR events (index.ts).
 */
export function broadcastToAll(wss: WebSocketServer, msg: ServerMessage): void {
  const payload = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

export function setupWebSocket(server: Server, manager: TerminalManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcast = (msg: ServerMessage) => broadcastToAll(wss, msg);

  // Forward PTY output to all connected clients
  manager.onData((terminalId, data) => {
    broadcast({ type: 'stdout', terminalId, data });
  });

  // Notify clients when a terminal exits
  manager.onExit((terminalId, exitCode) => {
    broadcast({ type: 'exit', terminalId, exitCode });
  });

  // Notify clients when a terminal is created
  manager.onCreate((terminal) => {
    broadcast({ type: 'terminal:created', terminal });
  });

  // Notify clients when a terminal is removed (killed/cleaned up)
  manager.onRemove((terminalId) => {
    broadcast({ type: 'terminal:removed', terminalId });
  });

  // Notify clients when a terminal is awaiting input
  manager.onAwaitingInput((terminalId, awaitingInput) => {
    broadcast({ type: 'terminal:awaitingInput', terminalId, awaitingInput });
  });

  wss.on('connection', (ws) => {
    // Replay scrollback for all active terminals to the new client
    for (const terminal of manager.list()) {
      const scrollback = manager.getScrollback(terminal.id);
      if (scrollback) {
        ws.send(JSON.stringify({ type: 'stdout', terminalId: terminal.id, data: scrollback }));
      }
      // Send current awaiting input state for each terminal
      if (manager.isAwaitingInput(terminal.id)) {
        ws.send(JSON.stringify({ type: 'terminal:awaitingInput', terminalId: terminal.id, awaitingInput: true }));
      }
    }

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', terminalId: '', message: 'Invalid JSON' }));
        return;
      }

      if (!msg.type || !msg.terminalId) {
        ws.send(JSON.stringify({ type: 'error', terminalId: '', message: 'Missing type or terminalId' }));
        return;
      }

      switch (msg.type) {
        case 'stdin': {
          const ok = manager.write(msg.terminalId, msg.data);
          if (!ok) {
            ws.send(JSON.stringify({ type: 'error', terminalId: msg.terminalId, message: 'Terminal not found' }));
          }
          break;
        }
        case 'resize': {
          const ok = manager.resize(msg.terminalId, msg.cols, msg.rows);
          if (!ok) {
            ws.send(JSON.stringify({ type: 'error', terminalId: msg.terminalId, message: 'Terminal not found' }));
          }
          break;
        }
        case 'replay': {
          // Client requests scrollback for a specific terminal (e.g. on component mount)
          const scrollback = manager.getScrollback(msg.terminalId);
          if (scrollback) {
            ws.send(JSON.stringify({ type: 'stdout', terminalId: msg.terminalId, data: scrollback }));
          }
          break;
        }
        default: {
          const m = msg as any;
          ws.send(JSON.stringify({ type: 'error', terminalId: m.terminalId || '', message: `Unknown message type: ${m.type}` }));
        }
      }
    });
  });

  return wss;
}
