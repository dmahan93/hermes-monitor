// @ts-ignore - esm/cjs interop
import Database from 'better-sqlite3';
import { join } from 'path';
import type { Issue, IssueStatus } from './issue-manager.js';
import type { PullRequest, PRComment, PRStatus, Verdict } from './pr-manager.js';

const DB_PATH = process.env.HERMES_DB_PATH || join(process.cwd(), '..', 'hermes-monitor.db');

/**
 * SQLite persistence layer for issues, pull requests, comments, and config.
 *
 * **Key responsibilities:**
 * - Provides typed CRUD methods for all persistent entities (issues, PRs,
 *   PR comments, and config key-value pairs).
 * - Runs schema migrations on construction — creates tables if missing and
 *   adds columns for newer schema versions (e.g., `submitterNotes`, `parentId`).
 * - Resets stale terminal state on startup: moves `in_progress` issues back
 *   to `todo` (since their agent terminals did not survive the server restart)
 *   and clears `terminalId` on backlog issues that had planning terminals.
 *
 * **Persistence:** Uses better-sqlite3 in WAL mode for concurrent read access.
 * The database file defaults to `../hermes-monitor.db` relative to `cwd`,
 * overridable via `HERMES_DB_PATH` env var.
 *
 * **Ephemeral state:** None — this class is purely a persistence adapter.
 * All runtime coordination lives in the manager classes.
 */
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
        status TEXT NOT NULL DEFAULT 'backlog',
        agent TEXT NOT NULL DEFAULT 'hermes',
        command TEXT NOT NULL DEFAULT '',
        terminalId TEXT,
        branch TEXT,
        parentId TEXT,
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

    // Migration: add submitterNotes column to pull_requests if it doesn't exist
    const prColumns = this.db.prepare("PRAGMA table_info(pull_requests)").all() as any[];
    if (!prColumns.some((c: any) => c.name === 'submitterNotes')) {
      this.db.exec("ALTER TABLE pull_requests ADD COLUMN submitterNotes TEXT NOT NULL DEFAULT ''");
    }

    // Migration: add parentId column to issues if it doesn't exist (for existing DBs)
    const issueColumns = this.db.prepare("PRAGMA table_info(issues)").all() as any[];
    if (!issueColumns.some((c: any) => c.name === 'parentId')) {
      this.db.exec("ALTER TABLE issues ADD COLUMN parentId TEXT");
    }

    // Migration: add githubPrUrl column to pull_requests if it doesn't exist
    if (!prColumns.some((c: any) => c.name === 'githubPrUrl')) {
      this.db.exec("ALTER TABLE pull_requests ADD COLUMN githubPrUrl TEXT");
    }

    // Index for efficient subtask lookups by parentId
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_issues_parentId ON issues(parentId)");
  }

  // ── Issues ──

  saveIssue(issue: Issue): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO issues (id, title, description, status, agent, command, terminalId, branch, parentId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(issue.id, issue.title, issue.description, issue.status, issue.agent, issue.command,
           issue.terminalId, issue.branch, issue.parentId, issue.createdAt, issue.updatedAt);
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
      parentId: r.parentId || null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  deleteIssue(id: string): void {
    this.db.prepare('DELETE FROM issues WHERE id = ?').run(id);
  }

  /** Reset stale terminal state on startup: move in_progress → todo, clear backlog planning terminals.
   *  Terminals don't survive server restart, so all terminal refs must be cleared. */
  resetStaleTerminals(): { inProgress: number; backlog: number } {
    const now = Date.now();
    const inProgressResult = this.db.prepare(
      "UPDATE issues SET status = 'todo', terminalId = NULL, updatedAt = ? WHERE status = 'in_progress'"
    ).run(now);
    // Also clear planning terminal refs for backlog issues (terminals don't survive restart)
    const backlogResult = this.db.prepare(
      "UPDATE issues SET terminalId = NULL, updatedAt = ? WHERE status = 'backlog' AND terminalId IS NOT NULL"
    ).run(now);
    return { inProgress: inProgressResult.changes, backlog: backlogResult.changes };
  }

  // ── Pull Requests ──

  savePR(pr: PullRequest): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO pull_requests
      (id, issueId, title, description, submitterNotes, sourceBranch, targetBranch, repoPath, status, diff, changedFiles, verdict, reviewerTerminalId, githubPrUrl, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pr.id, pr.issueId, pr.title, pr.description, pr.submitterNotes,
           pr.sourceBranch, pr.targetBranch,
           pr.repoPath, pr.status, pr.diff, JSON.stringify(pr.changedFiles), pr.verdict,
           pr.reviewerTerminalId, pr.githubPrUrl || null, pr.createdAt, pr.updatedAt);

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
      submitterNotes: r.submitterNotes || '',
      sourceBranch: r.sourceBranch,
      targetBranch: r.targetBranch,
      repoPath: r.repoPath,
      status: r.status as PRStatus,
      diff: r.diff,
      changedFiles: (() => { try { return JSON.parse(r.changedFiles); } catch { return []; } })(),
      verdict: r.verdict as Verdict,
      reviewerTerminalId: r.reviewerTerminalId,
      githubPrUrl: r.githubPrUrl || undefined,
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
