import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';
import {
  parseLogLine,
  buildGraphLanes,
  createGitApiRouter,
  resolveRenamePath,
  type GitCommit,
} from '../src/git-api.js';

// ── Pure function tests (no mocking needed) ──

describe('parseLogLine', () => {
  const SEP = '\x00';

  it('parses a standard log line', () => {
    const line = [
      'abc123def456abc123def456abc123def456abcd',
      'abc123d',
      'fix: some bug',
      'Alice',
      '3 days ago',
      'deadbeef1234567890deadbeef1234567890dead',
      'HEAD -> main, origin/main',
    ].join(SEP);

    const result = parseLogLine(line);
    expect(result).not.toBeNull();
    expect(result!.hash).toBe('abc123def456abc123def456abc123def456abcd');
    expect(result!.shortHash).toBe('abc123d');
    expect(result!.message).toBe('fix: some bug');
    expect(result!.author).toBe('Alice');
    expect(result!.date).toBe('3 days ago');
    expect(result!.parents).toEqual(['deadbeef1234567890deadbeef1234567890dead']);
    expect(result!.refs).toEqual(['HEAD -> main', 'origin/main']);
  });

  it('parses a merge commit with multiple parents', () => {
    const line = [
      'aaa111',
      'aaa1',
      'Merge branch feat',
      'Bob',
      '1 hour ago',
      'bbb222 ccc333',
      '',
    ].join(SEP);

    const result = parseLogLine(line);
    expect(result).not.toBeNull();
    expect(result!.parents).toEqual(['bbb222', 'ccc333']);
    expect(result!.refs).toEqual([]);
  });

  it('parses a commit with no parents (root commit)', () => {
    const line = ['aaa111', 'aaa1', 'initial', 'Alice', '1 year ago', '', ''].join(SEP);
    const result = parseLogLine(line);
    expect(result).not.toBeNull();
    expect(result!.parents).toEqual([]);
  });

  it('returns null for malformed line', () => {
    expect(parseLogLine('not enough fields')).toBeNull();
    expect(parseLogLine('')).toBeNull();
  });

  it('handles commit messages with special characters', () => {
    const line = [
      'aaa111',
      'aaa1',
      'fix: handle |SEP| in messages & <html> "quotes"',
      'Alice',
      '1 day ago',
      '',
      '',
    ].join(SEP);

    const result = parseLogLine(line);
    expect(result).not.toBeNull();
    expect(result!.message).toBe('fix: handle |SEP| in messages & <html> "quotes"');
  });
});

describe('buildGraphLanes', () => {
  function makeCommit(hash: string, parents: string[] = [], refs: string[] = []): GitCommit {
    return {
      hash,
      shortHash: hash.slice(0, 7),
      message: `commit ${hash}`,
      author: 'test',
      date: 'now',
      parents,
      refs,
    };
  }

  it('handles a simple linear history', () => {
    const commits = [
      makeCommit('aaa', ['bbb']),
      makeCommit('bbb', ['ccc']),
      makeCommit('ccc', []),
    ];

    const graph = buildGraphLanes(commits);
    expect(graph).toHaveLength(3);
    // All commits should be in column 0
    expect(graph[0].col).toBe(0);
    expect(graph[1].col).toBe(0);
    expect(graph[2].col).toBe(0);

    // Each should have a straight line (except root which has no parents)
    expect(graph[0].lines).toContainEqual({ fromCol: 0, toCol: 0, type: 'straight' });
    expect(graph[1].lines).toContainEqual({ fromCol: 0, toCol: 0, type: 'straight' });
  });

  it('handles empty commit list', () => {
    expect(buildGraphLanes([])).toEqual([]);
  });

  it('handles a single commit with no parents', () => {
    const commits = [makeCommit('aaa', [])];
    const graph = buildGraphLanes(commits);
    expect(graph).toHaveLength(1);
    expect(graph[0].col).toBe(0);
    expect(graph[0].lines).toHaveLength(0);
  });

  it('handles a merge commit', () => {
    // Merge topology:
    // aaa (merge of bbb + ccc)
    // bbb (parent: ddd)
    // ccc (parent: ddd)
    // ddd (root)
    const commits = [
      makeCommit('aaa', ['bbb', 'ccc']),
      makeCommit('bbb', ['ddd']),
      makeCommit('ccc', ['ddd']),
      makeCommit('ddd', []),
    ];

    const graph = buildGraphLanes(commits);
    expect(graph).toHaveLength(4);

    // The merge commit should be in col 0
    expect(graph[0].col).toBe(0);

    // It should have a straight line for first parent and a branch/merge line for second
    const mergeLines = graph[0].lines.filter(l => l.type !== 'straight');
    expect(mergeLines.length).toBeGreaterThanOrEqual(1);
  });

  it('handles a branch (two commits with same parent)', () => {
    // Two branches from a common ancestor:
    // aaa -> parent ccc
    // bbb -> parent ccc
    // ccc (root)
    const commits = [
      makeCommit('aaa', ['ccc']),
      makeCommit('bbb', ['ccc']),
      makeCommit('ccc', []),
    ];

    const graph = buildGraphLanes(commits);
    expect(graph).toHaveLength(3);
    // First commit goes to col 0
    expect(graph[0].col).toBe(0);
    // Second commit should be in a different column (col 1)
    expect(graph[1].col).toBe(1);
  });

  it('pass-through lines are generated for active lanes', () => {
    // Two parallel branches:
    // aaa (parent: ccc) — col 0
    // bbb (parent: ddd) — col 1
    // ccc (parent: eee) — col 0, pass-through for lane 1
    const commits = [
      makeCommit('aaa', ['ccc']),
      makeCommit('bbb', ['ddd']),
      makeCommit('ccc', ['eee']),
    ];

    const graph = buildGraphLanes(commits);
    // When ccc is processed in col 0, bbb's lane (col 1 -> ddd) should still be active
    // so there should be a pass-through line for col 1
    const cccNode = graph[2];
    const passThroughLines = cccNode.lines.filter(
      l => l.type === 'straight' && l.fromCol !== cccNode.col
    );
    expect(passThroughLines.length).toBeGreaterThanOrEqual(1);
  });

  it('reuses empty lane slots', () => {
    // After a lane is consumed, its slot should be available for reuse
    // Linear chain: each commit only needs one lane
    const commits = [
      makeCommit('a', ['b']),
      makeCommit('b', ['c']),
      makeCommit('c', ['d']),
      makeCommit('d', []),
    ];

    const graph = buildGraphLanes(commits);
    // All should be in column 0 since each is consumed and replaced
    for (const node of graph) {
      expect(node.col).toBe(0);
    }
  });
});

// ── HTTP endpoint tests (with mocked git) ──

// We need to mock the config and execFile for endpoint tests
vi.mock('../src/config.js', () => ({
  config: { repoPath: '/fake/repo' },
  isGitRepo: vi.fn(() => true),
}));

// Mock child_process.execFile
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

import { execFile } from 'child_process';
import { isGitRepo } from '../src/config.js';

async function request(server: Server, method: string, path: string) {
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const res = await fetch(url, { method });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

describe('Git API endpoints', () => {
  let server: Server;

  beforeEach(async () => {
    vi.mocked(isGitRepo).mockReturnValue(true);
    const app = express();
    app.use('/api', createGitApiRouter());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.restoreAllMocks();
  });

  describe('input validation', () => {
    it('rejects invalid SHA in /git/show/:sha', async () => {
      const res = await request(server, 'GET', '/api/git/show/;rm%20-rf%20/');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid SHA');
    });

    it('rejects invalid SHA in /git/diff/:sha', async () => {
      const res = await request(server, 'GET', '/api/git/diff/$(whoami)');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid SHA');
    });

    it('rejects invalid branch in /git/log', async () => {
      const res = await request(server, 'GET', '/api/git/log?branch=;curl%20evil.com');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid branch name');
    });

    it('rejects branch names starting with - (git flag injection)', async () => {
      const res1 = await request(server, 'GET', '/api/git/log?branch=--no-walk');
      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe('Invalid branch name');

      const res2 = await request(server, 'GET', '/api/git/log?branch=--output=/tmp/evil');
      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe('Invalid branch name');
    });

    it('rejects file path with directory traversal in /git/diff', async () => {
      // Mock valid SHA response
      vi.mocked(execFile).mockImplementation(
        (_cmd: any, _args: any, _opts: any, cb: any) => {
          cb(null, { stdout: '' });
          return {} as any;
        }
      );
      const res = await request(server, 'GET', '/api/git/diff/abcdef12?file=../../etc/passwd');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid file path');
    });

    it('accepts valid SHA', async () => {
      vi.mocked(execFile).mockImplementation(
        (_cmd: any, _args: any, _opts: any, cb: any) => {
          cb(null, { stdout: '' });
          return {} as any;
        }
      );
      const res = await request(server, 'GET', '/api/git/show/abcdef1234');
      expect(res.status).toBe(200);
    });

    it('accepts valid branch names', async () => {
      vi.mocked(execFile).mockImplementation(
        (_cmd: any, _args: any, _opts: any, cb: any) => {
          cb(null, { stdout: '' });
          return {} as any;
        }
      );
      const res = await request(server, 'GET', '/api/git/log?branch=feature/my-branch');
      expect(res.status).toBe(200);
    });
  });

  describe('/api/git/log', () => {
    it('returns parsed commits and graph', async () => {
      const SEP = '\x00';
      const logOutput = [
        `aaa111${SEP}aaa1${SEP}fix bug${SEP}Alice${SEP}1 day ago${SEP}${SEP}HEAD -> main`,
        `bbb222${SEP}bbb2${SEP}add feature${SEP}Bob${SEP}2 days ago${SEP}aaa111${SEP}`,
      ].join('\n');

      vi.mocked(execFile).mockImplementation(
        (_cmd: any, _args: any, _opts: any, cb: any) => {
          cb(null, { stdout: logOutput });
          return {} as any;
        }
      );

      const res = await request(server, 'GET', '/api/git/log');
      expect(res.status).toBe(200);
      expect(res.body.commits).toHaveLength(2);
      expect(res.body.commits[0].message).toBe('fix bug');
      expect(res.body.graph).toHaveLength(2);
    });

    it('respects limit parameter', async () => {
      vi.mocked(execFile).mockImplementation(
        (_cmd: any, args: any, _opts: any, cb: any) => {
          // Verify the -n argument
          expect(args).toContain('-n');
          const nIdx = args.indexOf('-n');
          expect(args[nIdx + 1]).toBe('10');
          cb(null, { stdout: '' });
          return {} as any;
        }
      );

      await request(server, 'GET', '/api/git/log?limit=10');
    });

    it('caps limit at 200', async () => {
      vi.mocked(execFile).mockImplementation(
        (_cmd: any, args: any, _opts: any, cb: any) => {
          const nIdx = args.indexOf('-n');
          expect(parseInt(args[nIdx + 1])).toBeLessThanOrEqual(200);
          cb(null, { stdout: '' });
          return {} as any;
        }
      );

      await request(server, 'GET', '/api/git/log?limit=9999');
    });
  });

  describe('/api/git/branches', () => {
    it('returns parsed branches with current indicator', async () => {
      vi.mocked(execFile).mockImplementation(
        (_cmd: any, args: any, _opts: any, cb: any) => {
          const output = 'main|*\nfeature/foo|\norigin/main|\n';
          cb(null, { stdout: output });
          return {} as any;
        }
      );

      const res = await request(server, 'GET', '/api/git/branches');
      expect(res.status).toBe(200);
      expect(res.body.branches).toHaveLength(3);
      expect(res.body.branches[0]).toEqual({ name: 'main', current: true });
      expect(res.body.branches[1]).toEqual({ name: 'feature/foo', current: false });
    });

    it('returns 400 when not a git repo', async () => {
      vi.mocked(isGitRepo).mockReturnValue(false);
      const res = await request(server, 'GET', '/api/git/branches');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Not a git repo');
    });

    it('returns 500 on git error', async () => {
      vi.mocked(execFile).mockImplementation(
        (_cmd: any, _args: any, _opts: any, cb: any) => {
          cb(new Error('git failed'));
          return {} as any;
        }
      );

      const res = await request(server, 'GET', '/api/git/branches');
      expect(res.status).toBe(500);
    });
  });

  describe('/api/git/show/:sha — rename handling', () => {
    it('correctly parses renamed files (R100 status)', async () => {
      vi.mocked(execFile).mockImplementation(
        (_cmd: any, args: any, _opts: any, cb: any) => {
          if (args.includes('--name-status')) {
            cb(null, { stdout: 'R100\told-file.ts\tnew-file.ts\nM\tother.ts\n' });
          } else if (args.includes('--numstat')) {
            cb(null, { stdout: '10\t5\told-file.ts => new-file.ts\n3\t1\tother.ts\n' });
          } else {
            cb(null, { stdout: '' });
          }
          return {} as any;
        }
      );

      const res = await request(server, 'GET', '/api/git/show/abcdef12');
      expect(res.status).toBe(200);
      expect(res.body.files).toHaveLength(2);

      const renamed = res.body.files.find((f: any) => f.status === 'R');
      expect(renamed).toBeDefined();
      expect(renamed.path).toBe('new-file.ts');
      expect(renamed.additions).toBe(10);
      expect(renamed.deletions).toBe(5);

      const modified = res.body.files.find((f: any) => f.status === 'M');
      expect(modified).toBeDefined();
      expect(modified.path).toBe('other.ts');
      expect(modified.additions).toBe(3);
    });
  });

  describe('/api/git/diff/:sha — path validation', () => {
    it('rejects absolute file paths', async () => {
      const res = await request(server, 'GET', '/api/git/diff/abcdef12?file=/etc/passwd');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid file path');
    });
  });

  describe('not a git repo', () => {
    it('returns 400 when not a git repo', async () => {
      vi.mocked(isGitRepo).mockReturnValue(false);
      const res = await request(server, 'GET', '/api/git/log');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Not a git repo');
    });
  });
});

// ── resolveRenamePath tests ──

describe('resolveRenamePath', () => {
  it('returns path unchanged when no arrow notation', () => {
    expect(resolveRenamePath('src/file.ts')).toBe('src/file.ts');
  });

  it('resolves simple "old => new" format', () => {
    expect(resolveRenamePath('old-file.ts => new-file.ts')).toBe('new-file.ts');
  });

  it('resolves "prefix/{old => new}/suffix" format', () => {
    expect(resolveRenamePath('src/{old-name => new-name}/index.ts')).toBe('src/new-name/index.ts');
  });

  it('resolves "prefix/{old => new}" format (no suffix)', () => {
    expect(resolveRenamePath('src/{old.ts => new.ts}')).toBe('src/new.ts');
  });

  it('handles empty new part in braces', () => {
    expect(resolveRenamePath('src/{old => }/file.ts')).toBe('src//file.ts');
  });
});
