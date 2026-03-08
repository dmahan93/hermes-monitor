/**
 * @module registry
 * Repo registry with SQLite storage — tracks which repos are registered
 * and which port each instance runs on.
 *
 * Database lives at ~/.hermes/hermes-hub.db (separate from per-repo DBs).
 * Provides CRUD operations for repo entries and auto-assigns ports starting
 * from 4001.
 *
 * The database is lazily initialized on first use — constructing a Registry
 * instance has no filesystem side effects until a method is actually called.
 */
// @ts-ignore - better-sqlite3 has no ESM types yet (see https://github.com/WiseLibs/better-sqlite3/issues/1043)
import Database from 'better-sqlite3';
import { join, dirname, basename, resolve } from 'path';
import { mkdirSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';

const HERMES_DIR = join(homedir(), '.hermes');
const DEFAULT_DB_PATH = join(HERMES_DIR, 'hermes-hub.db');
const BASE_PORT = 4001;
const MAX_PORT = 65535;

const VALID_STATUSES = new Set<string>(['stopped', 'starting', 'running', 'error']);

export type RepoStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface RepoEntry {
  id: string;
  name: string;
  path: string;
  port: number;
  pid: number | null;
  status: RepoStatus;
  createdAt: number;
  updatedAt: number;
}

/**
 * Registry manages the set of registered repos and their port assignments.
 *
 * Uses better-sqlite3 in WAL mode. The database file is created lazily on
 * first use under ~/.hermes/hermes-hub.db (overridable via constructor for
 * testing). Constructing a Registry has no side effects until a method is
 * called.
 */
export class Registry {
  private _db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || DEFAULT_DB_PATH;
  }

  /** Lazy-initialize the database connection and schema on first access. */
  private get db(): Database.Database {
    if (!this._db) {
      const dir = dirname(this.dbPath);
      mkdirSync(dir, { recursive: true });
      this._db = new Database(this.dbPath);
      this._db.pragma('journal_mode = WAL');
      this._db.pragma('foreign_keys = ON');
      this.migrate();
    }
    return this._db;
  }

  /** Create tables if they don't exist. Separated for clarity and future migrations. */
  private migrate(): void {
    this._db!.exec(`
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        port INTEGER NOT NULL UNIQUE,
        pid INTEGER,
        status TEXT NOT NULL DEFAULT 'stopped',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )
    `);
  }

  /**
   * Resolve a path, following symlinks when the path exists on disk.
   * Falls back to path.resolve() only for ENOENT/ENOTDIR (path doesn't
   * exist yet). Other filesystem errors (EACCES, ELOOP, etc.) are re-thrown
   * to avoid silently registering duplicate entries for the same real path.
   */
  private resolvePath(p: string): string {
    try {
      return realpathSync(p);
    } catch (err: any) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        return resolve(p);
      }
      throw err;
    }
  }

  /**
   * Register a new repo. Auto-assigns a port and detects name from directory
   * if not provided.
   *
   * The check-and-insert is wrapped in a transaction to prevent TOCTOU races
   * where concurrent registrations could claim the same path or port.
   */
  register(repoPath: string, name?: string): RepoEntry {
    const resolved = this.resolvePath(repoPath);

    const registerTx = this.db.transaction(() => {
      const existing = this.findByPath(resolved);
      if (existing) {
        throw new Error(`Repo already registered at ${resolved} (id: ${existing.id})`);
      }

      const entry: RepoEntry = {
        id: uuidv4(),
        name: name || basename(resolved),
        path: resolved,
        port: this.nextPort(),
        pid: null,
        status: 'stopped',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.db.prepare(`
        INSERT INTO repos (id, name, path, port, pid, status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(entry.id, entry.name, entry.path, entry.port, entry.pid, entry.status,
             entry.createdAt, entry.updatedAt);

      return entry;
    });

    return registerTx();
  }

  /** Remove a repo from the registry. */
  unregister(id: string): boolean {
    const result = this.db.prepare('DELETE FROM repos WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** List all registered repos. */
  list(): RepoEntry[] {
    const rows = this.db.prepare('SELECT * FROM repos ORDER BY createdAt').all() as any[];
    return rows.map(this.rowToEntry);
  }

  /** Get a single repo by ID. */
  get(id: string): RepoEntry | null {
    const row = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as any;
    return row ? this.rowToEntry(row) : null;
  }

  /**
   * Update the running state of a repo. Returns null if ID not found.
   *
   * When `pid` is `undefined`, the existing pid is preserved (no change).
   * Pass `null` explicitly to clear the pid. When status is 'stopped',
   * pid is always cleared regardless of what's passed.
   *
   * Validates `status` at runtime — throws if not one of the allowed values.
   */
  updateStatus(id: string, status: RepoStatus, pid?: number | null): RepoEntry | null {
    if (!VALID_STATUSES.has(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${[...VALID_STATUSES].join(', ')}`);
    }

    const now = Date.now();

    // If stopping, always clear pid
    if (status === 'stopped') {
      const result = this.db.prepare(`
        UPDATE repos SET status = ?, pid = NULL, updatedAt = ? WHERE id = ?
      `).run(status, now, id);
      if (result.changes === 0) return null;
      return this.get(id);
    }

    // If pid explicitly provided, use it
    if (pid !== undefined) {
      const result = this.db.prepare(`
        UPDATE repos SET status = ?, pid = ?, updatedAt = ? WHERE id = ?
      `).run(status, pid, now, id);
      if (result.changes === 0) return null;
      return this.get(id);
    }

    // pid not provided — preserve existing pid
    const result = this.db.prepare(`
      UPDATE repos SET status = ?, updatedAt = ? WHERE id = ?
    `).run(status, now, id);
    if (result.changes === 0) return null;
    return this.get(id);
  }

  /**
   * Look up a repo by its filesystem path. Resolves symlinks when the path
   * exists to match against the canonical stored path.
   */
  findByPath(repoPath: string): RepoEntry | null {
    const resolved = this.resolvePath(repoPath);
    const row = this.db.prepare('SELECT * FROM repos WHERE path = ?').get(resolved) as any;
    return row ? this.rowToEntry(row) : null;
  }

  /** Look up a repo by its assigned port. Useful for proxy routing. */
  findByPort(port: number): RepoEntry | null {
    const row = this.db.prepare('SELECT * FROM repos WHERE port = ?').get(port) as any;
    return row ? this.rowToEntry(row) : null;
  }

  /** Find the next available port (starting from 4001, up to 65535). */
  nextPort(): number {
    const allPorts = this.db.prepare(
      'SELECT port FROM repos ORDER BY port'
    ).all() as any[];

    const usedPorts = new Set(allPorts.map((r: any) => r.port));
    let candidate = BASE_PORT;
    while (usedPorts.has(candidate)) {
      candidate++;
    }
    if (candidate > MAX_PORT) {
      throw new Error('No available ports in range 4001-65535');
    }
    return candidate;
  }

  /** Close the database connection. Safe to call multiple times. */
  close(): void {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }

  private rowToEntry(row: any): RepoEntry {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      port: row.port,
      pid: row.pid ?? null,
      status: row.status as RepoStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
