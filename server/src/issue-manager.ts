import { v4 as uuidv4 } from 'uuid';
import type { TerminalManager } from './terminal-manager.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { PRManager } from './pr-manager.js';
import type { Store } from './store.js';
import { getPreset } from './agents.js';
import { saveDiagnostics } from './diagnostics.js';
import { config } from './config.js';

// Re-export shared types so existing server imports continue to work.
export type { Issue, IssueStatus } from '@hermes-monitor/shared/types';
import type { Issue, IssueStatus } from '@hermes-monitor/shared/types';

// Auto-resume constants
const MAX_RESUME_ATTEMPTS = 3;       // max retries before giving up
const RESUME_DELAY_MS = 5000;        // wait 5s before resuming (avoid tight loops)
const RESUME_WINDOW_MS = 5 * 60000;  // reset attempt counter after 5 minutes of quiet

export type IssueEvent = 'issue:created' | 'issue:updated' | 'issue:deleted';


export interface CreateIssueOptions {
  title: string;
  description?: string;
  agent?: string;        // agent preset id, defaults to 'hermes'
  command?: string;      // override command (used with 'custom' agent)
  branch?: string;
  parentId?: string;     // create as subtask of this issue
}

export interface UpdateIssueOptions {
  title?: string;
  description?: string;
  command?: string;
  branch?: string;
  submitterNotes?: string;
}

export type IssueEventCallback = (event: IssueEvent, issue: Issue) => void;

/**
 * Manages the full issue lifecycle from backlog to done.
 *
 * **Key responsibilities:**
 * - CRUD operations on issues (create, update, delete, list, reorder).
 * - Orchestrates status transitions: backlog → todo → in_progress → review → done.
 *   Each transition triggers side effects via the collaborating managers:
 *   - `in_progress`: creates a git worktree ({@link WorktreeManager}), spawns an
 *     agent terminal ({@link TerminalManager}).
 *   - `review`: creates a pull request ({@link PRManager}).
 *   - `done`: removes the worktree (branch is preserved for history).
 * - Auto-resumes crashed agent terminals — watches for unexpected terminal exits
 *   and re-spawns the agent (up to {@link MAX_RESUME_ATTEMPTS} within a
 *   {@link RESUME_WINDOW_MS} window) with a brief delay to avoid tight loops.
 * - Fires event callbacks so the WebSocket layer can push updates to clients.
 *
 * **Persistence:** Issues are persisted to SQLite via {@link Store}. The in-memory
 * `Map<string, Issue>` is the authoritative runtime copy; changes are written
 * through to the store immediately. On startup, `loadFromStore()` hydrates the map.
 *
 * **Key lifecycle events:**
 * - `issue:created` — new issue added.
 * - `issue:updated` — any field or status change.
 * - `issue:deleted` — issue removed.
 */
export class IssueManager {
  private issues = new Map<string, Issue>();
  private terminalManager: TerminalManager;
  private worktreeManager: WorktreeManager | null = null;
  private prManager: PRManager | null = null;
  private store: Store | null = null;
  private eventCallbacks: IssueEventCallback[] = [];
  private repoPath: string | undefined;
  private resumeAttempts = new Map<string, { count: number; lastAttempt: number }>();
  private resumeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private resumeDelayMs = RESUME_DELAY_MS;
  private resumeWindowMs = RESUME_WINDOW_MS;
  private autoResumeActive = false;

  constructor(terminalManager: TerminalManager, repoPath?: string) {
    this.terminalManager = terminalManager;
    this.repoPath = repoPath;
  }

  setStore(store: Store): void {
    this.store = store;
  }

  /** Load issues from persistent store */
  loadFromStore(): void {
    if (!this.store) return;
    const issues = this.store.loadIssues();
    for (const issue of issues) {
      this.issues.set(issue.id, issue);
    }
  }

  private persist(issue: Issue): void {
    this.store?.saveIssue(issue);
  }

  private persistDelete(id: string): void {
    this.store?.deleteIssue(id);
  }

  /** Set managers after construction (avoids circular deps) */
  setWorktreeManager(wm: WorktreeManager): void {
    this.worktreeManager = wm;
  }

  setPRManager(pm: PRManager): void {
    this.prManager = pm;
  }

  onEvent(cb: IssueEventCallback): void {
    this.eventCallbacks.push(cb);
  }

  private emit(event: IssueEvent, issue: Issue): void {
    for (const cb of this.eventCallbacks) {
      cb(event, issue);
    }
  }

  /** Escape a string for safe use inside single-quoted shell arguments */
  private shellEscape(s: string): string {
    // Replace ' with '\'' (end quote, literal quote via \', start new quote)
    return s.replace(/'/g, "'\\''");
  }

  /** Interpolate {{var}} placeholders in command template (shell-safe) */
  interpolateCommand(template: string, issue: Issue): string {
    return template
      .replace(/\{\{id\}\}/g, this.shellEscape(issue.id))
      .replace(/\{\{title\}\}/g, this.shellEscape(issue.title))
      .replace(/\{\{description\}\}/g, this.shellEscape(issue.description))
      .replace(/\{\{branch\}\}/g, this.shellEscape(issue.branch || ''));
  }

  create(options: CreateIssueOptions): Issue {
    // Validate parent exists if parentId is specified, and prevent nested subtasks
    if (options.parentId) {
      const parent = this.issues.get(options.parentId);
      if (!parent) {
        throw new Error(`Parent issue ${options.parentId} not found`);
      }
      if (parent.parentId) {
        throw new Error('Cannot create a subtask of a subtask');
      }
    }

    const id = uuidv4();
    const now = Date.now();
    const agentId = options.agent || 'hermes';
    const preset = getPreset(agentId);
    // Use custom command if provided, otherwise use preset's command template
    const command = options.command || preset?.command || '';
    const issue: Issue = {
      id,
      title: options.title,
      description: options.description || '',
      status: 'backlog',
      agent: agentId,
      command,
      terminalId: null,
      branch: options.branch || null,
      parentId: options.parentId || null,
      createdAt: now,
      updatedAt: now,
    };
    this.issues.set(id, issue);
    this.persist(issue);
    this.emit('issue:created', issue);
    return issue;
  }

  list(): Issue[] {
    return Array.from(this.issues.values());
  }

  get(id: string): Issue | undefined {
    return this.issues.get(id);
  }

  /** Get all direct subtasks of an issue */
  getSubtasks(parentId: string): Issue[] {
    return Array.from(this.issues.values()).filter((i) => i.parentId === parentId);
  }

  /** Get the parent issue of a subtask */
  getParent(id: string): Issue | undefined {
    const issue = this.issues.get(id);
    if (!issue?.parentId) return undefined;
    return this.issues.get(issue.parentId);
  }

  update(id: string, options: UpdateIssueOptions): Issue | undefined {
    const issue = this.issues.get(id);
    if (!issue) return undefined;

    if (options.title !== undefined) issue.title = options.title;
    if (options.description !== undefined) issue.description = options.description;
    if (options.command !== undefined) issue.command = options.command;
    if (options.branch !== undefined) issue.branch = options.branch;
    if (options.submitterNotes !== undefined) issue.submitterNotes = options.submitterNotes;
    issue.updatedAt = Date.now();

    this.persist(issue);
    this.emit('issue:updated', issue);
    return issue;
  }

  changeStatus(id: string, newStatus: IssueStatus): Issue | undefined {
    const issue = this.issues.get(id);
    if (!issue) return undefined;

    const oldStatus = issue.status;
    if (oldStatus === newStatus) return issue;

    // Guard: cannot mark parent as done while subtasks are still open
    if (newStatus === 'done' && !issue.parentId) {
      const openSubtasks = this.getSubtasks(id).filter((s) => s.status !== 'done');
      if (openSubtasks.length > 0) {
        const count = openSubtasks.length;
        throw new Error(`Cannot mark as done — ${count} subtask${count > 1 ? 's' : ''} still open`);
      }
    }

    issue.status = newStatus;
    issue.updatedAt = Date.now();

    // Status transition side effects
    this.handleTransition(issue, oldStatus, newStatus);

    this.persist(issue);
    this.emit('issue:updated', issue);
    return issue;
  }

  private handleTransition(issue: Issue, from: IssueStatus, to: IssueStatus): void {
    // Reset resume attempts on any status transition — a fresh start gets fresh retries
    this.resetResumeAttempts(issue.id);

    // Kill planning terminal when leaving backlog.
    // This must happen before the in_progress spawn logic below so the planning
    // terminal is cleaned up before an agent terminal is created.
    if (from === 'backlog' && issue.terminalId) {
      this.terminalManager.kill(issue.terminalId);
      issue.terminalId = null;
    }

    // Reset PR verdict when moving back to in_progress so it doesn't show stale status
    if (to === 'in_progress' && this.prManager) {
      const existingPr = this.prManager.getByIssueId(issue.id);
      if (existingPr) {
        this.prManager.resetToOpen(existingPr.id);
      }
    }

    // Spawn terminal + worktree when moving TO in_progress
    if (to === 'in_progress' && !issue.terminalId) {
      let cwd: string | undefined;

      // Create worktree if we have a worktree manager
      if (this.worktreeManager) {
        try {
          const worktree = this.worktreeManager.create(issue.id, issue.title);
          issue.branch = worktree.branch;
          cwd = worktree.path;
        } catch (err) {
          console.error('Failed to create worktree:', err);
        }
      }

      const command = issue.command
        ? this.interpolateCommand(issue.command, issue)
        : undefined;

      const terminal = this.terminalManager.create({
        title: issue.title,
        command,
        cwd,
      });
      issue.terminalId = terminal.id;
    }

    // Create PR + spawn reviewer when moving TO review
    if (to === 'review' && this.prManager) {
      const existingPr = this.prManager.getByIssueId(issue.id);
      if (!existingPr) {
        const pr = this.prManager.create({
          issueId: issue.id,
          title: issue.title,
          description: issue.description,
          submitterNotes: issue.submitterNotes,
        });
        if (pr) {
          // Spawn adversarial reviewer
          this.prManager.spawnReviewer(pr.id);
        }
      } else {
        // PR already exists (e.g. review → in_progress → review cycle)
        // Relaunch the review to pick up new changes + updated submitter notes
        this.prManager.relaunchReview(existingPr.id, issue.submitterNotes);
      }
    }

    // Kill terminal when moving TO backlog, todo, review, or done
    if ((to === 'backlog' || to === 'todo' || to === 'review' || to === 'done') && issue.terminalId) {
      this.terminalManager.kill(issue.terminalId);
      issue.terminalId = null;
    }

    // Clean up worktree when moving to done (after merge)
    if (to === 'done' && this.worktreeManager) {
      this.worktreeManager.remove(issue.id, false); // keep branch for history
    }
  }

  /** Start a planning agent terminal for a backlog issue */
  startPlanning(id: string): Issue | undefined {
    const issue = this.issues.get(id);
    if (!issue || issue.status !== 'backlog') return undefined;
    if (issue.terminalId) return issue; // already has a planning terminal

    // Resolve the planning command from the issue's agent preset
    const preset = getPreset(issue.agent);
    const planningTemplate = preset?.planningCommand || '';
    const command = planningTemplate
      ? this.interpolateCommand(planningTemplate, issue)
      : undefined;

    const terminal = this.terminalManager.create({
      title: `[plan] ${issue.title}`,
      command,
      cwd: this.repoPath,
    });
    issue.terminalId = terminal.id;
    issue.updatedAt = Date.now();

    this.persist(issue);
    this.emit('issue:updated', issue);
    return issue;
  }

  /** Stop the planning terminal for a backlog issue */
  stopPlanning(id: string): Issue | undefined {
    const issue = this.issues.get(id);
    if (!issue || issue.status !== 'backlog') return undefined;
    if (!issue.terminalId) return issue;

    this.terminalManager.kill(issue.terminalId);
    issue.terminalId = null;
    issue.updatedAt = Date.now();

    this.persist(issue);
    this.emit('issue:updated', issue);
    return issue;
  }

  delete(id: string): boolean {
    const issue = this.issues.get(id);
    if (!issue) return false;

    // Cascade delete subtasks first
    const subtasks = this.getSubtasks(id);
    for (const sub of subtasks) {
      this.delete(sub.id);
    }

    // Clean up resume state
    this.resetResumeAttempts(id);

    // Kill associated terminal if any
    if (issue.terminalId) {
      this.terminalManager.kill(issue.terminalId);
    }

    // Clean up worktree if the issue had one
    if (this.worktreeManager) {
      try {
        this.worktreeManager.remove(id, false); // keep branch for history
      } catch {
        // Worktree may not exist (e.g. never moved to in_progress) — ignore
      }
    }

    this.issues.delete(id);
    this.persistDelete(id);
    this.emit('issue:deleted', issue);
    return true;
  }

  get size(): number {
    return this.issues.size;
  }

  // ── Auto-resume ──

  /**
   * Register an onExit handler on the terminal manager to detect when agent
   * terminals exit unexpectedly (i.e., the agent decides to stop or crashes)
   * while the issue is still in_progress. Automatically respawns the terminal
   * after a short delay, with retry limits to prevent infinite loops.
   */
  setupAutoResume(): void {
    if (this.autoResumeActive) return;
    this.autoResumeActive = true;
    this.terminalManager.onExit((terminalId, exitCode) => {
      this.handleAgentExit(terminalId, exitCode);
    });
  }

  /**
   * Handle a terminal exit event. Determines if this was an agent that
   * stopped prematurely and should be resumed.
   */
  private handleAgentExit(terminalId: string, exitCode: number): void {
    // Key insight: when a terminal is killed intentionally (via kill()),
    // it's removed from the TerminalManager map BEFORE onExit fires.
    // So if the terminal is still in the map, it was a natural exit.
    const terminalInfo = this.terminalManager.get(terminalId);
    if (!terminalInfo) return; // Killed intentionally (review, status change, etc.)

    // Find the issue that owns this terminal
    const issue = this.findIssueByTerminalId(terminalId);
    if (!issue) return; // Not an issue terminal (maybe a planning or orphan terminal)

    // Only auto-resume in_progress issues
    if (issue.status !== 'in_progress') return;

    // Capture scrollback before any cleanup — needed for both diagnostics and logging
    const scrollback = this.terminalManager.getScrollback(terminalId);

    // Save diagnostic log for post-mortem analysis (always, regardless of resume)
    try {
      const logPath = saveDiagnostics({
        issueId: issue.id,
        issueTitle: issue.title,
        branch: issue.branch,
        exitCode,
        scrollback: scrollback || '',
        diagnosticsBase: config.diagnosticsBase,
      });
      console.log(`[diagnostics] Saved exit log: ${logPath}`);
    } catch (err) {
      console.error('[diagnostics] Failed to save exit log:', err);
    }

    // Check resume attempts (with sliding window)
    const attempts = this.getOrCreateResumeAttempts(issue.id);
    if (Date.now() - attempts.lastAttempt > this.resumeWindowMs) {
      attempts.count = 0; // Reset counter after quiet period
    }

    if (attempts.count >= MAX_RESUME_ATTEMPTS) {
      console.log(
        `[auto-resume] Max retries (${MAX_RESUME_ATTEMPTS}) reached for "${issue.title}" — not resuming`
      );
      return;
    }

    // Log last few lines of terminal output for debugging
    if (scrollback) {
      const lastLines = scrollback.split('\n').filter(Boolean).slice(-10).join('\n');
      if (lastLines) {
        console.log(`[auto-resume] Last output from "${issue.title}":\n${lastLines}`);
      }
    }

    console.log(
      `[auto-resume] Agent exited (code ${exitCode}) for "${issue.title}" — ` +
      `resuming in ${this.resumeDelayMs / 1000}s (attempt ${attempts.count + 1}/${MAX_RESUME_ATTEMPTS})`
    );

    // Clear any existing timer for this issue (shouldn't happen, but be safe)
    const existingTimer = this.resumeTimers.get(issue.id);
    if (existingTimer) clearTimeout(existingTimer);

    // Schedule resume after delay
    const timer = setTimeout(() => {
      this.resumeTimers.delete(issue.id);
      this.performResume(issue.id, terminalId);
    }, this.resumeDelayMs);
    this.resumeTimers.set(issue.id, timer);
  }

  /** Find an issue by its current terminalId */
  private findIssueByTerminalId(terminalId: string): Issue | undefined {
    return Array.from(this.issues.values()).find(
      (issue) => issue.terminalId === terminalId
    );
  }

  /** Get or create resume attempt tracking for an issue */
  private getOrCreateResumeAttempts(issueId: string): { count: number; lastAttempt: number } {
    let attempts = this.resumeAttempts.get(issueId);
    if (!attempts) {
      attempts = { count: 0, lastAttempt: 0 };
      this.resumeAttempts.set(issueId, attempts);
    }
    return attempts;
  }

  /**
   * Actually perform the resume: clean up the old terminal, spawn a new one.
   * Re-checks state in case things changed during the delay.
   */
  private performResume(issueId: string, oldTerminalId: string): void {
    const issue = this.issues.get(issueId);
    if (!issue) return;

    // Re-check: status may have changed during the delay (e.g., user moved to done)
    if (issue.status !== 'in_progress') return;

    // Re-check: terminalId may have changed (e.g., user manually restarted)
    if (issue.terminalId !== oldTerminalId) return;

    // Clean up the old (exited) terminal from the manager
    this.terminalManager.kill(oldTerminalId);

    // Track the attempt
    const attempts = this.getOrCreateResumeAttempts(issue.id);
    attempts.count++;
    attempts.lastAttempt = Date.now();

    // Get worktree path for cwd
    let cwd: string | undefined;
    if (this.worktreeManager) {
      const worktree = this.worktreeManager.get(issue.id);
      if (worktree) {
        cwd = worktree.path;
      }
    }

    // Spawn a new terminal with the same command
    const command = issue.command
      ? this.interpolateCommand(issue.command, issue)
      : undefined;
    const terminal = this.terminalManager.create({
      title: issue.title,
      command,
      cwd,
    });

    issue.terminalId = terminal.id;
    issue.updatedAt = Date.now();

    this.persist(issue);
    this.emit('issue:updated', issue);

    console.log(`[auto-resume] Resumed "${issue.title}" with new terminal ${terminal.id}`);
  }

  /** Reset resume attempt tracking for an issue (e.g., on status change) */
  private resetResumeAttempts(issueId: string): void {
    this.resumeAttempts.delete(issueId);
    const timer = this.resumeTimers.get(issueId);
    if (timer) {
      clearTimeout(timer);
      this.resumeTimers.delete(issueId);
    }
  }

  /** Clean up all pending resume timers (call on shutdown) */
  clearResumeTimers(): void {
    this.resumeTimers.forEach((timer) => clearTimeout(timer));
    this.resumeTimers.clear();
  }

  /** Override resume delay (for testing) */
  setResumeDelay(ms: number): void {
    this.resumeDelayMs = ms;
  }

  /** Override resume window (for testing) */
  setResumeWindow(ms: number): void {
    this.resumeWindowMs = ms;
  }
}
