import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { resolve, join } from 'path';

const require = createRequire(import.meta.url);
const { parseArgs, ParseError, HELP_TEXT } = require('../../bin/lib/parse-args');

describe('CLI parseArgs', () => {
  const CWD = '/test/cwd';

  // ── Defaults ──

  it('returns defaults with no arguments', () => {
    const opts = parseArgs([], { cwd: CWD });
    expect(opts).toEqual({
      port: 3000,
      serverPort: 4000,
      repo: CWD,
      browser: true,
      build: false,
      help: false,
    });
  });

  // ── Port validation ──

  describe('--port', () => {
    it('parses a valid port', () => {
      const opts = parseArgs(['--port', '5000'], { cwd: CWD });
      expect(opts.port).toBe(5000);
    });

    it('accepts -p shorthand', () => {
      const opts = parseArgs(['-p', '8080'], { cwd: CWD });
      expect(opts.port).toBe(8080);
    });

    it('accepts port 1', () => {
      const opts = parseArgs(['--port', '1'], { cwd: CWD });
      expect(opts.port).toBe(1);
    });

    it('accepts port 65535', () => {
      const opts = parseArgs(['--port', '65535'], { cwd: CWD });
      expect(opts.port).toBe(65535);
    });

    it('rejects NaN port', () => {
      expect(() => parseArgs(['--port', 'abc'], { cwd: CWD }))
        .toThrow(ParseError);
      expect(() => parseArgs(['--port', 'abc'], { cwd: CWD }))
        .toThrow('--port must be a valid port number');
    });

    it('rejects port 0', () => {
      expect(() => parseArgs(['--port', '0'], { cwd: CWD }))
        .toThrow('--port must be a valid port number');
    });

    it('rejects port > 65535', () => {
      expect(() => parseArgs(['--port', '70000'], { cwd: CWD }))
        .toThrow('--port must be a valid port number');
    });

    it('rejects negative port', () => {
      expect(() => parseArgs(['--port', '-1'], { cwd: CWD }))
        .toThrow(ParseError);
    });

    it('rejects missing port value', () => {
      expect(() => parseArgs(['--port'], { cwd: CWD }))
        .toThrow('--port requires a value');
    });

    it('rejects when next arg is a flag (--port --build)', () => {
      expect(() => parseArgs(['--port', '--build'], { cwd: CWD }))
        .toThrow('--port requires a value');
    });
  });

  // ── Server port validation ──

  describe('--server-port', () => {
    it('parses a valid server port', () => {
      const opts = parseArgs(['--server-port', '8000'], { cwd: CWD });
      expect(opts.serverPort).toBe(8000);
    });

    it('rejects NaN server port', () => {
      expect(() => parseArgs(['--server-port', 'foo'], { cwd: CWD }))
        .toThrow('--server-port must be a valid port number');
    });

    it('rejects server port 0', () => {
      expect(() => parseArgs(['--server-port', '0'], { cwd: CWD }))
        .toThrow('--server-port must be a valid port number');
    });

    it('rejects server port > 65535', () => {
      expect(() => parseArgs(['--server-port', '99999'], { cwd: CWD }))
        .toThrow('--server-port must be a valid port number');
    });

    it('rejects missing server port value', () => {
      expect(() => parseArgs(['--server-port'], { cwd: CWD }))
        .toThrow('--server-port requires a value');
    });
  });

  // ── Repo path ──

  describe('--repo', () => {
    it('resolves absolute path as-is', () => {
      const opts = parseArgs(['--repo', '/some/absolute/path'], { cwd: CWD });
      expect(opts.repo).toBe('/some/absolute/path');
    });

    it('resolves relative path against cwd', () => {
      const opts = parseArgs(['--repo', 'relative/dir'], { cwd: CWD });
      expect(opts.repo).toBe(resolve(CWD, 'relative/dir'));
    });

    it('accepts -r shorthand', () => {
      const opts = parseArgs(['-r', '/my/repo'], { cwd: CWD });
      expect(opts.repo).toBe('/my/repo');
    });

    it('rejects missing repo value', () => {
      expect(() => parseArgs(['--repo'], { cwd: CWD }))
        .toThrow('--repo requires a value');
    });

    it('rejects when next arg is a flag (--repo --build)', () => {
      expect(() => parseArgs(['--repo', '--build'], { cwd: CWD }))
        .toThrow('--repo requires a value');
    });
  });

  // ── Boolean flags ──

  describe('boolean flags', () => {
    it('--no-browser disables browser', () => {
      const opts = parseArgs(['--no-browser'], { cwd: CWD });
      expect(opts.browser).toBe(false);
    });

    it('--build enables build mode', () => {
      const opts = parseArgs(['--build'], { cwd: CWD });
      expect(opts.build).toBe(true);
    });

    it('--help sets help flag', () => {
      const opts = parseArgs(['--help'], { cwd: CWD });
      expect(opts.help).toBe(true);
    });

    it('-h sets help flag', () => {
      const opts = parseArgs(['-h'], { cwd: CWD });
      expect(opts.help).toBe(true);
    });
  });

  // ── Unknown flags ──

  describe('unknown flags', () => {
    it('rejects unknown flags', () => {
      expect(() => parseArgs(['--unknown'], { cwd: CWD }))
        .toThrow(ParseError);
      expect(() => parseArgs(['--unknown'], { cwd: CWD }))
        .toThrow('Unknown option: --unknown');
    });

    it('rejects unknown short flags', () => {
      expect(() => parseArgs(['-x'], { cwd: CWD }))
        .toThrow('Unknown option: -x');
    });

    it('rejects positional arguments', () => {
      expect(() => parseArgs(['something'], { cwd: CWD }))
        .toThrow('Unknown option: something');
    });
  });

  // ── Combined flags ──

  describe('combined arguments', () => {
    it('parses multiple flags together', () => {
      const opts = parseArgs([
        '--port', '5000',
        '--server-port', '8000',
        '--repo', '/my/repo',
        '--no-browser',
        '--build',
      ], { cwd: CWD });

      expect(opts.port).toBe(5000);
      expect(opts.serverPort).toBe(8000);
      expect(opts.repo).toBe('/my/repo');
      expect(opts.browser).toBe(false);
      expect(opts.build).toBe(true);
    });

    it('last value wins for duplicate --port', () => {
      const opts = parseArgs(['--port', '5000', '--port', '8080'], { cwd: CWD });
      expect(opts.port).toBe(8080);
    });

    it('last value wins for duplicate --repo', () => {
      const opts = parseArgs(['--repo', '/first', '--repo', '/second'], { cwd: CWD });
      expect(opts.repo).toBe('/second');
    });
  });

  // ── Port collision validation ──

  describe('port collision', () => {
    it('rejects when --port equals --server-port', () => {
      expect(() => parseArgs(['--port', '4000'], { cwd: CWD }))
        .toThrow(ParseError);
      expect(() => parseArgs(['--port', '4000'], { cwd: CWD }))
        .toThrow('--port and --server-port must be different');
    });

    it('rejects when --server-port equals default --port', () => {
      expect(() => parseArgs(['--server-port', '3000'], { cwd: CWD }))
        .toThrow('--port and --server-port must be different');
    });

    it('rejects when both are explicitly set to same value', () => {
      expect(() => parseArgs(['--port', '5000', '--server-port', '5000'], { cwd: CWD }))
        .toThrow('--port and --server-port must be different');
    });

    it('allows different ports', () => {
      const opts = parseArgs(['--port', '5000', '--server-port', '8000'], { cwd: CWD });
      expect(opts.port).toBe(5000);
      expect(opts.serverPort).toBe(8000);
    });

    it('skips collision check when --help is set', () => {
      const opts = parseArgs(['--port', '4000', '--help'], { cwd: CWD });
      expect(opts.help).toBe(true);
    });
  });

  // ── requireArg edge cases ──

  describe('requireArg edge cases', () => {
    it('does not consume -p as value for --port', () => {
      expect(() => parseArgs(['--port', '-p'], { cwd: CWD }))
        .toThrow('--port requires a value');
    });

    it('does not consume -r as value for --repo', () => {
      expect(() => parseArgs(['--repo', '-r'], { cwd: CWD }))
        .toThrow('--repo requires a value');
    });
  });

  // ── ParseError type ──

  describe('ParseError', () => {
    it('is an instance of Error', () => {
      const err = new ParseError('test');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ParseError);
      expect(err.name).toBe('ParseError');
      expect(err.message).toBe('test');
    });
  });

  // ── HELP_TEXT ──

  describe('HELP_TEXT', () => {
    it('contains usage information', () => {
      expect(HELP_TEXT).toContain('hermes-monitor');
      expect(HELP_TEXT).toContain('--port');
      expect(HELP_TEXT).toContain('--server-port');
      expect(HELP_TEXT).toContain('--repo');
      expect(HELP_TEXT).toContain('--no-browser');
      expect(HELP_TEXT).toContain('--build');
      expect(HELP_TEXT).toContain('--help');
    });
  });
});
