import { describe, it, expect, afterEach } from 'vitest';
import { TerminalManager, detectPrompt } from '../src/terminal-manager.js';

describe('detectPrompt', () => {
  it('detects [Y/n] prompt', () => {
    expect(detectPrompt('Do you want to continue? [Y/n] ')).toBe(true);
  });

  it('detects [y/N] prompt', () => {
    expect(detectPrompt('Install packages? [y/N] ')).toBe(true);
  });

  it('detects [yes/no] prompt', () => {
    expect(detectPrompt('Overwrite file? [yes/no] ')).toBe(true);
  });

  it('detects (y/n) prompt', () => {
    expect(detectPrompt('Continue? (y/n) ')).toBe(true);
  });

  it('detects (yes/no) prompt', () => {
    expect(detectPrompt('Are you sure (yes/no)? ')).toBe(true);
  });

  it('detects password prompt', () => {
    expect(detectPrompt('[sudo] password for user: ')).toBe(true);
  });

  it('detects Password: prompt', () => {
    expect(detectPrompt('Password: ')).toBe(true);
  });

  it('detects passphrase prompt', () => {
    expect(detectPrompt("Enter passphrase for key '/home/user/.ssh/id_rsa': ")).toBe(true);
  });

  it('detects SSH fingerprint prompt', () => {
    expect(detectPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])? ')).toBe(true);
  });

  it('detects Continue? prompt', () => {
    expect(detectPrompt('Continue? ')).toBe(true);
  });

  it('detects Proceed? prompt', () => {
    expect(detectPrompt('Proceed? [Y/n] ')).toBe(true);
  });

  it('detects "press enter" prompt', () => {
    expect(detectPrompt('Press Enter to continue...')).toBe(true);
  });

  it('detects "press any key" prompt', () => {
    expect(detectPrompt('Press any key to exit')).toBe(true);
  });

  it('detects overwrite prompt', () => {
    expect(detectPrompt('overwrite file.txt? [y]es, [n]o, [A]ll: ')).toBe(true);
  });

  it('detects "do you want to continue" prompt', () => {
    expect(detectPrompt('Do you want to continue? ')).toBe(true);
  });

  it('does not match regular output', () => {
    expect(detectPrompt('Building project...\nCompiling 42 files')).toBe(false);
  });

  it('does not match empty output', () => {
    expect(detectPrompt('')).toBe(false);
  });

  it('does not match a normal command output line', () => {
    expect(detectPrompt('npm info using npm@10.2.0\nnpm info using node@v20.11.0\n')).toBe(false);
  });

  it('handles output with ANSI escape codes', () => {
    expect(detectPrompt('\x1b[1m\x1b[33mPassword:\x1b[0m ')).toBe(true);
  });

  it('handles multiline output and checks last non-empty line', () => {
    expect(detectPrompt('Some output\nMore output\nPassword: ')).toBe(true);
  });

  it('ignores trailing blank lines and checks last non-empty line', () => {
    expect(detectPrompt('Are you sure? [Y/n] \n\n')).toBe(true);
  });

  it('detects confirm prompt', () => {
    expect(detectPrompt('Please confirm: ')).toBe(true);
  });
});

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

  it('buffers scrollback data', async () => {
    manager = new TerminalManager();
    const term = manager.create();
    // Wait for shell prompt to generate some output
    await new Promise((r) => setTimeout(r, 500));
    const scrollback = manager.getScrollback(term.id);
    expect(scrollback).toBeDefined();
    expect(scrollback!.length).toBeGreaterThan(0);
  });

  it('returns undefined scrollback for nonexistent terminal', () => {
    manager = new TerminalManager();
    expect(manager.getScrollback('nope')).toBeUndefined();
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

  it('isAwaitingInput returns false for new terminal', () => {
    manager = new TerminalManager();
    const term = manager.create();
    expect(manager.isAwaitingInput(term.id)).toBe(false);
  });

  it('isAwaitingInput returns false for nonexistent terminal', () => {
    manager = new TerminalManager();
    expect(manager.isAwaitingInput('nonexistent')).toBe(false);
  });

  it('registers onAwaitingInput callbacks', () => {
    manager = new TerminalManager();
    const cb = () => {};
    // Should not throw
    manager.onAwaitingInput(cb);
  });

  it('write clears awaiting input state', async () => {
    manager = new TerminalManager();
    const events: { id: string; awaiting: boolean }[] = [];
    manager.onAwaitingInput((id, awaiting) => {
      events.push({ id, awaiting });
    });
    // Use a command that stays alive long enough for the debounce to fire
    const term = manager.create({ command: 'bash -c \'echo "Continue? [Y/n]"; sleep 10\'' });
    // Wait for the output + debounce to trigger detection
    await new Promise((r) => setTimeout(r, 3000));

    // The prompt should be detected while the process is still alive
    expect(manager.isAwaitingInput(term.id)).toBe(true);
    // Writing stdin should clear the awaiting input state
    manager.write(term.id, 'y\n');
    expect(manager.isAwaitingInput(term.id)).toBe(false);
    // Should have emitted a false event after the true
    const lastEvent = events[events.length - 1];
    expect(lastEvent.awaiting).toBe(false);
  });
});
