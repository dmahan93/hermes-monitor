// @ts-ignore - esm/cjs interop
import Database from 'better-sqlite3';
import { join } from 'path';
import type { Issue, IssueStatus } from './issue-manager.js';
import type { PullRequest, PRComment, PRStatus, Verdict } from './pr-manager.js';

const DB_PATH = process.env.HERMES_DB_PATH || join(process.cwd(), '..', 'hermes-monitor.db');

export class Store {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        agent TEXT NOT NULL DEFAULT 'hermes',
        command TEXT NOT NULL DEFAULT '',
        terminalId TEXT,
        branch TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pull_requests (
        id TEXT PRIMARY KEY,
        issueId TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        sourceBranch TEXT NOT NULL,
        targetBranch TEXT NOT NULL,
        repoPath TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        diff TEXT NOT NULL DEFAULT '',
        changedFiles TEXT NOT NULL DEFAULT '[]',
        verdict TEXT NOT NULL DEFAULT 'pending',
        reviewerTerminalId TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pr_comments (
        id TEXT PRIMARY KEY,
        prId TEXT NOT NULL,
        author TEXT NOT NULL,
        body TEXT NOT NULL,
        file TEXT,
        line INTEGER,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (prId) REFERENCES pull_requests(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // ── Issues ──

  saveIssue(issue: Issue): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO issues (id, title, description, status, agent, command, terminalId, branch, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(issue.id, issue.title, issue.description, issue.status, issue.agent, issue.command,
           issue.terminalId, issue.branch, issue.createdAt, issue.updatedAt);
  }

  loadIssues(): Issue[] {
    const rows = this.db.prepare('SELECT * FROM issues').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status as IssueStatus,
      agent: r.agent,
      command: r.command,
      terminalId: r.terminalId,
      branch: r.branch,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  deleteIssue(id: string): void {
    this.db.prepare('DELETE FROM issues WHERE id = ?').run(id);
  }

  /** Reset stale terminal state on startup: move in_progress → todo, clear backlog planning terminals.
   *  Terminals don't survive server restart, so all terminal refs must be cleared. */
  resetStaleTerminals(): number {
    const now = Date.now();
    const result = this.db.prepare(
      "UPDATE issues SET status = 'todo', terminalId = NULL, updatedAt = ? WHERE status = 'in_progress'"
    ).run(now);
    // Also clear planning terminal refs for backlog issues (terminals don't survive restart)
    this.db.prepare(
      "UPDATE issues SET terminalId = NULL, updatedAt = ? WHERE status = 'backlog' AND terminalId IS NOT NULL"
    ).run(now);
    return result.changes;
  }

  // ── Pull Requests ──

  savePR(pr: PullRequest): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO pull_requests
      (id, issueId, title, description, sourceBranch, targetBranch, repoPath, status, diff, changedFiles, verdict, reviewerTerminalId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pr.id, pr.issueId, pr.title, pr.description, pr.sourceBranch, pr.targetBranch,
           pr.repoPath, pr.status, pr.diff, JSON.stringify(pr.changedFiles), pr.verdict,
           pr.reviewerTerminalId, pr.createdAt, pr.updatedAt);

    // Save comments
    const deleteStmt = this.db.prepare('DELETE FROM pr_comments WHERE prId = ?');
    const insertStmt = this.db.prepare(`
      INSERT INTO pr_comments (id, prId, author, body, file, line, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const saveTx = this.db.transaction((pr: PullRequest) => {
      deleteStmt.run(pr.id);
      for (const c of pr.comments) {
        insertStmt.run(c.id, c.prId, c.author, c.body, c.file || null, c.line || null, c.createdAt);
      }
    });
    saveTx(pr);
  }

  loadPRs(): PullRequest[] {
    const rows = this.db.prepare('SELECT * FROM pull_requests').all() as any[];
    const commentRows = this.db.prepare('SELECT * FROM pr_comments ORDER BY createdAt').all() as any[];

    const commentsByPr = new Map<string, PRComment[]>();
    for (const c of commentRows) {
      const list = commentsByPr.get(c.prId) || [];
      list.push({
        id: c.id,
        prId: c.prId,
        author: c.author,
        body: c.body,
        file: c.file || undefined,
        line: c.line || undefined,
        createdAt: c.createdAt,
      });
      commentsByPr.set(c.prId, list);
    }

    return rows.map((r) => ({
      id: r.id,
      issueId: r.issueId,
      title: r.title,
      description: r.description,
      sourceBranch: r.sourceBranch,
      targetBranch: r.targetBranch,
      repoPath: r.repoPath,
      status: r.status as PRStatus,
      diff: r.diff,
      changedFiles: JSON.parse(r.changedFiles),
      verdict: r.verdict as Verdict,
      reviewerTerminalId: r.reviewerTerminalId,
      comments: commentsByPr.get(r.id) || [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  deletePR(id: string): void {
    this.db.prepare('DELETE FROM pull_requests WHERE id = ?').run(id);
  }

  // ── Config ──

  getConfig(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as any;
    return row?.value;
  }

  setConfig(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
