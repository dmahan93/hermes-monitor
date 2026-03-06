import { describe, it, expect, afterEach } from 'vitest';
import { TerminalManager } from '../src/terminal-manager.js';

describe('TerminalManager', () => {
  let manager: TerminalManager;

  afterEach(() => {
    manager?.killAll();
  });

  it('spawns a terminal with default shell', () => {
    manager = new TerminalManager();
    const term = manager.create();
    expect(term.id).toBeTruthy();
    expect(term.pid).toBeGreaterThan(0);
    expect(term.cols).toBe(80);
    expect(term.rows).toBe(24);
    expect(term.title).toBe('Terminal 1');
    expect(term.createdAt).toBeGreaterThan(0);
  });

  it('spawns a terminal with custom command', () => {
    manager = new TerminalManager();
    const term = manager.create({ command: '/bin/sh' });
    expect(term.command).toBe('/bin/sh');
    expect(term.pid).toBeGreaterThan(0);
  });

  it('spawns a terminal with custom title and dimensions', () => {
    manager = new TerminalManager();
    const term = manager.create({ title: 'Agent 1', cols: 120, rows: 40 });
    expect(term.title).toBe('Agent 1');
    expect(term.cols).toBe(120);
    expect(term.rows).toBe(40);
  });

  it('lists all active terminals', () => {
    manager = new TerminalManager();
    manager.create({ title: 'T1' });
    manager.create({ title: 'T2' });
    manager.create({ title: 'T3' });
    const list = manager.list();
    expect(list).toHaveLength(3);
    expect(list.map((t) => t.title)).toEqual(['T1', 'T2', 'T3']);
  });

  it('gets a terminal by id', () => {
    manager = new TerminalManager();
    const term = manager.create({ title: 'findme' });
    const found = manager.get(term.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe('findme');
  });

  it('returns undefined for nonexistent terminal', () => {
    manager = new TerminalManager();
    expect(manager.get('nonexistent')).toBeUndefined();
  });

  it('kills a terminal', () => {
    manager = new TerminalManager();
    const term = manager.create();
    expect(manager.size).toBe(1);
    const killed = manager.kill(term.id);
    expect(killed).toBe(true);
    expect(manager.size).toBe(0);
    expect(manager.get(term.id)).toBeUndefined();
  });

  it('resizes a terminal', () => {
    manager = new TerminalManager();
    const term = manager.create({ cols: 80, rows: 24 });
    const resized = manager.resize(term.id, 120, 40);
    expect(resized).toBe(true);
    const info = manager.get(term.id);
    expect(info!.cols).toBe(120);
    expect(info!.rows).toBe(40);
  });

  it('emits data events from PTY', async () => {
    manager = new TerminalManager();
    const received: string[] = [];
    manager.onData((_id, data) => {
      received.push(data);
    });
    const term = manager.create({ command: '/bin/echo', });
    // echo will output and exit quickly — give it a moment
    await new Promise((r) => setTimeout(r, 500));
    // We should have received some data (at least the echo output or shell prompt)
    expect(received.length).toBeGreaterThan(0);
  });

  it('emits exit events', async () => {
    manager = new TerminalManager();
    let exitInfo: { id: string; code: number } | null = null;
    manager.onExit((id, code) => {
      exitInfo = { id, code };
    });
    // Spawn a command that exits immediately
    const term = manager.create({ command: '/bin/true' });
    await new Promise((r) => setTimeout(r, 1000));
    expect(exitInfo).not.toBeNull();
    expect(exitInfo!.id).toBe(term.id);
  });

  it('writes stdin to PTY', () => {
    manager = new TerminalManager();
    const term = manager.create();
    const ok = manager.write(term.id, 'echo hello\n');
    expect(ok).toBe(true);
  });

  it('handles killing nonexistent terminal gracefully', () => {
    manager = new TerminalManager();
    const result = manager.kill('doesnotexist');
    expect(result).toBe(false);
  });

  it('cleans up all terminals on killAll', () => {
    manager = new TerminalManager();
    manager.create({ title: 'A' });
    manager.create({ title: 'B' });
    manager.create({ title: 'C' });
    expect(manager.size).toBe(3);
    manager.killAll();
    expect(manager.size).toBe(0);
  });
});
