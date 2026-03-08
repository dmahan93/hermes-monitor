import express, { static as serveStatic } from 'express';
import { createServer } from 'http';
import { mkdirSync } from 'fs';
import { TerminalManager } from './terminal-manager.js';
import { IssueManager } from './issue-manager.js';
import { WorktreeManager } from './worktree-manager.js';
import { PRManager } from './pr-manager.js';
import { Store } from './store.js';
import { createApiRouter } from './terminal-api.js';
import { createIssueApiRouter } from './issue-api.js';
import { createPRApiRouter } from './pr-api.js';
import { createAgentApiRouter } from './agent-api.js';
import { createGitApiRouter } from './git-api.js';
import { setupWebSocket, broadcastToAll } from './ws.js';
import { config, isGitRepo } from './config.js';
import { enrichPRWithScreenshots } from './screenshot-utils.js';

const PORT = parseInt(process.env.PORT || '4000', 10);

const app = express();
const server = createServer(app);

// Persistent store
const store = new Store();

// Core managers
const terminalManager = new TerminalManager();
const worktreeManager = new WorktreeManager();
const prManager = new PRManager(terminalManager, worktreeManager);
const issueManager = new IssueManager(terminalManager, config.repoPath);

// Wire up cross-references
issueManager.setWorktreeManager(worktreeManager);
issueManager.setPRManager(prManager);
issueManager.setStore(store);
issueManager.setupAutoResume();
prManager.setStore(store);

// Load persisted state (clear stale terminal refs from previous session)
const { inProgress, backlog } = store.resetStaleTerminals();
if (inProgress > 0) {
  console.log(`Reset ${inProgress} in-progress issue(s) to todo`);
}
if (backlog > 0) {
  console.log(`Cleared ${backlog} stale planning terminal(s) from backlog`);
}
issueManager.loadFromStore();
prManager.loadFromStore();

// Log repo config
if (isGitRepo(config.repoPath)) {
  console.log(`Repo: ${config.repoPath} (branch: ${config.targetBranch})`);
} else {
  console.log(`Warning: ${config.repoPath} is not a git repo — worktrees disabled`);
}

// Startup cleanup: prune stale worktrees and branches from previous sessions
function getActiveIssueIds(): Set<string> {
  return new Set(issueManager.list().map((i) => i.id));
}

function runWorktreePrune(): { removedWorktrees: number; prunedBranches: number; skippedUnmergedBranches: number } {
  if (!isGitRepo(config.repoPath)) return { removedWorktrees: 0, prunedBranches: 0, skippedUnmergedBranches: 0 };
  const activeIds = getActiveIssueIds();
  const result = worktreeManager.pruneStaleWorktrees(activeIds);
  return {
    removedWorktrees: result.removedWorktrees.length,
    prunedBranches: result.prunedBranches.length,
    skippedUnmergedBranches: result.skippedUnmergedBranches.length,
  };
}

if (isGitRepo(config.repoPath)) {
  try {
    const pruned = runWorktreePrune();
    if (pruned.removedWorktrees > 0 || pruned.prunedBranches > 0 || pruned.skippedUnmergedBranches > 0) {
      const parts = [
        `Pruned ${pruned.removedWorktrees} stale worktree(s), ${pruned.prunedBranches} orphaned branch(es)`,
      ];
      if (pruned.skippedUnmergedBranches > 0) {
        parts.push(`(${pruned.skippedUnmergedBranches} unmerged branch(es) preserved — see warnings above)`);
      }
      console.log(parts.join(' '));
    }
  } catch (err) {
    console.error('Startup worktree prune failed:', err);
  }
}

// Periodic cleanup every 4 hours
const PRUNE_INTERVAL_MS = 4 * 60 * 60 * 1000;
const pruneInterval = setInterval(() => {
  try {
    const pruned = runWorktreePrune();
    if (pruned.removedWorktrees > 0 || pruned.prunedBranches > 0 || pruned.skippedUnmergedBranches > 0) {
      const parts = [
        `[auto-prune] Cleaned ${pruned.removedWorktrees} worktree(s), ${pruned.prunedBranches} branch(es)`,
      ];
      if (pruned.skippedUnmergedBranches > 0) {
        parts.push(`(${pruned.skippedUnmergedBranches} unmerged preserved)`);
      }
      console.log(parts.join(' '));
    }
  } catch (err) {
    console.error('[auto-prune] Periodic worktree prune failed:', err);
  }
}, PRUNE_INTERVAL_MS);
// Don't let the timer prevent natural process exit during graceful shutdown
pruneInterval.unref();

const issueCount = issueManager.list().length;
const prCount = prManager.list().length;
if (issueCount > 0 || prCount > 0) {
  console.log(`Loaded ${issueCount} issue(s), ${prCount} PR(s) from database`);
}

// Serve uploaded screenshots as static files
mkdirSync(config.screenshotBase, { recursive: true });
app.use('/screenshots', serveStatic(config.screenshotBase));

// Health check — used by the CLI to detect when the server is ready
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// REST API
app.use('/api', createApiRouter(terminalManager));
app.use('/api', createIssueApiRouter(issueManager));
app.use('/api', createPRApiRouter(prManager, issueManager));
app.use('/api', createGitApiRouter());

// Manual worktree prune endpoint — registered before the catch-all agent router
app.post('/api/worktrees/prune', (_req, res) => {
  if (!isGitRepo(config.repoPath)) {
    res.status(400).json({ error: 'Not a git repo — worktrees disabled' });
    return;
  }
  const activeIds = getActiveIssueIds();
  const result = worktreeManager.pruneStaleWorktrees(activeIds);
  res.json({
    removedWorktrees: result.removedWorktrees,
    prunedBranches: result.prunedBranches,
    skippedUnmergedBranches: result.skippedUnmergedBranches,
    summary: `Removed ${result.removedWorktrees.length} worktree(s), pruned ${result.prunedBranches.length} branch(es), ${result.skippedUnmergedBranches.length} unmerged preserved`,
  });
});

// Agent API router — must be registered after specific routes above
const agentRouter = createAgentApiRouter(issueManager, prManager, terminalManager, worktreeManager);
app.use('/agent', agentRouter);
// Backward compatibility: mount the same router at /ticket so existing agents
// (which use curl -s without -L) still work without needing to follow redirects.
// Response URLs (reviewUrl, screenshotUploadUrl) will reference /agent/, nudging
// callers toward the canonical prefix.
app.use('/ticket', agentRouter);

// WebSocket
const wss = setupWebSocket(server, terminalManager);

// Broadcast issue events
issueManager.onEvent((event, issue) => {
  if (event === 'issue:deleted') {
    broadcastToAll(wss, { type: 'issue:deleted', issueId: issue.id });
  } else if (event === 'issue:progress') {
    broadcastToAll(wss, {
      type: 'issue:progress',
      issueId: issue.id,
      message: issue.progressMessage ?? null,
      percent: issue.progressPercent ?? null,
    });
  } else {
    broadcastToAll(wss, { type: event, issue });
  }
});

// Broadcast PR events — enrich with screenshot data so clients get consistent data
// whether they got the PR from HTTP API or WebSocket
prManager.onEvent((event, pr) => {
  broadcastToAll(wss, { type: event, pr: enrichPRWithScreenshots(pr) });
});

// Cleanup on shutdown
const shutdown = () => {
  console.log('\nShutting down...');
  clearInterval(pruneInterval);
  issueManager.clearResumeTimers();
  prManager.clearAllPendingTimers();
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
