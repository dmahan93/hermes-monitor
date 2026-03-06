import express from 'express';
import { createServer } from 'http';
import { TerminalManager } from './terminal-manager.js';
import { IssueManager } from './issue-manager.js';
import { createApiRouter } from './api.js';
import { createIssueApiRouter } from './issue-api.js';
import { setupWebSocket } from './ws.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

const app = express();
const server = createServer(app);
const terminalManager = new TerminalManager();
const issueManager = new IssueManager(terminalManager);

// REST API
app.use('/api', createApiRouter(terminalManager));
app.use('/api', createIssueApiRouter(issueManager));

// WebSocket
const wss = setupWebSocket(server, terminalManager);

// Broadcast issue events over WebSocket
issueManager.onEvent((event, issue) => {
  const msg = event === 'issue:deleted'
    ? JSON.stringify({ type: 'issue:deleted', issueId: issue.id })
    : JSON.stringify({ type: event, issue });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(msg);
    }
  });
});

// Cleanup on shutdown
const shutdown = () => {
  console.log('\nShutting down...');
  terminalManager.killAll();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Hermes Monitor server listening on :${PORT}`);
});

export { app, server, terminalManager, issueManager };
