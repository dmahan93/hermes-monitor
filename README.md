# Hermes Monitor

Web dashboard for orchestrating AI coding agents. Agents get issues via a
kanban board, work in isolated git worktrees, submit PRs that get adversarial
AI code reviews, and iterate until approved.

## Quick Start
## Install

```bash
cd ~/github/hermes-monitor
npm install
npm link
```

Then from any git repo:

```bash
hermes-monitor                          # start in current repo (hub mode)
hermes-monitor --repo ~/projects/myapp  # explicit repo path
hermes-monitor --port 5000              # custom client port
hermes-monitor --build                  # pre-built client (faster startup)
hermes-monitor --server-port 8000       # custom server API port
hermes-monitor --build --no-browser     # production mode, no browser
```

Or use the install script: `./scripts/install.sh`

To uninstall: `npm unlink -g hermes-monitor`

## Multi-Repo Hub Mode

Hermes Monitor supports managing multiple repositories through a central hub.
The hub runs on port 3000 and provides a landing page with links to each
registered repo's dashboard.

### Hub Commands

```bash
hermes-monitor                          # start repo (auto-starts hub if needed)
hermes-monitor hub                      # start hub landing page only
hermes-monitor hub --foreground         # hub in foreground (for debugging)
hermes-monitor stop                     # stop hub + all running repo instances
```

### Repo Management

```bash
hermes-monitor --list                   # list all registered repos with status
hermes-monitor --add ~/projects/myapp   # register a repo without opening it
hermes-monitor --remove <id>            # unregister a repo by ID
```

### How It Works

1. **Hub Manager** — A lightweight server on `:3000` that tracks registered
   repos in a SQLite database (`~/.hermes/hermes-hub.db`). Provides a landing
   page and registry API. Runs as a background process (PID in `~/.hermes/hub.pid`).

2. **Per-Repo Instances** — Each repo gets its own server+client pair.
   The server port is auto-assigned starting from 4001, and the client (vite)
   runs at server port + 1000 (e.g. server :4001 → client :5001). Running
   `hermes-monitor` in a git repo registers it with the hub and starts the
   instance. `--port` and `--server-port` flags are ignored in hub mode.

3. **Auto-Start** — Running `hermes-monitor` in any git repo automatically
   starts the hub if it isn't already running, registers the repo, and launches
   the dashboard.

### Typical Workflow

```bash
# Terminal 1: Start monitoring project A
cd ~/projects/frontend
hermes-monitor

# Terminal 2: Start monitoring project B
cd ~/projects/backend
hermes-monitor

# Check status from anywhere
hermes-monitor --list

# Hub landing page shows both repos
open http://localhost:3000

# Stop everything
hermes-monitor stop
```

## Quick Start (development)

```bash
npm install          # install all workspaces
npm run dev          # starts server (:4000) + client (:3000)
npm test             # run all tests
```

Server only: `npm run dev:server` | Client only: `npm run dev:client`

The server manages the repo at `HERMES_REPO_PATH` (defaults to parent of
`server/` directory). Set it to point at the repo agents should work on.

### CLI Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port` | `-p` | `3000` | Client port (ignored in hub mode — auto-assigned) |
| `--server-port` | | `4000` | Server API port (ignored in hub mode — auto-assigned) |
| `--repo` | `-r` | cwd | Target git repo path |
| `--no-browser` | | | Don't auto-open browser |
| `--build` | | | Serve pre-built client (no HMR) |
| `--foreground` | | | Run hub in foreground (only with `hub` command) |
| `--list` | `-l` | | List registered repos |
| `--add` | | | Register a repo path |
| `--remove` | | | Unregister a repo by ID |
| `--help` | `-h` | | Show help |

### Commands

| Command | Description |
|---------|-------------|
| `hermes-monitor hub` | Start the multi-repo hub manager |
| `hermes-monitor stop` | Stop the hub and all repo instances |
| `hermes-monitor version` | Show version, git commit hash, and available updates |
| `hermes-monitor update` | Pull latest code, install dependencies, and rebuild |

### Updating

hermes-monitor can update itself since it runs from a cloned git repo:

```bash
hermes-monitor update    # pull latest, npm install, rebuild
```

You can also check your current version:

```bash
hermes-monitor version   # shows version, commit hash, update availability
```

On startup, hermes-monitor automatically checks for updates in the background
(cached for 1 hour) and shows a one-line notice if updates are available.

## Architecture

```
Browser (:3000)                    Server (:4000)
┌─────────────────┐               ┌──────────────────────────┐
│ React + xterm.js │──── WS ──────│ Express + node-pty        │
│                  │──── REST ────│                            │
│ Views:           │              │ Managers:                  │
│  • Kanban board  │              │  • IssueManager (issues)   │
│  • Terminal grid │              │  • TerminalManager (PTYs)  │
│  • PR list/diff  │              │  • WorktreeManager (git)   │
│  • Git graph     │              │  • PRManager (reviews)     │
│  • Manager       │              │  • Store (SQLite)          │
└─────────────────┘               └──────────────────────────┘

Hub Mode:
┌─────────────────┐     ┌──────────────────────────────────┐
│ Hub (:3000)      │     │ Repo A (:4001 server, :5001 UI)  │
│  Landing page    │     │ Repo B (:4002 server, :5002 UI)  │
│  Registry API    │     │ Repo C (:4003 server, :5003 UI)  │
│  ~/.hermes/      │     │ ...                              │
│    hub.pid       │     │                                  │
│    hermes-hub.db │     │                                  │
└─────────────────┘     └──────────────────────────────────┘
```

## Issue Lifecycle

```
backlog → todo → in_progress → review → done
                      │              │
              spawns worktree    creates PR +
              + agent terminal   adversarial reviewer
```

When an issue moves to `in_progress`:
1. Git worktree created on branch `issue/<id>-<slug>`
2. Agent terminal spawned with the issue's command template
3. Agent works, then calls `POST /agent/:id/review` when done
4. PR created from diff, adversarial reviewer agent spawned
5. If changes requested, issue goes back to `in_progress`

## File Map

```
server/src/
  index.ts              Entry point — wires everything together
  hub-server.ts         Hub app factory (createHubApp) — no side effects
  hub-start.ts          Hub CLI entry point — starts server, writes PID
  constants.ts          Shared port constants (mirrors shared/constants.json)
  issue-manager.ts      Issue lifecycle, status transitions, auto-resume
  terminal-manager.ts   PTY session management (node-pty wrapper)
  worktree-manager.ts   Git worktree creation/cleanup
  pr-manager.ts         PR creation, reviewer spawning, merge
  store.ts              SQLite persistence (better-sqlite3)
  config.ts             App configuration (env vars)
  agents.ts             Agent presets (hermes, claude, codex, etc.)

  manager/
    registry.ts         SQLite repo registry (multi-repo tracking)
    registry-api.ts     REST API for repo registry
    proxy.ts            WebSocket proxy (scaffolding for future hub routing)

  issue-api.ts          UI-facing REST: /api/issues/*
  pr-api.ts             UI-facing REST: /api/prs/*, /api/config
  terminal-api.ts       UI-facing REST: /api/terminals/*
  git-api.ts            UI-facing REST: /api/git/*
  agent-api.ts          AGENT-facing REST: /agent/:id/* (called BY agents)

  ws.ts                 WebSocket handler
  types.ts              Server-side type definitions
  screenshot-utils.ts   Screenshot upload/serving utilities

bin/
  hermes-monitor.js     CLI entry point
  lib/parse-args.js     Argument parser
  lib/updater.js        Self-update logic
  lib/hub.js            Hub management utilities

client/src/
  main.tsx              Entry point (React root)
  App.tsx               Main app (view switching, state management)
  types.ts              Client-side type definitions
  hooks/
    useIssues.ts        Issue CRUD + optimistic updates
    useTerminals.ts     Terminal management
    usePRs.ts           PR list + detail fetching
    useWebSocket.ts     WS connection with auto-reconnect
    useAgents.ts        Agent preset fetching
    useGitGraph.ts      Git log/graph data
  components/
    Header.tsx          Top navigation bar
    ViewSwitcher.tsx    View tab switching
    StatusBar.tsx       Bottom status bar
    HubLanding.tsx      Multi-repo landing page
    KanbanBoard.tsx     Kanban board (columns + drag-drop)
    KanbanColumn.tsx    Single kanban column
    BacklogSection.tsx  Backlog issue list
    IssueCard.tsx       Issue card in kanban
    IssueDetail.tsx     Issue detail modal
    NewIssueModal.tsx   Issue creation modal
    PlanningPane.tsx    Planning terminal for backlog issues
    TerminalGrid.tsx    Resizable terminal grid
    TerminalPane.tsx    Terminal pane wrapper
    TerminalView.tsx    xterm.js terminal instance
    TaskTerminalPane.tsx  Agent terminal with task context
    AgentTerminalList.tsx Agent terminal sidebar
    PRList.tsx          PR list view
    PRDetail.tsx        PR detail with diff viewer
    DiffViewer.tsx      Unified diff rendering
    DiffViewer.css      Diff viewer styles
    GitGraph.tsx        Git commit graph visualization
    GitGraph.css        Git graph styles
    ConfigView.tsx      App configuration UI
    MarkdownContent.tsx Markdown rendering utility
```

## API Overview

Two APIs exist:
- **UI API** (`/api/*`) — called by the React frontend
- **Agent API** (`/agent/*`) — called by agents during task execution
- **Hub API** (`/api/hub/*`) — registry management for multi-repo mode

See [docs/API.md](docs/API.md) for the complete API reference.

### Key Agent Endpoints

```bash
# Agent gets task context (worktree path, previous reviews, etc.)
curl http://localhost:4000/agent/:id/info

# Agent submits for review when done
curl -X POST http://localhost:4000/agent/:id/review
```

### Hub API Endpoints

```bash
# List registered repos
curl http://localhost:3000/api/hub/repos

# Register a repo
curl -X POST http://localhost:3000/api/hub/repos \
  -H 'Content-Type: application/json' \
  -d '{"path": "/home/user/projects/myapp"}'

# Unregister a repo
curl -X DELETE http://localhost:3000/api/hub/repos/{id}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `HUB_PORT` | `3000` | Hub manager port |
| `HERMES_REPO_PATH` | `..` (parent dir) | Git repo agents work on |
| `HERMES_WORKTREE_BASE` | `/tmp/hermes-worktrees` | Where worktrees are created |
| `HERMES_REVIEW_BASE` | `/tmp/hermes-reviews` | Where review files are written |
| `HERMES_SCREENSHOT_BASE` | `/tmp/hermes-screenshots` | Where screenshots are stored |
| `HERMES_DB_PATH` | `../hermes-monitor.db` | SQLite database path |
| `HERMES_REQUIRE_SCREENSHOTS` | `true` | Require screenshots for UI changes |

## Agent Presets

| ID | Name | Description |
|----|------|-------------|
| `hermes` | Hermes | Nous Research agent (default) |
| `claude` | Claude Code | Anthropic coding agent |
| `codex` | Codex | OpenAI Codex CLI |
| `gemini` | Gemini CLI | Google Gemini |
| `aider` | Aider | AI pair programming |
| `shell` | Shell | Plain bash (manual) |
| `custom` | Custom | User-defined command |

## Development

```bash
npm run test:server    # server tests
npm run test:client    # client tests
npm run test:e2e       # e2e tests (playwright)
```

See [PLAN.md](PLAN.md) for the current development roadmap.
