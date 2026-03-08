/**
 * @module registry
 * Repo registry with SQLite storage — tracks which repos are registered
 * and which port each instance runs on.
 *
 * Database lives at ~/.hermes/hermes-hub.db (separate from per-repo DBs).
 * Provides CRUD operations for repo entries and auto-assigns ports starting
 * from 4001.
 */
// @ts-ignore - better-sqlite3 has no ESM types yet (see https://github.com/WiseLibs/better-sqlite3/issues/1043)
import Database from 'better-sqlite3';
import { join, dirname, basename, resolve } from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';

const HERMES_DIR = join(homedir(), '.hermes');
const DEFAULT_DB_PATH = join(HERMES_DIR, 'hermes-hub.db');
const BASE_PORT = 4001;
const MAX_PORT = 65535;

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
 * Uses better-sqlite3 in WAL mode. The database file is created automatically
 * under ~/.hermes/hermes-hub.db (overridable via constructor for testing).
 */
export class Registry {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || DEFAULT_DB_PATH;

    // Ensure parent directory exists
    const dir = dirname(resolvedPath);
    mkdirSync(dir, { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
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
   * Register a new repo. Auto-assigns a port and detects name from directory
   * if not provided.
   */
  register(repoPath: string, name?: string): RepoEntry {
    const resolved = resolve(repoPath);

    // Check if already registered
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

  /** Update the running state of a repo. */
  updateStatus(id: string, status: RepoStatus, pid?: number | null): RepoEntry | null {
    const now = Date.now();
    const pidValue = pid !== undefined ? pid : null;

    // If stopping, clear the pid
    const effectivePid = status === 'stopped' ? null : pidValue;

    const result = this.db.prepare(`
      UPDATE repos SET status = ?, pid = ?, updatedAt = ? WHERE id = ?
    `).run(status, effectivePid, now, id);

    if (result.changes === 0) return null;
    return this.get(id);
  }

  /** Look up a repo by its filesystem path. */
  findByPath(repoPath: string): RepoEntry | null {
    const resolved = resolve(repoPath);
    const row = this.db.prepare('SELECT * FROM repos WHERE path = ?').get(resolved) as any;
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

  /** Close the database connection. */
  close(): void {
    this.db.close();
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
