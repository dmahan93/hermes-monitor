# Hermes Monitor API Reference

Base URL: `http://localhost:4000`

Two API surfaces:
- **UI API** (`/api/*`) — called by the React frontend and external tools
- **Agent API** (`/agent/*`) — called by agents during task execution

---

## Agent API (called BY agents)

These endpoints are what agents call to get their task context and signal
completion. Defined in `server/src/agent-api.ts`.

### GET /agent/:id/info

Returns everything the agent needs to execute its task, including rework context
when the agent is on a subsequent review cycle.

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
  "isRework": true,
  "attempt": 2,
  "changedFiles": ["src/auth.ts", "src/auth.test.ts"],
  "previousReviews": [
    {
      "author": "hermes-reviewer",
      "verdict": "changes_requested",
      "body": "VERDICT: CHANGES_REQUESTED\n- Missing null check in auth handler\n- Add test for expired tokens",
      "createdAt": 1700000002,
      "isLatest": true,
      "actionItems": ["Missing null check in auth handler", "Add test for expired tokens"]
    },
    {
      "author": "hermes-reviewer",
      "verdict": "changes_requested",
      "body": "...",
      "createdAt": 1700000001,
      "isLatest": false,
      "actionItems": []
    }
  ],
  "recentMerges": [
    {
      "title": "Add user profile page",
      "changedFiles": ["src/profile.ts", "src/routes.ts"],
      "mergedAt": 1700000000
    }
  ],
  "reviewUrl": "http://localhost:4000/agent/uuid/review",
  "screenshotUploadUrl": "http://localhost:4000/agent/uuid/screenshots",
  "screenshotUploadInstructions": "...",
  "guidelines": {
    "screenshots": "...",
    "requireScreenshotsForUiChanges": true
  }
}
```

**Rework context fields:**

| Field | Type | Description |
|-------|------|-------------|
| `isRework` | `boolean` | `true` if the issue has been in review before (a PR exists) |
| `attempt` | `number` | Which review cycle this is (1 = first attempt, 2 = first rework, etc.). Counts all comments containing a `VERDICT:` line, regardless of author. |
| `changedFiles` | `string[]` | Files the agent changed in its branch (from `git diff --name-only`) |
| `previousReviews` | `ReviewInfo[]` | All PR comments sorted **latest first**. Each has a `verdict` parsed from that comment's body (not the PR-level verdict — can be `null` for comments without a `VERDICT:` line). `isLatest` flag is set on the latest `hermes-reviewer` comment specifically. `actionItems` are extracted bullet/numbered items, excluding `VERDICT:` lines. |
| `recentMerges` | `RecentMerge[]` | Last 5 merged PRs (excluding the current issue's own PR) with titles and changed files (warns about potential conflicts) |

### POST /agent/:id/review

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

### POST /agent/:id/screenshots

Upload a screenshot for the task.

```bash
curl -X POST --data-binary @screenshot.png \
  -H 'Content-Type: image/png' \
  'http://localhost:4000/agent/:id/screenshots?filename=my-screenshot.png&description=Before+changes'
```

**Response (201):**
```json
{ "url": "/screenshots/id/file.png", "fullUrl": "http://...", "markdown": "![...](http://...)", "filename": "..." }
```

### GET /agent/:id/screenshots

List uploaded screenshots for an issue.

### POST /agent/:id/progress

Report structured progress during agent execution. Progress is transient
(in-memory only, not persisted to SQLite) and automatically cleared when the
issue leaves `in_progress` status.

**Request body:**
```json
{ "message": "Running tests...", "percent": 75 }
```

Both fields are optional, but at least one must be provided. An empty body
`{}` is rejected with 400.

**Validation rules:**

| Field | Type | Constraints |
|-------|------|-------------|
| `message` | `string` | Optional. Must be a string if provided. Truncated to 200 characters server-side. |
| `percent` | `number` | Optional. Must be a finite number between 0 and 100 (inclusive). `NaN`, `Infinity`, and `-Infinity` are rejected. |

**Response (200):**
```json
{ "ok": true, "message": "Running tests...", "percent": 75 }
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Issue not found |
| 400 | Issue is not `in_progress` |
| 400 | Empty body (neither `message` nor `percent` provided) |
| 400 | `message` is not a string |
| 400 | `percent` is not a finite number between 0–100 |

**Side effects:**
- Updates the in-memory `progressMessage`, `progressPercent`, and `progressUpdatedAt` fields on the issue
- Broadcasts an `issue:progress` WebSocket event to all connected clients

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

Defined in `server/src/issue-api.ts`.

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

Defined in `server/src/pr-api.ts`.

### GET /api/config

Get current app configuration.

### PATCH /api/config

Update configuration.

**Request body:**
```json
{ "repoPath": "/path/to/repo", "worktreeBase": "/tmp/hermes-worktrees", "reviewBase": "/tmp/hermes-reviews", "screenshotBase": "/tmp/hermes-screenshots", "targetBranch": "main", "requireScreenshotsForUiChanges": true }
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
{ "type": "replay", "terminalId": "uuid" }
```

`replay` requests scrollback replay for a specific terminal (e.g. on component mount).
On new connections, the server automatically replays scrollback for all active terminals.

### Server → Client

```json
{ "type": "stdout",              "terminalId": "uuid", "data": "..." }
{ "type": "exit",                "terminalId": "uuid", "exitCode": 0 }
{ "type": "terminal:removed",    "terminalId": "uuid" }
{ "type": "error",               "terminalId": "uuid", "message": "..." }
{ "type": "terminal:awaitingInput", "terminalId": "uuid", "awaitingInput": true }

{ "type": "issue:created", "issue": Issue }
{ "type": "issue:updated", "issue": Issue }
{ "type": "issue:deleted", "issueId": "uuid" }
{ "type": "issue:progress", "issueId": "uuid", "message": "string | null", "percent": "number | null" }

{ "type": "pr:created", "pr": PullRequest }
{ "type": "pr:updated", "pr": PullRequest }
```
