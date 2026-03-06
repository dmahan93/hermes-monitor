import { v4 as uuidv4 } from 'uuid';
import type { TerminalManager } from './terminal-manager.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { PRManager } from './pr-manager.js';
import type { Store } from './store.js';
import { getPreset } from './agents.js';

export type IssueStatus = 'todo' | 'in_progress' | 'review' | 'done';

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  agent: string;        // agent preset id
  command: string;       // resolved command (from preset or custom)
  terminalId: string | null;
  branch: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateIssueOptions {
  title: string;
  description?: string;
  agent?: string;        // agent preset id, defaults to 'hermes'
  command?: string;      // override command (used with 'custom' agent)
  branch?: string;
}

export interface UpdateIssueOptions {
  title?: string;
  description?: string;
  command?: string;
  branch?: string;
}

export type IssueEventCallback = (event: string, issue: Issue) => void;

export class IssueManager {
  private issues = new Map<string, Issue>();
  private terminalManager: TerminalManager;
  private worktreeManager: WorktreeManager | null = null;
  private prManager: PRManager | null = null;
  private store: Store | null = null;
  private eventCallbacks: IssueEventCallback[] = [];

  constructor(terminalManager: TerminalManager) {
    this.terminalManager = terminalManager;
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

  private emit(event: string, issue: Issue): void {
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
      status: 'todo',
      agent: agentId,
      command,
      terminalId: null,
      branch: options.branch || null,
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

  update(id: string, options: UpdateIssueOptions): Issue | undefined {
    const issue = this.issues.get(id);
    if (!issue) return undefined;

    if (options.title !== undefined) issue.title = options.title;
    if (options.description !== undefined) issue.description = options.description;
    if (options.command !== undefined) issue.command = options.command;
    if (options.branch !== undefined) issue.branch = options.branch;
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

    issue.status = newStatus;
    issue.updatedAt = Date.now();

    // Status transition side effects
    this.handleTransition(issue, oldStatus, newStatus);

    this.persist(issue);
    this.emit('issue:updated', issue);
    return issue;
  }

  private handleTransition(issue: Issue, from: IssueStatus, to: IssueStatus): void {
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
        });
        if (pr) {
          // Spawn adversarial reviewer
          this.prManager.spawnReviewer(pr.id);
        }
      }
    }

    // Kill terminal when moving TO todo or done
    if ((to === 'todo' || to === 'done') && issue.terminalId) {
      this.terminalManager.kill(issue.terminalId);
      issue.terminalId = null;
    }

    // Clean up worktree when moving to done (after merge)
    if (to === 'done' && this.worktreeManager) {
      this.worktreeManager.remove(issue.id, false); // keep branch for history
    }
  }

  delete(id: string): boolean {
    const issue = this.issues.get(id);
    if (!issue) return false;

    // Kill associated terminal if any
    if (issue.terminalId) {
      this.terminalManager.kill(issue.terminalId);
    }

    this.issues.delete(id);
    this.persistDelete(id);
    this.emit('issue:deleted', issue);
    return true;
  }

  get size(): number {
    return this.issues.size;
  }
}
