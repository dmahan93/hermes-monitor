import express, { static as serveStatic } from 'express';
import { createServer } from 'http';
import { mkdirSync } from 'fs';
import { TerminalManager } from './terminal-manager.js';
import { IssueManager } from './issue-manager.js';
import { WorktreeManager } from './worktree-manager.js';
import { PRManager } from './pr-manager.js';
import { Store } from './store.js';
import { createApiRouter } from './api.js';
import { createIssueApiRouter } from './issue-api.js';
import { createPRApiRouter } from './pr-api.js';
import { createTicketApiRouter } from './ticket-api.js';
import { setupWebSocket } from './ws.js';
import { config, isGitRepo } from './config.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

const app = express();
const server = createServer(app);

// Persistent store
const store = new Store();

// Core managers
const terminalManager = new TerminalManager();
const worktreeManager = new WorktreeManager();
const prManager = new PRManager(terminalManager, worktreeManager);
const issueManager = new IssueManager(terminalManager);

// Wire up cross-references
issueManager.setWorktreeManager(worktreeManager);
issueManager.setPRManager(prManager);
issueManager.setStore(store);
prManager.setStore(store);

// Load persisted state
const resetCount = store.resetInProgress();
if (resetCount > 0) {
  console.log(`Reset ${resetCount} in-progress issue(s) to todo`);
}
issueManager.loadFromStore();
prManager.loadFromStore();

// Log repo config
if (isGitRepo(config.repoPath)) {
  console.log(`Repo: ${config.repoPath} (branch: ${config.targetBranch})`);
} else {
  console.log(`Warning: ${config.repoPath} is not a git repo — worktrees disabled`);
}

const issueCount = issueManager.list().length;
const prCount = prManager.list().length;
if (issueCount > 0 || prCount > 0) {
  console.log(`Loaded ${issueCount} issue(s), ${prCount} PR(s) from database`);
}

// Serve uploaded screenshots as static files
mkdirSync(config.screenshotBase, { recursive: true });
app.use('/screenshots', serveStatic(config.screenshotBase));

// REST API
app.use('/api', createApiRouter(terminalManager));
app.use('/api', createIssueApiRouter(issueManager));
app.use('/api', createPRApiRouter(prManager, issueManager));
app.use('/', createTicketApiRouter(issueManager, prManager, terminalManager, worktreeManager));

// WebSocket
const wss = setupWebSocket(server, terminalManager);

// Helper to broadcast over WS
const broadcast = (msg: any) => {
  const payload = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
};

// Broadcast issue events
issueManager.onEvent((event, issue) => {
  broadcast(
    event === 'issue:deleted'
      ? { type: 'issue:deleted', issueId: issue.id }
      : { type: event, issue }
  );
});

// Broadcast PR events
prManager.onEvent((event, pr) => {
  broadcast({ type: event, pr });
});

// Cleanup on shutdown
const shutdown = () => {
  console.log('\nShutting down...');
  terminalManager.killAll();
  store.close();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Hermes Monitor server listening on :${PORT}`);
});

export { app, server, terminalManager, issueManager, worktreeManager, prManager, store };
