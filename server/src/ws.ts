import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { TerminalManager } from './terminal-manager.js';
import type { ClientMessage, ServerMessage } from './types.js';

export function setupWebSocket(server: Server, manager: TerminalManager): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcast = (msg: ServerMessage) => {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  // Forward PTY output to all connected clients
  manager.onData((terminalId, data) => {
    broadcast({ type: 'stdout', terminalId, data });
  });

  // Notify clients when a terminal exits
  manager.onExit((terminalId, exitCode) => {
    broadcast({ type: 'exit', terminalId, exitCode });
  });

  wss.on('connection', (ws) => {
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
        default: {
          ws.send(JSON.stringify({ type: 'error', terminalId: msg.terminalId || '', message: `Unknown message type: ${(msg as any).type}` }));
        }
      }
    });
  });

  return wss;
}
