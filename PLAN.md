# Hermes Monitor — Plan

## Vision

A web dashboard for orchestrating and monitoring Hermes agents. The full app
will include a kanban board, a custom PR system (agents work in worktrees/docker
images on branches, open PRs through the dashboard), and a git viewer.

**Phase 1 (this doc):** Terminal monitoring grid — view and interact with
multiple agent terminal sessions in an adjustable grid layout.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (React)                   │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ xterm.js │  │ xterm.js │  │ xterm.js │  ...      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                │
│  react-grid-layout (drag / resize / rearrange)      │
└───────┼──────────────┼──────────────┼───────────────┘
        │ WebSocket    │              │
        ▼              ▼              ▼
┌─────────────────────────────────────────────────────┐
│               Express + WS Server (:4000)           │
│                                                     │
│  REST API            WebSocket                      │
│  ─────────           ─────────                      │
│  POST /api/terminals      ws://host:4000/ws         │
│  GET  /api/terminals      - multiplexed per termId  │
│  DELETE /api/terminals/:id  - stdin/stdout/resize    │
│  POST /api/terminals/:id/resize                     │
│                                                     │
│  TerminalManager                                    │
│  ────────────────                                   │
│  Wraps node-pty. Manages lifecycle of PTY sessions. │
│  Each terminal has: id, title, cols, rows, pid,     │
│  createdAt, shell command.                          │
└─────────────────────────────────────────────────────┘
        │
        ▼  node-pty
┌─────────────────┐
│  PTY sessions   │
│  (bash, etc.)   │
└─────────────────┘
```

---

## Tech Stack

| Layer     | Tech                                          |
|-----------|-----------------------------------------------|
| Frontend  | Vite + React 19 + TypeScript                  |
| Terminals | xterm.js + @xterm/addon-fit + @xterm/addon-web-links |
| Grid      | react-grid-layout                             |
| Backend   | Express + ws (WebSocket)                      |
| PTY       | node-pty                                      |
| Tests     | Vitest (unit/integration), playwright-cli (e2e)|
| Styling   | CSS modules or plain CSS (keep it simple)     |

---

## Data Model

### Terminal

```typescript
interface Terminal {
  id: string;           // uuid
  title: string;        // user-settable label
  command: string;      // shell command (default: user's $SHELL)
  cols: number;         // terminal columns
  rows: number;         // terminal rows
  pid: number;          // OS process id
  createdAt: number;    // unix timestamp ms
}
```

### Grid Layout Item

```typescript
interface GridItem {
  i: string;            // terminal id
  x: number;            // grid x position
  y: number;            // grid y position
  w: number;            // grid width (in grid units)
  h: number;            // grid height (in grid units)
}
```

### WebSocket Protocol

Messages are JSON with a `type` field:

```
Client -> Server:
  { type: "stdin",  terminalId: string, data: string }
  { type: "resize", terminalId: string, cols: number, rows: number }

Server -> Client:
  { type: "stdout", terminalId: string, data: string }
  { type: "exit",   terminalId: string, exitCode: number }
  { type: "error",  terminalId: string, message: string }
```

---

## REST API

| Method | Path                         | Body / Params          | Response                |
|--------|------------------------------|------------------------|-------------------------|
| GET    | /api/terminals               | —                      | Terminal[]              |
| POST   | /api/terminals               | { title?, command?, cols?, rows? } | Terminal       |
| DELETE | /api/terminals/:id           | —                      | { ok: true }            |
| POST   | /api/terminals/:id/resize    | { cols, rows }         | { ok: true }            |

---

## Frontend Components

```
App
├── Header          — app title, "Add Terminal" button
├── TerminalGrid    — react-grid-layout wrapper
│   └── TerminalPane (×N)
│       ├── PaneHeader   — title, close button, drag handle
│       └── TerminalView — xterm.js instance
└── StatusBar       — connection status, terminal count
```

---

## File Structure

```
hermes-monitor/
├── PLAN.md
├── package.json              # workspace root
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts          # express + ws server entry
│   │   ├── terminal-manager.ts
│   │   ├── api.ts            # REST routes
│   │   └── ws.ts             # WebSocket handler
│   └── __tests__/
│       ├── terminal-manager.test.ts
│       ├── api.test.ts
│       └── ws.test.ts
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── App.css
│   │   ├── components/
│   │   │   ├── Header.tsx
│   │   │   ├── StatusBar.tsx
│   │   │   ├── TerminalGrid.tsx
│   │   │   ├── TerminalPane.tsx
│   │   │   └── TerminalView.tsx
│   │   ├── hooks/
│   │   │   ├── useTerminals.ts
│   │   │   └── useWebSocket.ts
│   │   └── types.ts
│   └── __tests__/
│       ├── components/
│       │   ├── TerminalGrid.test.tsx
│       │   ├── TerminalPane.test.tsx
│       │   └── Header.test.tsx
│       └── hooks/
│           ├── useTerminals.test.ts
│           └── useWebSocket.test.ts
└── e2e/
    ├── package.json
    ├── tests/
    │   ├── terminal-grid.spec.ts
    │   ├── terminal-interaction.spec.ts
    │   └── grid-layout.spec.ts
    └── helpers/
        └── setup.ts
```

---

## Test Plan

### 1. Server Unit Tests (`server/__tests__/terminal-manager.test.ts`)

| # | Test                                           | What it verifies                                    |
|---|------------------------------------------------|-----------------------------------------------------|
| 1 | spawns a terminal with default shell           | creates PTY, returns Terminal object with pid        |
| 2 | spawns a terminal with custom command           | runs specified command instead of $SHELL             |
| 3 | lists all active terminals                      | returns array of all spawned terminals               |
| 4 | gets a terminal by id                           | returns correct terminal, undefined for bad id       |
| 5 | kills a terminal                                | process exits, removed from list                     |
| 6 | resizes a terminal                              | PTY cols/rows update                                 |
| 7 | emits data events from PTY                      | onData callback fires with stdout                    |
| 8 | emits exit events                               | onExit callback fires when process ends              |
| 9 | writes stdin to PTY                             | data written appears in PTY output                   |
| 10| handles killing nonexistent terminal gracefully | no throw, returns false                              |
| 11| cleans up all terminals on shutdown             | killAll() terminates everything                      |

### 2. Server API Tests (`server/__tests__/api.test.ts`)

| # | Test                                           | What it verifies                                    |
|---|------------------------------------------------|-----------------------------------------------------|
| 1 | POST /api/terminals creates terminal           | 201, returns Terminal with id                        |
| 2 | POST /api/terminals with custom title/command  | respects provided options                            |
| 3 | GET /api/terminals lists all terminals          | 200, returns array                                   |
| 4 | GET /api/terminals when empty                  | 200, returns []                                      |
| 5 | DELETE /api/terminals/:id kills terminal       | 200, terminal gone from list                         |
| 6 | DELETE /api/terminals/:id with bad id          | 404                                                  |
| 7 | POST /api/terminals/:id/resize                 | 200, terminal dimensions updated                     |
| 8 | POST /api/terminals/:id/resize bad id          | 404                                                  |
| 9 | POST /api/terminals/:id/resize bad body        | 400                                                  |

### 3. Server WebSocket Tests (`server/__tests__/ws.test.ts`)

| # | Test                                           | What it verifies                                    |
|---|------------------------------------------------|-----------------------------------------------------|
| 1 | client connects successfully                   | ws open event fires                                  |
| 2 | stdin message forwarded to PTY                 | data appears in terminal                             |
| 3 | PTY stdout forwarded to client                 | client receives stdout message                       |
| 4 | resize message updates PTY dimensions          | terminal cols/rows change                            |
| 5 | terminal exit sends exit message               | client gets exit event with code                     |
| 6 | invalid message format handled gracefully      | no crash, error message sent back                    |
| 7 | invalid terminalId handled gracefully          | error message sent back                              |
| 8 | client disconnect doesn't kill terminals       | terminals persist after ws close                     |
| 9 | multiple clients receive same terminal output  | broadcast to all connected clients                   |

### 4. Frontend Component Tests (`client/__tests__/`)

| # | Test                                           | What it verifies                                    |
|---|------------------------------------------------|-----------------------------------------------------|
| 1 | Header renders title and add button            | elements present in DOM                              |
| 2 | Header add button calls onAdd                  | callback fires on click                              |
| 3 | TerminalGrid renders panes for each terminal   | correct number of panes                              |
| 4 | TerminalGrid handles empty state               | shows helpful message                                |
| 5 | TerminalPane renders header with title          | title displayed                                      |
| 6 | TerminalPane close button calls onClose        | callback fires                                       |
| 7 | TerminalPane mounts xterm instance             | terminal DOM element created                         |
| 8 | useTerminals hook fetches on mount             | calls GET /api/terminals                             |
| 9 | useTerminals.addTerminal calls POST            | creates terminal via API                             |
| 10| useTerminals.removeTerminal calls DELETE       | removes terminal via API                             |
| 11| useWebSocket hook connects on mount            | WebSocket opened                                     |
| 12| useWebSocket hook reconnects on disconnect     | auto-reconnect with backoff                          |

### 5. E2E Tests (`e2e/tests/`) — playwright-cli

| # | Test                                           | What it verifies                                    |
|---|------------------------------------------------|-----------------------------------------------------|
| 1 | app loads and shows header                     | title visible, add button present                    |
| 2 | add terminal creates a new pane                | clicking add shows new terminal in grid              |
| 3 | terminal displays shell prompt                 | PTY output renders in xterm                          |
| 4 | typing in terminal sends input                 | keystrokes appear, commands execute                  |
| 5 | close terminal removes pane                    | pane disappears from grid                            |
| 6 | multiple terminals work independently          | can type in different terminals                      |
| 7 | grid panes can be resized                      | drag resize handle changes pane size                 |
| 8 | grid panes can be rearranged                   | drag pane to new position                            |
| 9 | page reload preserves terminals                | terminals reconnect after refresh                    |
| 10| status bar shows connection state              | connected/disconnected indicator works               |

---

## Implementation Order

1. Server: TerminalManager class + unit tests
2. Server: REST API + API tests
3. Server: WebSocket handler + WS tests
4. Client: scaffolding (Vite, types, hooks)
5. Client: TerminalView (xterm.js wrapper)
6. Client: TerminalPane + TerminalGrid (react-grid-layout)
7. Client: Header + StatusBar + App assembly
8. Client: component tests
9. E2E: playwright-cli tests
10. Polish: styling, error handling, reconnection

---

---

## Phase 2: Kanban Board + Agent Spawn

### Overview

A kanban board where issues flow through columns. The key behavior:
**dragging an issue to IN PROGRESS automatically spawns a terminal and
starts an agent**. Moving it out kills the terminal.

### Columns

| Column      | Behavior                                        |
|-------------|-------------------------------------------------|
| TODO        | Backlog. No terminal.                           |
| IN PROGRESS | Spawns terminal, runs agent command.            |
| REVIEW      | Terminal stays open (agent may still be working).|
| DONE        | Kills terminal if still running.                |

### Data Model: Issue

```typescript
interface Issue {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'review' | 'done';
  command: string;        // template: "hermes --task '{{title}}'"
  terminalId: string | null;
  branch: string | null;  // git branch for this issue
  createdAt: number;
  updatedAt: number;
}
```

### Command Templates

Issues have a `command` field that supports variable interpolation:
- `{{id}}` — issue id
- `{{title}}` — issue title
- `{{description}}` — issue description  
- `{{branch}}` — git branch name

Default command: user's `$SHELL` (just opens a terminal).

### Status Transitions

```
TODO ──→ IN PROGRESS: spawn terminal with issue.command
IN PROGRESS ──→ REVIEW: terminal stays alive
IN PROGRESS ──→ TODO: kill terminal
REVIEW ──→ DONE: kill terminal  
REVIEW ──→ IN PROGRESS: no-op (terminal still alive)
DONE ──→ TODO: no terminal action
```

### API Additions

| Method | Path                      | Body               | Response    |
|--------|---------------------------|---------------------|-------------|
| GET    | /api/issues               | —                   | Issue[]     |
| POST   | /api/issues               | { title, ... }      | Issue       |
| PATCH  | /api/issues/:id           | { title?, desc?, ...} | Issue     |
| PATCH  | /api/issues/:id/status    | { status }          | Issue       |
| DELETE | /api/issues/:id           | —                   | { ok: true }|

### WebSocket Additions

```
Server -> Client:
  { type: "issue:created", issue: Issue }
  { type: "issue:updated", issue: Issue }
  { type: "issue:deleted", issueId: string }
```

### Frontend Components

```
App
├── Header
├── ViewSwitcher      — toggle between terminal grid and kanban
├── KanbanBoard
│   ├── KanbanColumn (×4: todo, in_progress, review, done)
│   │   └── IssueCard (×N)
│   │       ├── title, description preview
│   │       ├── terminal status indicator
│   │       └── branch name
│   └── NewIssueModal
├── TerminalGrid      — (existing, from Phase 1)
└── StatusBar
```

### Test Plan: Phase 2

#### Server Tests: IssueManager

| # | Test                                          |
|---|-----------------------------------------------|
| 1 | creates issue with defaults                   |
| 2 | creates issue with custom fields              |
| 3 | lists all issues                              |
| 4 | gets issue by id                              |
| 5 | updates issue fields                          |
| 6 | deletes issue                                 |
| 7 | status change to in_progress spawns terminal  |
| 8 | status change to done kills terminal          |
| 9 | status change todo→in_progress→todo kills term|
| 10| command template variables are interpolated   |

#### Server Tests: Issue API

| # | Test                                          |
|---|-----------------------------------------------|
| 1 | POST /api/issues creates issue                |
| 2 | GET /api/issues lists issues                  |
| 3 | PATCH /api/issues/:id updates issue           |
| 4 | PATCH /api/issues/:id/status changes status   |
| 5 | PATCH /api/issues/:id/status spawns terminal  |
| 6 | DELETE /api/issues/:id removes issue          |
| 7 | operations on nonexistent issue return 404    |

#### Client Tests: Kanban Components

| # | Test                                          |
|---|-----------------------------------------------|
| 1 | KanbanBoard renders 4 columns                |
| 2 | IssueCard renders title and description       |
| 3 | IssueCard shows terminal status indicator     |
| 4 | NewIssueModal opens and submits               |
| 5 | ViewSwitcher toggles between grid and kanban  |

#### E2E Tests

| # | Test                                          |
|---|-----------------------------------------------|
| 1 | kanban view loads with 4 columns              |
| 2 | create issue via modal                        |
| 3 | drag issue to in_progress spawns terminal     |
| 4 | terminal appears in grid view                 |
| 5 | move issue to done kills terminal             |

---

## Future Phases (not in scope yet)

- **Phase 3:** Custom PR system (worktrees/docker, branch management)
- **Phase 4:** Git viewer (diff, log, blame, file browser)
- **Phase 5:** Full agent orchestration
