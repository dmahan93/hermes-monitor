import express from 'express';
import { createServer } from 'http';
import { TerminalManager } from './terminal-manager.js';
import { createApiRouter } from './api.js';
import { setupWebSocket } from './ws.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

const app = express();
const server = createServer(app);
const manager = new TerminalManager();

// REST API
app.use('/api', createApiRouter(manager));

// WebSocket
setupWebSocket(server, manager);

// Cleanup on shutdown
const shutdown = () => {
  console.log('\nShutting down...');
  manager.killAll();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Hermes Monitor server listening on :${PORT}`);
});

export { app, server, manager };
