'use strict';

const { resolve } = require('path');

/**
 * Custom error for argument parsing failures.
 * Separating this from process.exit() makes the parsing logic testable.
 */
class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Parse CLI arguments into an options object.
 *
 * @param {string[]} argv - The arguments (process.argv.slice(2))
 * @param {object}   [defaults] - Override default values (useful for testing)
 * @param {string}   [defaults.cwd] - Working directory for resolving relative --repo paths
 * @returns {{ port: number, serverPort: number, repo: string, browser: boolean, build: boolean, help: boolean }}
 * @throws {ParseError} on invalid arguments
 */
function parseArgs(argv, defaults = {}) {
  const cwd = defaults.cwd || process.cwd();
  const opts = {
    port: 3000,
    serverPort: 4000,
    repo: cwd,
    browser: true,
    build: false,
    help: false,
  };

  function requireArg(flag, i) {
    if (i >= argv.length || argv[i].startsWith('--') || (argv[i].startsWith('-') && argv[i].length > 1)) {
      throw new ParseError(`${flag} requires a value`);
    }
    return argv[i];
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--port':
      case '-p': {
        const raw = requireArg(arg, ++i);
        opts.port = parseInt(raw, 10);
        if (isNaN(opts.port) || opts.port < 1 || opts.port > 65535) {
          throw new ParseError('--port must be a valid port number (1-65535)');
        }
        break;
      }
      case '--server-port': {
        const raw = requireArg(arg, ++i);
        opts.serverPort = parseInt(raw, 10);
        if (isNaN(opts.serverPort) || opts.serverPort < 1 || opts.serverPort > 65535) {
          throw new ParseError('--server-port must be a valid port number (1-65535)');
        }
        break;
      }
      case '--repo':
      case '-r':
        opts.repo = resolve(cwd, requireArg(arg, ++i));
        break;
      case '--no-browser':
        opts.browser = false;
        break;
      case '--build':
        opts.build = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        throw new ParseError(`Unknown option: ${arg}\nRun 'hermes-monitor --help' for usage`);
    }
  }

  return opts;
}

const HELP_TEXT = `
hermes-monitor — start the Hermes Monitor dashboard

Usage:
  hermes-monitor [options]

Options:
  --port, -p <port>        Client port (default: 3000)
  --server-port <port>     Server API port (default: 4000)
  --repo, -r <path>        Target git repo (default: current directory)
  --no-browser             Don't auto-open browser
  --build                  Serve pre-built client (faster startup, no HMR)
  --help, -h               Show this help

Examples:
  hermes-monitor                          # start in current repo
  hermes-monitor --repo ~/projects/myapp  # explicit repo
  hermes-monitor --port 5000              # custom port
  hermes-monitor --server-port 8000       # custom server port
  hermes-monitor --build --no-browser     # production mode, no browser
`;

module.exports = { parseArgs, ParseError, HELP_TEXT };
