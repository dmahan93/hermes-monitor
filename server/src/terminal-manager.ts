import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import type { TerminalInfo, CreateTerminalOptions } from './types.js';

export type DataCallback = (terminalId: string, data: string) => void;
export type ExitCallback = (terminalId: string, exitCode: number) => void;
export type AwaitingInputCallback = (terminalId: string, awaitingInput: boolean) => void;

const SCROLLBACK_LIMIT = 50000; // chars to buffer per terminal
const INPUT_CHECK_DELAY_MS = 1500; // wait this long after last output before checking for prompts

// Strip ANSI escape sequences from terminal output
function stripAnsi(str: string): string {
  // ESC[ ... letter  (CSI sequences)
  // ESC] ... BEL/ST  (OSC sequences)
  // ESC followed by single char (simple escapes like ESC(B)
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\r/g, '');
}

// Patterns that strongly indicate the terminal is awaiting user input
const PROMPT_PATTERNS: RegExp[] = [
  /\[y(?:es)?\/n(?:o)?\]/i,           // [Y/n], [y/N], [yes/no]
  /\(y(?:es)?\/n(?:o)?\)/i,           // (y/n), (yes/no)
  /password.*:\s*$/i,                  // Password:, password for user:
  /passphrase.*:\s*$/i,                // Enter passphrase for key:
  /\bconfirm\b.*:\s*$/i,              // Confirm:, Please confirm:
  /continue\s*\?\s*(\[.*\])?\s*$/i,   // Continue? [Y/n]
  /proceed\s*\?\s*(\[.*\])?\s*$/i,    // Proceed? [Y/n]
  /press enter/i,                      // Press Enter to continue
  /press any key/i,                    // Press any key
  /are you sure/i,                     // Are you sure?
  /\(yes\/no(?:\/\[fingerprint\])?\)/i, // SSH: (yes/no/[fingerprint])
  /overwrite.*\?/i,                    // overwrite file.txt? [y/n]
  /do you want to continue/i,         // Do you want to continue?
  /\[y\]es.*\[n\]o/i,                 // [y]es, [n]o, [A]ll
  /enter (?:a |the )?(?:value|name|number|choice)/i, // Enter a value:
];

/**
 * Check if the last line of output looks like an input prompt.
 * Examines the last non-empty line after stripping ANSI codes.
 */
export function detectPrompt(scrollback: string): boolean {
  const clean = stripAnsi(scrollback);
  // Get the last non-empty line (or partial line if no newline at end)
  const lines = clean.split('\n');
  let lastLine = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 0) {
      lastLine = trimmed;
      break;
    }
  }
  if (!lastLine) return false;
  return PROMPT_PATTERNS.some((pattern) => pattern.test(lastLine));
}

interface ManagedTerminal {
  info: TerminalInfo;
  process: pty.IPty;
  scrollback: string;
  exited: boolean;
  exitCode: number | null;
  awaitingInput: boolean;
  inputCheckTimer: ReturnType<typeof setTimeout> | null;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private onDataCallbacks: DataCallback[] = [];
  private onExitCallbacks: ExitCallback[] = [];
  private onAwaitingInputCallbacks: AwaitingInputCallback[] = [];

  onData(cb: DataCallback): void {
    this.onDataCallbacks.push(cb);
  }

  onExit(cb: ExitCallback): void {
    this.onExitCallbacks.push(cb);
  }

  onAwaitingInput(cb: AwaitingInputCallback): void {
    this.onAwaitingInputCallbacks.push(cb);
  }

  private emitData(terminalId: string, data: string): void {
    for (const cb of this.onDataCallbacks) {
      cb(terminalId, data);
    }
  }

  private emitExit(terminalId: string, exitCode: number): void {
    for (const cb of this.onExitCallbacks) {
      cb(terminalId, exitCode);
    }
  }

  private emitAwaitingInput(terminalId: string, awaitingInput: boolean): void {
    for (const cb of this.onAwaitingInputCallbacks) {
      cb(terminalId, awaitingInput);
    }
  }

  private setAwaitingInput(managed: ManagedTerminal, awaiting: boolean): void {
    if (managed.awaitingInput !== awaiting) {
      managed.awaitingInput = awaiting;
      this.emitAwaitingInput(managed.info.id, awaiting);
    }
  }

  private schedulePromptCheck(managed: ManagedTerminal): void {
    // Clear any existing timer
    if (managed.inputCheckTimer) {
      clearTimeout(managed.inputCheckTimer);
    }
    // After output settles, check if the last line looks like a prompt
    managed.inputCheckTimer = setTimeout(() => {
      if (managed.exited) return;
      const isPrompt = detectPrompt(managed.scrollback);
      this.setAwaitingInput(managed, isPrompt);
    }, INPUT_CHECK_DELAY_MS);
  }

  create(options: CreateTerminalOptions = {}): TerminalInfo {
    const id = uuidv4();
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const title = options.title || `Terminal ${this.terminals.size + 1}`;
    const defaultShell = process.env.SHELL || '/bin/bash';

    // If a command is provided, run it through bash -c so the full command
    // line (with args, pipes, quotes, etc.) works correctly.
    // Otherwise just spawn an interactive shell.
    const shell = options.command ? defaultShell : defaultShell;
    const args = options.command ? ['-c', options.command] : [];

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: options.cwd || process.env.HOME || '/tmp',
      env: process.env as Record<string, string>,
    });

    const info: TerminalInfo = {
      id,
      title,
      command: options.command || defaultShell,
      cols,
      rows,
      pid: proc.pid,
      createdAt: Date.now(),
    };

    const managed: ManagedTerminal = {
      info,
      process: proc,
      scrollback: '',
      exited: false,
      exitCode: null,
      awaitingInput: false,
      inputCheckTimer: null,
    };
    this.terminals.set(id, managed);

    proc.onData((data: string) => {
      // Buffer scrollback for late-joining clients
      managed.scrollback += data;
      if (managed.scrollback.length > SCROLLBACK_LIMIT) {
        managed.scrollback = managed.scrollback.slice(-SCROLLBACK_LIMIT);
      }
      this.emitData(id, data);

      // If we were awaiting input, new output means the prompt was answered
      if (managed.awaitingInput) {
        this.setAwaitingInput(managed, false);
      }
      // Schedule a debounced check for prompt patterns
      this.schedulePromptCheck(managed);
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      // Don't remove — keep terminal visible so user can see output.
      // Terminal will be removed when explicitly killed/closed.
      managed.exited = true;
      managed.exitCode = exitCode;
      // Clear any pending prompt check
      if (managed.inputCheckTimer) {
        clearTimeout(managed.inputCheckTimer);
        managed.inputCheckTimer = null;
      }
      // If we were awaiting input, process exit clears it
      if (managed.awaitingInput) {
        this.setAwaitingInput(managed, false);
      }
      this.emitExit(id, exitCode);
    });

    return info;
  }

  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map((t) => t.info);
  }

  get(id: string): TerminalInfo | undefined {
    return this.terminals.get(id)?.info;
  }

  getScrollback(id: string): string | undefined {
    return this.terminals.get(id)?.scrollback;
  }

  isAwaitingInput(id: string): boolean {
    return this.terminals.get(id)?.awaitingInput ?? false;
  }

  write(id: string, data: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.exited) return false;
    terminal.process.write(data);
    // User is typing — clear awaiting input state
    if (terminal.awaitingInput) {
      this.setAwaitingInput(terminal, false);
    }
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.exited) return false;
    terminal.process.resize(cols, rows);
    terminal.info.cols = cols;
    terminal.info.rows = rows;
    return true;
  }

  kill(id: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    if (terminal.inputCheckTimer) {
      clearTimeout(terminal.inputCheckTimer);
    }
    terminal.process.kill();
    this.terminals.delete(id);
    return true;
  }

  killAll(): void {
    this.terminals.forEach((terminal) => {
      if (terminal.inputCheckTimer) {
        clearTimeout(terminal.inputCheckTimer);
      }
      terminal.process.kill();
    });
    this.terminals.clear();
  }

  get size(): number {
    return this.terminals.size;
  }
}
