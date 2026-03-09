import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { createHubApp } from '../src/hub-server.js';

/** Helper to make requests to the test server */
async function request(server: Server, path: string) {
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

describe('GET /api/hub/browse', () => {
  let tmpDir: string;
  let dbPath: string;
  let server: Server;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hermes-browse-test-'));
    dbPath = join(tmpDir, 'test-hub.db');
    const hub = createHubApp(dbPath);
    server = hub.server;

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns home directory when no path is provided', async () => {
    const { status, body } = await request(server, '/api/hub/browse');
    expect(status).toBe(200);
    expect(body.path).toBe(homedir());
    expect(body.parent).toBeTruthy();
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('returns directory contents for a valid path', async () => {
    // Create test directories
    mkdirSync(join(tmpDir, 'project-a'));
    mkdirSync(join(tmpDir, 'project-b'));

    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent(tmpDir)}`
    );
    expect(status).toBe(200);
    expect(body.path).toBe(tmpDir);
    expect(body.entries).toHaveLength(2);
    expect(body.entries.map((e: any) => e.name).sort()).toEqual(['project-a', 'project-b']);
  });

  it('detects git repos and marks them with isGitRepo', async () => {
    const gitDir = join(tmpDir, 'my-repo');
    mkdirSync(gitDir);
    mkdirSync(join(gitDir, '.git'));
    mkdirSync(join(tmpDir, 'plain-dir'));

    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent(tmpDir)}`
    );
    expect(status).toBe(200);
    const gitEntry = body.entries.find((e: any) => e.name === 'my-repo');
    const plainEntry = body.entries.find((e: any) => e.name === 'plain-dir');
    expect(gitEntry.isGitRepo).toBe(true);
    expect(plainEntry.isGitRepo).toBe(false);
  });

  it('sorts git repos first, then alphabetically', async () => {
    mkdirSync(join(tmpDir, 'z-plain'));
    mkdirSync(join(tmpDir, 'a-plain'));
    const gitDir = join(tmpDir, 'm-repo');
    mkdirSync(gitDir);
    mkdirSync(join(gitDir, '.git'));

    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent(tmpDir)}`
    );
    expect(status).toBe(200);
    const names = body.entries.map((e: any) => e.name);
    expect(names).toEqual(['m-repo', 'a-plain', 'z-plain']);
  });

  it('skips hidden directories', async () => {
    mkdirSync(join(tmpDir, '.hidden'));
    mkdirSync(join(tmpDir, 'visible'));

    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent(tmpDir)}`
    );
    expect(status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].name).toBe('visible');
  });

  it('only returns directories, not files', async () => {
    mkdirSync(join(tmpDir, 'subdir'));
    writeFileSync(join(tmpDir, 'file.txt'), 'hello');

    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent(tmpDir)}`
    );
    expect(status).toBe(200);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].name).toBe('subdir');
  });

  it('returns parent directory', async () => {
    const subDir = join(tmpDir, 'subdir');
    mkdirSync(subDir);

    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent(subDir)}`
    );
    expect(status).toBe(200);
    expect(body.parent).toBe(tmpDir);
  });

  it('returns null parent for root', async () => {
    const { status, body } = await request(server, '/api/hub/browse?path=/');
    expect(status).toBe(200);
    expect(body.parent).toBeNull();
  });

  it('returns 400 for non-existent path', async () => {
    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent('/nonexistent/path/xyz')}`
    );
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it('returns 400 when path is a file', async () => {
    const filePath = join(tmpDir, 'afile.txt');
    writeFileSync(filePath, 'data');

    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent(filePath)}`
    );
    expect(status).toBe(400);
    expect(body.error).toContain('not a directory');
  });

  it('returns entries with full paths', async () => {
    const subDir = join(tmpDir, 'my-project');
    mkdirSync(subDir);

    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent(tmpDir)}`
    );
    expect(status).toBe(200);
    expect(body.entries[0].path).toBe(subDir);
  });

  it('returns empty entries for an empty directory', async () => {
    const emptyDir = join(tmpDir, 'empty');
    mkdirSync(emptyDir);

    const { status, body } = await request(
      server,
      `/api/hub/browse?path=${encodeURIComponent(emptyDir)}`
    );
    expect(status).toBe(200);
    expect(body.entries).toHaveLength(0);
  });
});
