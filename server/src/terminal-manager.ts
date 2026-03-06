import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import type { TerminalInfo, CreateTerminalOptions } from './types.js';

export type DataCallback = (terminalId: string, data: string) => void;
export type ExitCallback = (terminalId: string, exitCode: number) => void;
export type RemoveCallback = (terminalId: string) => void;

const SCROLLBACK_LIMIT = 50000; // chars to buffer per terminal

interface ManagedTerminal {
  info: TerminalInfo;
  process: pty.IPty;
  scrollback: string;
  exited: boolean;
  exitCode: number | null;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private onDataCallbacks: DataCallback[] = [];
  private onExitCallbacks: ExitCallback[] = [];
  private onRemoveCallbacks: RemoveCallback[] = [];

  onData(cb: DataCallback): void {
    this.onDataCallbacks.push(cb);
  }

  onExit(cb: ExitCallback): void {
    this.onExitCallbacks.push(cb);
  }

  onRemove(cb: RemoveCallback): void {
    this.onRemoveCallbacks.push(cb);
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

  private emitRemove(terminalId: string): void {
    for (const cb of this.onRemoveCallbacks) {
      cb(terminalId);
    }
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

    const managed: ManagedTerminal = { info, process: proc, scrollback: '', exited: false, exitCode: null };
    this.terminals.set(id, managed);

    proc.onData((data: string) => {
      // Buffer scrollback for late-joining clients
      managed.scrollback += data;
      if (managed.scrollback.length > SCROLLBACK_LIMIT) {
        managed.scrollback = managed.scrollback.slice(-SCROLLBACK_LIMIT);
      }
      this.emitData(id, data);
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      // Don't remove — keep terminal visible so user can see output.
      // Terminal will be removed when explicitly killed/closed.
      managed.exited = true;
      managed.exitCode = exitCode;
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

  write(id: string, data: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.exited) return false;
    terminal.process.write(data);
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
    if (!terminal.exited) {
      terminal.process.kill();
    }
    this.terminals.delete(id);
    this.emitRemove(id);
    return true;
  }

  killAll(): void {
    this.terminals.forEach((terminal, id) => {
      if (!terminal.exited) {
        terminal.process.kill();
      }
      this.emitRemove(id);
    });
    this.terminals.clear();
  }

  get size(): number {
    return this.terminals.size;
  }
}
