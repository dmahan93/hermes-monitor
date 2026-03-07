import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import WebSocket from 'ws';
import { TerminalManager } from '../src/terminal-manager.js';
import { setupWebSocket } from '../src/ws.js';
import { createApiRouter } from '../src/api.js';

function connectWs(server: Server): Promise<WebSocket> {
  const addr = server.address() as any;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket, filter?: (msg: any) => boolean): Promise<any> {
  return new Promise((resolve) => {
    const handler = (raw: WebSocket.Data) => {
      const msg = JSON.parse(raw.toString());
      if (!filter || filter(msg)) {
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

describe('WebSocket', () => {
  let manager: TerminalManager;
  let server: Server;
  let clients: WebSocket[] = [];

  beforeEach(async () => {
    manager = new TerminalManager();
    const app = express();
    app.use('/api', createApiRouter(manager));
    server = createServer(app);
    setupWebSocket(server, manager);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    manager.killAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('client connects successfully', async () => {
    const ws = await connectWs(server);
    clients.push(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('stdin message forwarded to PTY', async () => {
    const ws = await connectWs(server);
    clients.push(ws);
    const term = manager.create();

    // Send stdin
    ws.send(JSON.stringify({ type: 'stdin', terminalId: term.id, data: 'echo ws-test\n' }));

    // Should get stdout back containing our input
    const msg = await Promise.race([
      waitForMessage(ws, (m) => m.type === 'stdout' && m.terminalId === term.id && m.data.includes('ws-test')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    expect(msg.type).toBe('stdout');
    expect(msg.terminalId).toBe(term.id);
  });

  it('PTY stdout forwarded to client', async () => {
    const ws = await connectWs(server);
    clients.push(ws);

    // Create terminal — should produce some output (shell prompt)
    const term = manager.create();

    const msg = await Promise.race([
      waitForMessage(ws, (m) => m.type === 'stdout' && m.terminalId === term.id),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    expect(msg.type).toBe('stdout');
    expect(msg.terminalId).toBe(term.id);
    expect(msg.data).toBeTruthy();
  });

  it('resize message updates PTY dimensions', async () => {
    const ws = await connectWs(server);
    clients.push(ws);
    const term = manager.create();

    ws.send(JSON.stringify({ type: 'resize', terminalId: term.id, cols: 200, rows: 50 }));
    // Give it a tick to process
    await new Promise((r) => setTimeout(r, 100));

    const info = manager.get(term.id);
    expect(info!.cols).toBe(200);
    expect(info!.rows).toBe(50);
  });

  it('terminal exit sends exit message', async () => {
    const ws = await connectWs(server);
    clients.push(ws);
    const term = manager.create({ command: '/bin/true' });

    const msg = await Promise.race([
      waitForMessage(ws, (m) => m.type === 'exit' && m.terminalId === term.id),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    expect(msg.type).toBe('exit');
    expect(msg.terminalId).toBe(term.id);
    expect(typeof msg.exitCode).toBe('number');
  });

  it('terminal kill sends terminal:removed message', async () => {
    const ws = await connectWs(server);
    clients.push(ws);
    const term = manager.create();

    // Wait for any initial stdout, then kill
    await new Promise((r) => setTimeout(r, 200));
    manager.kill(term.id);

    const msg = await Promise.race([
      waitForMessage(ws, (m) => m.type === 'terminal:removed' && m.terminalId === term.id),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    expect(msg.type).toBe('terminal:removed');
    expect(msg.terminalId).toBe(term.id);
  });

  it('invalid JSON handled gracefully', async () => {
    const ws = await connectWs(server);
    clients.push(ws);

    ws.send('not json at all');
    const msg = await Promise.race([
      waitForMessage(ws, (m) => m.type === 'error'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('Invalid JSON');
  });

  it('invalid terminalId handled gracefully', async () => {
    const ws = await connectWs(server);
    clients.push(ws);

    ws.send(JSON.stringify({ type: 'stdin', terminalId: 'bogus', data: 'hello' }));
    const msg = await Promise.race([
      waitForMessage(ws, (m) => m.type === 'error'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('not found');
  });

  it('client disconnect does not kill terminals', async () => {
    const ws = await connectWs(server);
    const term = manager.create();
    ws.close();
    await new Promise((r) => setTimeout(r, 200));
    // Terminal should still be alive
    expect(manager.get(term.id)).toBeDefined();
  });

  it('multiple clients receive same terminal output', async () => {
    const ws1 = await connectWs(server);
    const ws2 = await connectWs(server);
    clients.push(ws1, ws2);

    const term = manager.create();

    // Both should get stdout
    const [msg1, msg2] = await Promise.race([
      Promise.all([
        waitForMessage(ws1, (m) => m.type === 'stdout' && m.terminalId === term.id),
        waitForMessage(ws2, (m) => m.type === 'stdout' && m.terminalId === term.id),
      ]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]);
    expect(msg1.type).toBe('stdout');
    expect(msg2.type).toBe('stdout');
    expect(msg1.terminalId).toBe(term.id);
    expect(msg2.terminalId).toBe(term.id);
  });
});
