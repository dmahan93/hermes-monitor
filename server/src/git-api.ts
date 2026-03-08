/**
 * @module git-api
 * UI-facing REST API for git log, diff, and branch viewing.
 * Exposes endpoints to browse commit history, view file diffs between
 * branches, and list available branches in the monitored repository.
 */
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
// File paths: no NUL, no ".." traversal, no absolute paths
const FILE_RE = /^[^\x00]+$/;

function validateSha(sha: string): boolean {
  return SHA_RE.test(sha);
}

function validateBranch(branch: string): boolean {
  return BRANCH_RE.test(branch) && !branch.includes('..') && !branch.startsWith('-');
}

function validateFilePath(path: string): boolean {
  return FILE_RE.test(path) && !path.includes('..') && !path.startsWith('/');
}

/**
 * Resolve a git rename/copy path notation to the new (destination) path.
 * Handles both formats:
 *   "old => new"          → "new"
 *   "prefix/{old => new}/suffix" → "prefix/new/suffix"
 */
export function resolveRenamePath(pathStr: string): string {
  const arrowIdx = pathStr.indexOf(' => ');
  if (arrowIdx === -1) return pathStr;

  const braceOpen = pathStr.lastIndexOf('{', arrowIdx);
  const braceClose = pathStr.indexOf('}', arrowIdx);

  if (braceOpen !== -1 && braceClose !== -1) {
    const prefix = pathStr.slice(0, braceOpen);
    const newPart = pathStr.slice(arrowIdx + 4, braceClose);
    const suffix = pathStr.slice(braceClose + 1);
    return prefix + newPart + suffix;
  }

  return pathStr.slice(arrowIdx + 4);
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: cwd || config.repoPath,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

// NUL byte separator — guaranteed not to appear in git format fields.
// We use %x00 in the git format string (git's own escape) rather than
// embedding literal NUL bytes in the args (which execFile rejects).
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
      // Use git's %x00 escape — outputs NUL bytes without embedding them in the arg
      const format = '%H%x00%h%x00%s%x00%an%x00%cr%x00%P%x00%D';
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
      // git show --name-status and --numstat can't be combined in a single
      // call (git silently drops --numstat when --name-status is present).
      // Run two separate commands and merge the results.
      const [nameStatusRaw, numstatRaw] = await Promise.all([
        git(['show', '--name-status', '--format=', sha]),
        git(['show', '--numstat', '--format=', sha]),
      ]);

      // Parse numstat output: "additions\tdeletions\tpath"
      // For renames/copies, path may use "old => new" or "{old => new}" notation
      const numstatMap = new Map<string, { additions: number; deletions: number }>();
      for (const line of numstatRaw.trim().split('\n').filter(Boolean)) {
        const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (match) {
          let path = match[3];
          if (path.includes(' => ')) {
            path = resolveRenamePath(path);
          }
          numstatMap.set(path, {
            additions: match[1] === '-' ? 0 : parseInt(match[1]) || 0,
            deletions: match[2] === '-' ? 0 : parseInt(match[2]) || 0,
          });
        }
      }

      // Parse name-status output: "STATUS\tpath"
      // Status may include a similarity percentage for R/C (e.g. R100, C085)
      // Renames/copies have two tab-separated paths: "old-path\tnew-path"
      const files: GitFileChange[] = [];
      for (const line of nameStatusRaw.trim().split('\n').filter(Boolean)) {
        const match = line.match(/^([AMDRCTU]\d*)\t(.+)$/);
        if (match) {
          const status = match[1][0] as GitFileChange['status'];
          let filePath = match[2];

          // For R/C, the path field is "old-path\tnew-path" — use the new path
          if ((status === 'R' || status === 'C') && filePath.includes('\t')) {
            const pathParts = filePath.split('\t');
            filePath = pathParts[pathParts.length - 1];
          }

          const stats = numstatMap.get(filePath);
          files.push({
            path: filePath,
            status,
            additions: stats?.additions ?? 0,
            deletions: stats?.deletions ?? 0,
          });
        }
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
  isHead: boolean;   // true if this commit starts a new lane (no line above it)
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
    const isHead = col === -1; // true if this commit starts a new lane
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

    // Track lanes newly created for additional parents — these should NOT
    // get pass-through lines because the lane starts at this commit (no
    // line coming from above).
    const newLanes = new Set<number>();

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
          newLanes.add(newCol);
          graphLines.push({
            fromCol: col,
            toCol: newCol,
            type: newCol < col ? 'branch-left' : 'branch-right',
          });
        }
      }
    }

    // Pass-through lines for other active lanes (skip the commit's own
    // lane and any lanes that were just created for additional parents)
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && i !== col && !newLanes.has(i)) {
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
      isHead,
    });
  }

  return nodes;
}
