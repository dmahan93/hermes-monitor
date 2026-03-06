import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config, isGitRepo } from './config.js';

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
  refs: string[];
}

export interface GitFileChange {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';
  additions: number;
  deletions: number;
}

// Input validation — strict patterns to prevent injection
const SHA_RE = /^[a-f0-9]{4,40}$/i;
const BRANCH_RE = /^[a-zA-Z0-9._\/-]+$/;
// File paths: no NUL, no ".." traversal
const FILE_RE = /^[^\x00]+$/;

function validateSha(sha: string): boolean {
  return SHA_RE.test(sha);
}

function validateBranch(branch: string): boolean {
  return BRANCH_RE.test(branch) && !branch.includes('..');
}

function validateFilePath(path: string): boolean {
  return FILE_RE.test(path) && !path.includes('..');
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: cwd || config.repoPath,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

// NUL byte separator — guaranteed not to appear in git format fields
const SEP = '\x00';

export function parseLogLine(line: string): GitCommit | null {
  const parts = line.split(SEP);
  if (parts.length < 5) return null;
  return {
    hash: parts[0],
    shortHash: parts[1],
    message: parts[2],
    author: parts[3],
    date: parts[4],
    parents: parts[5] ? parts[5].split(' ').filter(Boolean) : [],
    refs: parts[6] ? parts[6].split(', ').filter(Boolean) : [],
  };
}

export function createGitApiRouter(): Router {
  const router = Router();

  // GET /api/git/log — returns commit graph for the repo
  router.get('/git/log', async (req, res) => {
    if (!isGitRepo(config.repoPath)) {
      res.status(400).json({ error: 'Not a git repo' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const branch = (req.query.branch as string) || '--all';

    // Validate branch if not the default --all flag
    if (branch !== '--all' && !validateBranch(branch)) {
      res.status(400).json({ error: 'Invalid branch name' });
      return;
    }

    try {
      const format = `%H${SEP}%h${SEP}%s${SEP}%an${SEP}%cr${SEP}%P${SEP}%D`;
      const args = ['log', '--topo-order', '-n', String(limit), `--format=${format}`];
      if (branch === '--all') {
        args.push('--all');
      } else {
        args.push(branch);
      }

      const raw = await git(args);

      const commits = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(parseLogLine)
        .filter((c): c is GitCommit => c !== null);

      // Build graph lanes for rendering
      const graph = buildGraphLanes(commits);

      res.json({ commits, graph });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/git/show/:sha — files changed in a commit
  router.get('/git/show/:sha', async (req, res) => {
    if (!isGitRepo(config.repoPath)) {
      res.status(400).json({ error: 'Not a git repo' });
      return;
    }

    const sha = req.params.sha;
    if (!validateSha(sha)) {
      res.status(400).json({ error: 'Invalid SHA' });
      return;
    }

    try {
      // Get file changes with stats
      const raw = await git(['show', '--stat', '--name-status', '--format=', sha]);
      const lines = raw.trim().split('\n').filter(Boolean);

      const files: GitFileChange[] = [];
      // name-status lines come after stat lines
      for (const line of lines) {
        const match = line.match(/^([AMDRCTU])\t(.+)$/);
        if (match) {
          files.push({
            path: match[2],
            status: match[1] as GitFileChange['status'],
            additions: 0,
            deletions: 0,
          });
        }
      }

      // Get numstat for additions/deletions
      try {
        const numstat = await git(['show', '--numstat', '--format=', sha]);
        for (const line of numstat.trim().split('\n').filter(Boolean)) {
          const parts = line.split('\t');
          if (parts.length >= 3) {
            const file = files.find((f) => f.path === parts[2]);
            if (file) {
              file.additions = parts[0] === '-' ? 0 : parseInt(parts[0]) || 0;
              file.deletions = parts[1] === '-' ? 0 : parseInt(parts[1]) || 0;
            }
          }
        }
      } catch {
        // numstat might fail for binary files, that's fine
      }

      res.json({ sha, files });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/git/diff/:sha — full diff for a commit
  router.get('/git/diff/:sha', async (req, res) => {
    if (!isGitRepo(config.repoPath)) {
      res.status(400).json({ error: 'Not a git repo' });
      return;
    }

    const sha = req.params.sha;
    if (!validateSha(sha)) {
      res.status(400).json({ error: 'Invalid SHA' });
      return;
    }

    const filePath = req.query.file as string | undefined;
    if (filePath && !validateFilePath(filePath)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }

    try {
      let diff: string;
      if (filePath) {
        diff = await git(['show', '--format=', sha, '--', filePath]);
      } else {
        diff = await git(['show', '--format=', sha]);
      }

      res.json({ sha, file: filePath || null, diff });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/git/branches — list branches
  router.get('/git/branches', async (_req, res) => {
    if (!isGitRepo(config.repoPath)) {
      res.status(400).json({ error: 'Not a git repo' });
      return;
    }

    try {
      const raw = await git(['branch', '-a', '--format=%(refname:short)|%(HEAD)']);
      const branches = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, head] = line.split('|');
          return { name, current: head === '*' };
        });
      res.json({ branches });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// Build graph lanes for rendering a visual commit graph
export interface GraphNode {
  hash: string;
  col: number;       // which column (lane) this commit is in
  lines: GraphLine[]; // lines connecting to children/parents
}

export interface GraphLine {
  fromCol: number;
  toCol: number;
  type: 'straight' | 'merge-left' | 'merge-right' | 'branch-left' | 'branch-right';
}

export function buildGraphLanes(commits: GitCommit[]): GraphNode[] {
  const nodes: GraphNode[] = [];
  // Active lanes: each lane tracks a commit hash it's "expecting"
  let lanes: (string | null)[] = [];

  for (const commit of commits) {
    // Find which lane this commit is in
    let col = lanes.indexOf(commit.hash);
    if (col === -1) {
      // New lane — find an empty slot or append
      col = lanes.indexOf(null);
      if (col === -1) {
        col = lanes.length;
        lanes.push(commit.hash);
      } else {
        lanes[col] = commit.hash;
      }
    }

    const graphLines: GraphLine[] = [];

    // Close this lane (commit consumed)
    lanes[col] = null;

    // Place parents into lanes
    const parents = commit.parents;
    if (parents.length > 0) {
      // First parent continues in the same lane
      const firstParent = parents[0];
      const existingLane = lanes.indexOf(firstParent);
      if (existingLane !== -1 && existingLane !== col) {
        // First parent already has a lane — merge into it
        graphLines.push({
          fromCol: col,
          toCol: existingLane,
          type: existingLane < col ? 'merge-left' : 'merge-right',
        });
      } else if (existingLane === -1) {
        // Assign first parent to current lane
        lanes[col] = firstParent;
        graphLines.push({ fromCol: col, toCol: col, type: 'straight' });
      } else {
        // Same lane, straight down
        graphLines.push({ fromCol: col, toCol: col, type: 'straight' });
      }

      // Additional parents (merge commits)
      for (let i = 1; i < parents.length; i++) {
        const parent = parents[i];
        const parentLane = lanes.indexOf(parent);
        if (parentLane !== -1) {
          graphLines.push({
            fromCol: col,
            toCol: parentLane,
            type: parentLane < col ? 'merge-left' : 'merge-right',
          });
        } else {
          // Find an empty slot or append for new branch line
          let newCol = lanes.indexOf(null);
          if (newCol === -1) {
            newCol = lanes.length;
            lanes.push(parent);
          } else {
            lanes[newCol] = parent;
          }
          graphLines.push({
            fromCol: col,
            toCol: newCol,
            type: newCol < col ? 'branch-left' : 'branch-right',
          });
        }
      }
    }

    // Pass-through lines for other active lanes
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && i !== col) {
        graphLines.push({ fromCol: i, toCol: i, type: 'straight' });
      }
    }

    // Trim trailing null lanes
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }

    nodes.push({
      hash: commit.hash,
      col,
      lines: graphLines,
    });
  }

  return nodes;
}
