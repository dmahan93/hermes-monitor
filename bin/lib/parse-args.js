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

/** Recognized subcommands that don't start the server */
const SUBCOMMANDS = ['update', 'version', 'hub', 'stop'];

/**
 * Parse CLI arguments into an options object.
 *
 * @param {string[]} argv - The arguments (process.argv.slice(2))
 * @param {object}   [defaults] - Override default values (useful for testing)
 * @param {string}   [defaults.cwd] - Working directory for resolving relative --repo paths
 * @returns {{ command: string|null, port: number, serverPort: number, repo: string, browser: boolean, build: boolean, help: boolean, foreground: boolean, list: boolean, add: string|null, remove: string|null }}
 * @throws {ParseError} on invalid arguments
 */
function parseArgs(argv, defaults = {}) {
  const cwd = defaults.cwd || process.cwd();
  const opts = {
    command: null,
    port: 3000,
    serverPort: 4000,
    repo: cwd,
    browser: true,
    build: false,
    help: false,
    foreground: false,
    list: false,
    add: null,
    remove: null,
    _explicit: new Set(), // tracks which flags were explicitly set
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
        opts._explicit.add('port');
        break;
      }
      case '--server-port': {
        const raw = requireArg(arg, ++i);
        opts.serverPort = parseInt(raw, 10);
        if (isNaN(opts.serverPort) || opts.serverPort < 1 || opts.serverPort > 65535) {
          throw new ParseError('--server-port must be a valid port number (1-65535)');
        }
        opts._explicit.add('serverPort');
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
      case '--foreground':
        opts.foreground = true;
        break;
      case '--list':
      case '-l':
        opts.list = true;
        break;
      case '--add': {
        opts.add = resolve(cwd, requireArg(arg, ++i));
        break;
      }
      case '--remove': {
        opts.remove = requireArg(arg, ++i);
        break;
      }
      case '--help':
      case '-h':
        opts.help = true;
        break;
      default:
        // Check for subcommands (only valid as first argument, no command set yet)
        if (i === 0 && SUBCOMMANDS.includes(arg)) {
          opts.command = arg;
          break;
        }
        throw new ParseError(`Unknown option: ${arg}\nRun 'hermes-monitor --help' for usage`);
    }
  }

  // Validate --foreground is only used with 'hub' command
  if (opts.foreground && opts.command !== 'hub') {
    throw new ParseError('--foreground can only be used with the "hub" command');
  }

  // Validate port collision (skip when just showing help, running a subcommand,
  // or using hub management flags)
  if (!opts.help && !opts.command && !opts.list && !opts.add && !opts.remove &&
      opts.port === opts.serverPort) {
    throw new ParseError('--port and --server-port must be different');
  }

  return opts;
}

const HELP_TEXT = `
hermes-monitor — AI agent orchestration dashboard

Usage:
  hermes-monitor [options]        Start monitoring current repo (auto-starts hub)
  hermes-monitor <command>

Commands:
  hub                            Start the multi-repo hub manager
  stop                           Stop the hub and all repo instances
  update                         Pull latest code, install deps, rebuild
  version                        Show version, commit hash, and available updates

Hub Management:
  --list, -l                     List all registered repos with status
  --add <path>                   Register a repo without opening it
  --remove <id>                  Unregister a repo by ID

Options:
  --port, -p <port>              Client port (ignored in hub mode — auto-assigned)
  --server-port <port>           Server API port (ignored in hub mode — auto-assigned)
  --repo, -r <path>              Target git repo (default: current directory)
  --no-browser                   Don't auto-open browser
  --build                        Serve pre-built client (faster startup, no HMR)
  --foreground                   Run hub in foreground (default: background)
  --help, -h                     Show this help

Examples:
  hermes-monitor                          # start in current repo (hub mode)
  hermes-monitor hub                      # start hub landing page only
  hermes-monitor hub --foreground         # hub in foreground (for debugging)
  hermes-monitor --list                   # list all registered repos
  hermes-monitor --add ~/projects/myapp   # register a repo
  hermes-monitor --remove <id>            # unregister a repo
  hermes-monitor stop                     # stop hub + all repos
  hermes-monitor --repo ~/projects/myapp  # explicit repo
  hermes-monitor --build --no-browser     # production mode, no browser
  hermes-monitor --port 5000              # custom port
  hermes-monitor --server-port 8000       # custom server port
  hermes-monitor version                  # show version info
  hermes-monitor update                   # self-update
`;

module.exports = { parseArgs, ParseError, HELP_TEXT, SUBCOMMANDS };
