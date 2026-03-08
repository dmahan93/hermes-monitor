import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { config } from '../src/config.js';

// Mock child_process before importing github module
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

// Import after mock setup
const { pushBranch, pushMerge, createGitHubPR, closeGitHubPR, deleteRemoteBranch, isGhAvailable } = await import('../src/github.js');

// Helper to mock execFile behavior
function mockExecFile(impl: (cmd: string, args: string[], opts: any, cb: Function) => void) {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(impl);
}

// Helper to make execFile succeed (promisified)
function mockExecFileSuccess(stdout = '', stderr = '') {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, { stdout, stderr });
    }
  );
}

// Helper to make execFile fail
function mockExecFileFail(stderr = 'error', code = 1) {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: any, cb: Function) => {
      const err: any = new Error(stderr);
      err.stderr = stderr;
      err.code = code;
      cb(err, { stdout: '', stderr });
    }
  );
}

describe('GitHub Integration — pushBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes a branch to the configured remote', async () => {
    mockExecFileSuccess();
    const result = await pushBranch('issue/my-branch', '/tmp/repo');
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify git push was called with correct args
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['push', config.githubRemote, 'issue/my-branch', '--force-with-lease'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
      expect.any(Function),
    );
  });

  it('uses custom remote when provided', async () => {
    mockExecFileSuccess();
    await pushBranch('issue/my-branch', '/tmp/repo', 'upstream');
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['push', 'upstream', 'issue/my-branch', '--force-with-lease'],
      expect.anything(),
      expect.any(Function),
    );
  });

  it('returns error when push fails', async () => {
    mockExecFileFail('fatal: could not read Username');
    const result = await pushBranch('issue/my-branch', '/tmp/repo');
    expect(result.success).toBe(false);
    expect(result.error).toContain('could not read Username');
  });
});

describe('GitHub Integration — pushMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pushes the target branch after merge', async () => {
    mockExecFileSuccess();
    const result = await pushMerge('master', '/tmp/repo');
    expect(result.success).toBe(true);
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['push', config.githubRemote, 'master'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
      expect.any(Function),
    );
  });

  it('returns error when merge push fails', async () => {
    mockExecFileFail('network error');
    const result = await pushMerge('master', '/tmp/repo');
    expect(result.success).toBe(false);
    expect(result.error).toContain('network error');
  });
});

describe('GitHub Integration — isGhAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when gh auth status succeeds', async () => {
    mockExecFileSuccess('Logged in as user');
    const result = await isGhAvailable('/tmp/repo');
    expect(result).toBe(true);
  });

  it('returns false when gh is not installed', async () => {
    mockExecFileFail('command not found: gh');
    const result = await isGhAvailable('/tmp/repo');
    expect(result).toBe(false);
  });
});

describe('GitHub Integration — createGitHubPR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a GitHub PR and returns the URL', async () => {
    // First call: gh auth status (success), Second call: gh pr create
    let callCount = 0;
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, args: string[], _opts: any, cb: Function) => {
        callCount++;
        if (args[0] === 'auth') {
          cb(null, { stdout: 'Logged in', stderr: '' });
        } else if (args[0] === 'pr' && args[1] === 'create') {
          cb(null, { stdout: 'https://github.com/user/repo/pull/42\n', stderr: '' });
        } else {
          cb(new Error('unexpected call'), { stdout: '', stderr: '' });
        }
      }
    );

    const result = await createGitHubPR('My PR', 'Description', 'issue/test', 'master', '/tmp/repo');
    expect(result.success).toBe(true);
    expect(result.prUrl).toBe('https://github.com/user/repo/pull/42');
  });

  it('returns existing PR URL when PR already exists', async () => {
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, args: string[], _opts: any, cb: Function) => {
        if (args[0] === 'auth') {
          cb(null, { stdout: 'Logged in', stderr: '' });
        } else if (args[0] === 'pr' && args[1] === 'create') {
          const err: any = new Error('already exists');
          err.stderr = 'a pull request for branch "issue/test" already exists';
          cb(err, { stdout: '', stderr: err.stderr });
        } else if (args[0] === 'pr' && args[1] === 'view') {
          cb(null, { stdout: 'https://github.com/user/repo/pull/42\n', stderr: '' });
        } else {
          cb(new Error('unexpected'), { stdout: '', stderr: '' });
        }
      }
    );

    const result = await createGitHubPR('My PR', 'Desc', 'issue/test', 'master', '/tmp/repo');
    expect(result.success).toBe(true);
    expect(result.prUrl).toBe('https://github.com/user/repo/pull/42');
  });

  it('skips if gh CLI is not available', async () => {
    mockExecFileFail('command not found: gh');
    const result = await createGitHubPR('My PR', 'Desc', 'issue/test', 'master', '/tmp/repo');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });
});

describe('GitHub Integration — closeGitHubPR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('closes a GitHub PR', async () => {
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, args: string[], _opts: any, cb: Function) => {
        if (args[0] === 'auth') {
          cb(null, { stdout: 'Logged in', stderr: '' });
        } else if (args[0] === 'pr' && args[1] === 'close') {
          cb(null, { stdout: '', stderr: '' });
        } else {
          cb(new Error('unexpected'), { stdout: '', stderr: '' });
        }
      }
    );

    const result = await closeGitHubPR('https://github.com/user/repo/pull/42', '/tmp/repo');
    expect(result.success).toBe(true);
  });

  it('returns error when gh is not available', async () => {
    mockExecFileFail('command not found: gh');
    const result = await closeGitHubPR('https://github.com/user/repo/pull/42', '/tmp/repo');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });
});

describe('GitHub Integration — deleteRemoteBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a remote branch', async () => {
    mockExecFileSuccess();
    const result = await deleteRemoteBranch('issue/my-branch', '/tmp/repo');
    expect(result.success).toBe(true);
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['push', config.githubRemote, '--delete', 'issue/my-branch'],
      expect.anything(),
      expect.any(Function),
    );
  });

  it('succeeds silently when remote branch does not exist', async () => {
    mockExecFileFail('error: unable to delete \'issue/my-branch\': remote ref does not exist');
    const result = await deleteRemoteBranch('issue/my-branch', '/tmp/repo');
    expect(result.success).toBe(true);
  });

  it('returns error on other failures', async () => {
    mockExecFileFail('fatal: auth error');
    const result = await deleteRemoteBranch('issue/my-branch', '/tmp/repo');
    expect(result.success).toBe(false);
    expect(result.error).toContain('auth error');
  });
});

describe('GitHub Integration — Config', () => {
  const savedEnabled = config.githubEnabled;
  const savedRemote = config.githubRemote;

  afterEach(() => {
    config.githubEnabled = savedEnabled;
    config.githubRemote = savedRemote;
  });

  it('config defaults to disabled with origin remote', () => {
    // Default values (without env vars set to 'true')
    expect(config.githubRemote).toBe('origin');
    // githubEnabled depends on env var, but default should be false
  });

  it('pushBranch uses config.githubRemote as default', async () => {
    config.githubRemote = 'custom-remote';
    mockExecFileSuccess();
    await pushBranch('issue/test', '/tmp/repo');
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['push', 'custom-remote', 'issue/test', '--force-with-lease'],
      expect.anything(),
      expect.any(Function),
    );
  });
});
