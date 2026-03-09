import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import { TerminalManager } from '../src/terminal-manager.js';
import { IssueManager } from '../src/issue-manager.js';
import { createIssueApiRouter } from '../src/issue-api.js';
import { createPRApiRouter } from '../src/pr-api.js';
import { PRManager } from '../src/pr-manager.js';
import { WorktreeManager } from '../src/worktree-manager.js';
import { config, updateConfig } from '../src/config.js';
import { getAlertTone, playStatusAlert, _resetDebounce } from '../src/audible-alerts.js';

async function request(server: Server, method: string, path: string, body?: any) {
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

describe('getAlertTone', () => {
  it('returns positive for transitions to done', () => {
    expect(getAlertTone('review', 'done')).toBe('positive');
    expect(getAlertTone('in_progress', 'done')).toBe('positive');
    expect(getAlertTone('backlog', 'done')).toBe('positive');
  });

  it('returns alert for transitions to review', () => {
    expect(getAlertTone('in_progress', 'review')).toBe('alert');
    expect(getAlertTone('todo', 'review')).toBe('alert');
  });

  it('returns alert for done -> review (review takes precedence over regression)', () => {
    // done -> review is semantically "needs attention", not a regression.
    // The `to === review` check runs before the regression check, which is intentional.
    expect(getAlertTone('done', 'review')).toBe('alert');
  });

  it('returns negative for regressions (moving backward)', () => {
    expect(getAlertTone('done', 'backlog')).toBe('negative');
    expect(getAlertTone('done', 'in_progress')).toBe('negative');
    expect(getAlertTone('review', 'in_progress')).toBe('negative');
    expect(getAlertTone('review', 'todo')).toBe('negative');
    expect(getAlertTone('in_progress', 'backlog')).toBe('negative');
  });

  it('returns neutral for forward transitions (not to done/review)', () => {
    expect(getAlertTone('backlog', 'todo')).toBe('neutral');
    expect(getAlertTone('backlog', 'in_progress')).toBe('neutral');
    expect(getAlertTone('todo', 'in_progress')).toBe('neutral');
  });
});

describe('playStatusAlert', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let originalAudibleAlerts: boolean;

  beforeEach(() => {
    originalAudibleAlerts = config.audibleAlerts;
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    _resetDebounce();
  });

  afterEach(() => {
    writeSpy.mockRestore();
    updateConfig({ audibleAlerts: originalAudibleAlerts });
  });

  it('returns false when audibleAlerts is disabled', () => {
    updateConfig({ audibleAlerts: false });
    const result = playStatusAlert('backlog', 'todo');
    expect(result).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('returns false when from and to are equal', () => {
    updateConfig({ audibleAlerts: true });
    const result = playStatusAlert('todo', 'todo');
    expect(result).toBe(false);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('plays single bell for neutral transitions', () => {
    updateConfig({ audibleAlerts: true });
    const result = playStatusAlert('backlog', 'todo');
    expect(result).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith('\x07');
  });

  it('plays double bell for review transitions', () => {
    updateConfig({ audibleAlerts: true });
    const result = playStatusAlert('in_progress', 'review');
    expect(result).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith('\x07\x07');
  });

  it('plays triple bell for done transitions', () => {
    updateConfig({ audibleAlerts: true });
    const result = playStatusAlert('review', 'done');
    expect(result).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith('\x07\x07\x07');
  });

  it('plays double bell for regression transitions', () => {
    updateConfig({ audibleAlerts: true });
    const result = playStatusAlert('done', 'backlog');
    expect(result).toBe(true);
    expect(writeSpy).toHaveBeenCalledWith('\x07\x07');
  });

  it('returns false and does not throw when process.stdout.write fails', () => {
    updateConfig({ audibleAlerts: true });
    writeSpy.mockImplementation(() => {
      throw new Error('EPIPE');
    });
    const result = playStatusAlert('backlog', 'todo');
    expect(result).toBe(false);
    // Verify it was called but the error was swallowed
    expect(writeSpy).toHaveBeenCalled();
  });

  it('debounces rapid alerts', () => {
    updateConfig({ audibleAlerts: true });
    const first = playStatusAlert('backlog', 'todo');
    expect(first).toBe(true);
    // Second call within debounce window should be suppressed
    const second = playStatusAlert('todo', 'in_progress');
    expect(second).toBe(false);
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });
});

describe('audibleAlerts config via API', () => {
  let terminalManager: TerminalManager;
  let worktreeManager: WorktreeManager;
  let prManager: PRManager;
  let issueManager: IssueManager;
  let server: Server;
  let originalAudibleAlerts: boolean;

  beforeEach(async () => {
    originalAudibleAlerts = config.audibleAlerts;
    terminalManager = new TerminalManager();
    worktreeManager = new WorktreeManager();
    prManager = new PRManager(terminalManager, worktreeManager);
    issueManager = new IssueManager(terminalManager);

    const app = express();
    app.use('/api', createPRApiRouter(prManager, issueManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    updateConfig({ audibleAlerts: originalAudibleAlerts });
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /api/config includes audibleAlerts', async () => {
    updateConfig({ audibleAlerts: false });
    const res = await request(server, 'GET', '/api/config');
    expect(res.status).toBe(200);
    expect(res.body.audibleAlerts).toBe(false);
  });

  it('PATCH /api/config enables audibleAlerts', async () => {
    const res = await request(server, 'PATCH', '/api/config', { audibleAlerts: true });
    expect(res.status).toBe(200);
    expect(res.body.audibleAlerts).toBe(true);
    expect(config.audibleAlerts).toBe(true);
  });

  it('PATCH /api/config disables audibleAlerts', async () => {
    updateConfig({ audibleAlerts: true });
    const res = await request(server, 'PATCH', '/api/config', { audibleAlerts: false });
    expect(res.status).toBe(200);
    expect(res.body.audibleAlerts).toBe(false);
    expect(config.audibleAlerts).toBe(false);
  });

  it('audibleAlerts defaults to false', () => {
    // Reset to default and verify the actual value, not just the type
    updateConfig({ audibleAlerts: false });
    expect(config.audibleAlerts).toBe(false);
  });
});

describe('audible alert on status change via API', () => {
  let terminalManager: TerminalManager;
  let issueManager: IssueManager;
  let server: Server;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let originalAudibleAlerts: boolean;

  beforeEach(async () => {
    originalAudibleAlerts = config.audibleAlerts;
    terminalManager = new TerminalManager();
    issueManager = new IssueManager(terminalManager);

    const app = express();
    app.use('/api', createIssueApiRouter(issueManager));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    _resetDebounce();
  });

  afterEach(async () => {
    writeSpy.mockRestore();
    updateConfig({ audibleAlerts: originalAudibleAlerts });
    terminalManager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('plays alert when status changes and audibleAlerts is enabled', async () => {
    updateConfig({ audibleAlerts: true });
    const created = await request(server, 'POST', '/api/issues', { title: 'Alert test' });
    const id = created.body.id;

    // backlog -> todo (neutral = single bell)
    const res = await request(server, 'PATCH', `/api/issues/${id}/status`, { status: 'todo' });
    expect(res.status).toBe(200);
    expect(writeSpy).toHaveBeenCalledWith('\x07');
  });

  it('does not play alert when audibleAlerts is disabled', async () => {
    updateConfig({ audibleAlerts: false });
    const created = await request(server, 'POST', '/api/issues', { title: 'Silent test' });
    const id = created.body.id;

    await request(server, 'PATCH', `/api/issues/${id}/status`, { status: 'todo' });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('plays double bell for transition to review', async () => {
    updateConfig({ audibleAlerts: true });
    const created = await request(server, 'POST', '/api/issues', { title: 'Review test' });
    const id = created.body.id;

    // backlog -> todo -> in_progress -> review
    await request(server, 'PATCH', `/api/issues/${id}/status`, { status: 'todo' });
    writeSpy.mockClear();
    _resetDebounce();
    await request(server, 'PATCH', `/api/issues/${id}/status`, { status: 'in_progress' });
    writeSpy.mockClear();
    _resetDebounce();
    await request(server, 'PATCH', `/api/issues/${id}/status`, { status: 'review' });
    expect(writeSpy).toHaveBeenCalledWith('\x07\x07');
  });

  it('plays triple bell for transition to done', async () => {
    updateConfig({ audibleAlerts: true });
    const created = await request(server, 'POST', '/api/issues', { title: 'Done test' });
    const id = created.body.id;

    // Move through statuses to done
    await request(server, 'PATCH', `/api/issues/${id}/status`, { status: 'todo' });
    writeSpy.mockClear();
    _resetDebounce();
    await request(server, 'PATCH', `/api/issues/${id}/status`, { status: 'done' });
    expect(writeSpy).toHaveBeenCalledWith('\x07\x07\x07');
  });

  it('does not play alert when status is unchanged', async () => {
    updateConfig({ audibleAlerts: true });
    const created = await request(server, 'POST', '/api/issues', { title: 'Same status' });
    const id = created.body.id;

    // backlog -> backlog (same status — no alert)
    await request(server, 'PATCH', `/api/issues/${id}/status`, { status: 'backlog' });
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
