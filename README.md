# Hermes Monitor

Web dashboard for orchestrating AI coding agents. Agents get tickets via a
kanban board, work in isolated git worktrees, submit PRs that get adversarial
AI code reviews, and iterate until approved.

## Quick Start

```bash
npm install          # install all workspaces
npm run dev          # starts server (:4000) + client (:3000)
npm test             # run all tests
```

Server only: `npm run dev:server` | Client only: `npm run dev:client`

The server manages the repo at `HERMES_REPO_PATH` (defaults to parent of
`server/` directory). Set it to point at the repo agents should work on.

## Architecture

```
Browser (:3000)                    Server (:4000)
┌─────────────────┐               ┌──────────────────────────┐
│ React + xterm.js │──── WS ──────│ Express + node-pty        │
│                  │──── REST ────│                            │
│ Views:           │              │ Managers:                  │
│  • Kanban board  │              │  • IssueManager (tickets)  │
│  • Terminal grid │              │  • TerminalManager (PTYs)  │
│  • PR list/diff  │              │  • WorktreeManager (git)   │
│  • Git graph     │              │  • PRManager (reviews)     │
│  • Research      │              │  • Store (SQLite)          │
└─────────────────┘               └──────────────────────────┘
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
3. Agent works, then calls `POST /ticket/:id/review` when done
4. PR created from diff, adversarial reviewer agent spawned
5. If changes requested, issue goes back to `in_progress`

## File Map

```
server/src/
  index.ts              Entry point — wires everything together
  issue-manager.ts      Issue lifecycle, status transitions, auto-resume
  terminal-manager.ts   PTY session management (node-pty wrapper)
  worktree-manager.ts   Git worktree creation/cleanup
  pr-manager.ts         PR creation, reviewer spawning, merge
  store.ts              SQLite persistence (better-sqlite3)
  config.ts             App configuration (env vars)
  agents.ts             Agent presets (hermes, claude, codex, etc.)

  issue-api.ts          UI-facing REST: /api/issues/*
  pr-api.ts             UI-facing REST: /api/prs/*, /api/config
  terminal-api.ts       UI-facing REST: /api/terminals/*
  git-api.ts            UI-facing REST: /api/git/*
  ticket-api.ts         AGENT-facing REST: /ticket/:id/* (called BY agents)

  ws.ts                 WebSocket handler
  types.ts              Server-side type definitions
  screenshot-utils.ts   Screenshot upload/serving utilities

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
    ResearchView.tsx    Research/exploration view
    ConfigView.tsx      App configuration UI
    MarkdownContent.tsx Markdown rendering utility
```

## API Overview

Two APIs exist:
- **UI API** (`/api/*`) — called by the React frontend
- **Agent API** (`/ticket/*`) — called by agents during task execution

See [docs/API.md](docs/API.md) for the complete API reference.

### Key Agent Endpoints

```bash
# Agent gets task context (worktree path, previous reviews, etc.)
curl http://localhost:4000/ticket/:id/info

# Agent submits for review when done
curl -X POST http://localhost:4000/ticket/:id/review
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
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
