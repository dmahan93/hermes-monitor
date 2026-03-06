import express from 'express';
import { createServer } from 'http';
import { TerminalManager } from './terminal-manager.js';
import { IssueManager } from './issue-manager.js';
import { WorktreeManager } from './worktree-manager.js';
import { PRManager } from './pr-manager.js';
import { createApiRouter } from './api.js';
import { createIssueApiRouter } from './issue-api.js';
import { createPRApiRouter } from './pr-api.js';
import { setupWebSocket } from './ws.js';
import { config, isGitRepo } from './config.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

const app = express();
const server = createServer(app);

// Core managers
const terminalManager = new TerminalManager();
const worktreeManager = new WorktreeManager();
const prManager = new PRManager(terminalManager, worktreeManager);
const issueManager = new IssueManager(terminalManager);

// Wire up cross-references (avoids circular constructor deps)
issueManager.setWorktreeManager(worktreeManager);
issueManager.setPRManager(prManager);

// Log repo config
if (isGitRepo(config.repoPath)) {
  console.log(`Repo: ${config.repoPath} (branch: ${config.targetBranch})`);
} else {
  console.log(`Warning: ${config.repoPath} is not a git repo — worktrees disabled`);
}

// REST API
app.use('/api', createApiRouter(terminalManager));
app.use('/api', createIssueApiRouter(issueManager));
app.use('/api', createPRApiRouter(prManager));

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
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Hermes Monitor server listening on :${PORT}`);
});

export { app, server, terminalManager, issueManager, worktreeManager, prManager };
