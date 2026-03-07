# Hermes Monitor API Reference

Base URL: `http://localhost:4000`

Two API surfaces:
- **UI API** (`/api/*`) — called by the React frontend and external tools
- **Agent API** (`/ticket/*`) — called by agents during task execution

---

## Agent API (called BY agents)

These endpoints are what agents call to get their task context and signal
completion. Defined in `server/src/ticket-api.ts`.

### GET /ticket/:id/info

Returns everything the agent needs to execute its task.

**Response:**
```json
{
  "id": "uuid",
  "title": "Fix the login bug",
  "description": "Users can't log in on mobile",
  "branch": "issue/abc123-fix-the-login-bug",
  "worktreePath": "/tmp/hermes-worktrees/uuid/",
  "repoPath": "/home/user/project",
  "targetBranch": "master",
  "previousReviews": [
    { "author": "hermes-reviewer", "verdict": "changes_requested", "body": "...", "createdAt": 123 }
  ],
  "reviewUrl": "http://localhost:4000/ticket/uuid/review",
  "screenshotUploadUrl": "http://localhost:4000/ticket/uuid/screenshots",
  "screenshotUploadInstructions": "...",
  "guidelines": {
    "screenshots": "...",
    "requireScreenshotsForUiChanges": true
  }
}
```

### POST /ticket/:id/review

Agent calls this when done working. Kills agent terminal, creates PR, 
spawns adversarial reviewer.

**Request body (optional):**
```json
{ "details": "Notes about what was changed" }
```

**Query params:**
- `no_ui_changes=true` — bypass screenshot requirement

**Response:**
```json
{ "ok": true, "status": "review", "message": "..." }
```

**Error (400):** Returns if UI files were changed but no screenshots uploaded.

### POST /ticket/:id/screenshots

Upload a screenshot for the task.

```bash
curl -X POST --data-binary @screenshot.png \
  -H 'Content-Type: image/png' \
  'http://localhost:4000/ticket/:id/screenshots?filename=my-screenshot.png&description=Before+changes'
```

**Response (201):**
```json
{ "url": "/screenshots/id/file.png", "fullUrl": "http://...", "markdown": "![...](http://...)", "filename": "..." }
```

### GET /ticket/:id/screenshots

List uploaded screenshots for a ticket.

---

## Issues API

Defined in `server/src/issue-api.ts`.

### GET /api/issues

List all issues.

**Response:** `Issue[]`

### GET /api/issues/:id

Get a single issue.

### POST /api/issues

Create a new issue (starts in `backlog` status).

**Request body:**
```json
{
  "title": "Fix the bug",           // required
  "description": "...",             // optional
  "agent": "hermes",               // optional, default: "hermes"
  "command": "custom command...",   // optional, overrides preset
  "branch": "custom-branch",       // optional
  "parentId": "uuid"               // optional, makes this a subtask
}
```

**Response (201):** `Issue`

### PATCH /api/issues/:id

Update issue fields (title, description, command, branch).

### PATCH /api/issues/:id/status

Change issue status. This is the trigger for all side effects:

| Transition | Side Effect |
|-----------|-------------|
| → `in_progress` | Creates worktree + spawns agent terminal |
| → `review` | Creates PR + spawns adversarial reviewer |
| → `done` | Kills terminal, cleans up worktree |
| → `backlog`/`todo` | Kills terminal if running |

**Request body:**
```json
{ "status": "in_progress" }
```

Valid statuses: `backlog`, `todo`, `in_progress`, `review`, `done`

### DELETE /api/issues/:id

Delete issue (cascade-deletes subtasks, kills terminal, cleans worktree).

### GET /api/issues/:id/subtasks

List subtasks of an issue.

### POST /api/issues/:id/subtasks

Create a subtask under an issue. Same body as POST /api/issues.

### POST /api/issues/:id/plan

Start a planning terminal for a backlog issue.

### DELETE /api/issues/:id/plan

Stop the planning terminal.

---

## Agents API

### GET /api/agents

List available agent presets with install status.

**Response:** `AgentPreset[]` with `installed: boolean` field.

---

## Terminals API

Defined in `server/src/terminal-api.ts`.

### GET /api/terminals

List all active terminals.

### POST /api/terminals

Create a manual terminal.

**Request body:**
```json
{ "title": "My terminal", "command": "bash", "cwd": "/path", "cols": 80, "rows": 24 }
```

### DELETE /api/terminals/:id

Kill a terminal.

### POST /api/terminals/:id/resize

Resize a terminal. Body: `{ "cols": 120, "rows": 40 }`

---

## Pull Requests API

Defined in `server/src/pr-api.ts`.

### GET /api/prs

List all PRs (enriched with screenshot data).

### GET /api/prs/:id

Get single PR with comments and screenshots.

### POST /api/prs/:id/comments

Add a comment to a PR.

**Request body:**
```json
{ "author": "human", "body": "Looks good!", "file": "src/index.ts", "line": 42 }
```

### POST /api/prs/:id/verdict

Set verdict on a PR.

**Request body:**
```json
{ "verdict": "approved" }  // or "changes_requested"
```

### POST /api/prs/:id/relaunch-review

Kill existing reviewer and spawn a new one. Cannot relaunch on merged/closed PRs.

### GET /api/prs/:id/merge-check

Check if merge would have conflicts (dry-run, async).

**Response:**
```json
{ "canMerge": true, "hasConflicts": false }
```

### POST /api/prs/:id/fix-conflicts

Spawn an agent to resolve merge conflicts.

### POST /api/prs/:id/merge

Merge the PR branch. Also moves the linked issue to `done`.

### GET /api/prs/:id/screenshots

List screenshots associated with a PR (via its linked issue).

---

## Config API

### GET /api/config

Get current app configuration.

### PATCH /api/config

Update configuration.

**Request body:**
```json
{ "repoPath": "/path/to/repo", "targetBranch": "main", "requireScreenshotsForUiChanges": true }
```

---

## Git API

Defined in `server/src/git-api.ts`. All endpoints validate inputs to prevent injection.

### GET /api/git/log

Get commit graph for the repo.

**Query params:**
- `limit` — max commits (default: 50, max: 200)
- `branch` — branch name or `--all` (default: `--all`)

**Response:**
```json
{ "commits": [GitCommit], "graph": [GraphNode] }
```

### GET /api/git/show/:sha

Get files changed in a commit with additions/deletions.

### GET /api/git/diff/:sha

Get full diff for a commit. Optional `?file=path` for single-file diff.

### GET /api/git/branches

List all branches.

---

## WebSocket Protocol

Connect to `ws://localhost:4000/ws`

### Client → Server

```json
{ "type": "stdin",  "terminalId": "uuid", "data": "ls\n" }
{ "type": "resize", "terminalId": "uuid", "cols": 120, "rows": 40 }
```

### Server → Client

```json
{ "type": "stdout", "terminalId": "uuid", "data": "..." }
{ "type": "exit",   "terminalId": "uuid", "exitCode": 0 }
{ "type": "error",  "terminalId": "uuid", "message": "..." }

{ "type": "issue:created", "issue": Issue }
{ "type": "issue:updated", "issue": Issue }
{ "type": "issue:deleted", "issueId": "uuid" }

{ "type": "pr:created", "pr": PullRequest }
{ "type": "pr:updated", "pr": PullRequest }
{ "type": "pr:comment", "prId": "uuid", "comment": PRComment }
```
