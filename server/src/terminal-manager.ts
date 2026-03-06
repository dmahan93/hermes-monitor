import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import type { TerminalInfo, CreateTerminalOptions } from './types.js';

export type DataCallback = (terminalId: string, data: string) => void;
export type ExitCallback = (terminalId: string, exitCode: number) => void;

interface ManagedTerminal {
  info: TerminalInfo;
  process: pty.IPty;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private onDataCallbacks: DataCallback[] = [];
  private onExitCallbacks: ExitCallback[] = [];

  onData(cb: DataCallback): void {
    this.onDataCallbacks.push(cb);
  }

  onExit(cb: ExitCallback): void {
    this.onExitCallbacks.push(cb);
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

  create(options: CreateTerminalOptions = {}): TerminalInfo {
    const id = uuidv4();
    const shell = options.command || process.env.SHELL || '/bin/bash';
    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const title = options.title || `Terminal ${this.terminals.size + 1}`;

    const args = options.command ? [] : [];
    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME || '/tmp',
      env: process.env as Record<string, string>,
    });

    const info: TerminalInfo = {
      id,
      title,
      command: shell,
      cols,
      rows,
      pid: proc.pid,
      createdAt: Date.now(),
    };

    const managed: ManagedTerminal = { info, process: proc };
    this.terminals.set(id, managed);

    proc.onData((data: string) => {
      this.emitData(id, data);
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      this.terminals.delete(id);
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

  write(id: string, data: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    terminal.process.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    terminal.process.resize(cols, rows);
    terminal.info.cols = cols;
    terminal.info.rows = rows;
    return true;
  }

  kill(id: string): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    terminal.process.kill();
    this.terminals.delete(id);
    return true;
  }

  killAll(): void {
    for (const [id, terminal] of this.terminals) {
      terminal.process.kill();
    }
    this.terminals.clear();
  }

  get size(): number {
    return this.terminals.size;
  }
}
