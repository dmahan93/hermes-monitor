# Hermes Monitor — Manager Guide

How to be a tech lead managing agents via hermes-monitor.
Written from experience running 75+ tickets across 8 waves in a single session.

## Quick Start

```bash
hermes-monitor                    # start from any repo
# or: cd ~/github/hermes-monitor && npm run dev
```

Server: localhost:4000 | Client: localhost:3000

## Multi-Repo Hub Mode

Manage multiple repos simultaneously through the hub:

```bash
# Start monitoring multiple repos
cd ~/projects/frontend && hermes-monitor    # auto-starts hub, opens dashboard
cd ~/projects/backend && hermes-monitor     # registers with existing hub

# Hub management
hermes-monitor hub                  # start hub only (landing page at :3000)
hermes-monitor hub --foreground     # run hub in foreground (see logs)
hermes-monitor --list               # list all registered repos + status
hermes-monitor --add ~/projects/api # register repo without starting it
hermes-monitor --remove <id>        # unregister a repo
hermes-monitor stop                 # stop hub + all repo instances
```

The hub runs as a background process (PID stored in `~/.hermes/hub.pid`).
Each repo gets auto-assigned a unique server port starting from 4001.
The client (vite dev server) runs at server port + 1000 (e.g. 4001 → 5001).
The hub landing page at `http://localhost:3000` shows all repos with links.

**Note:** `--port` and `--server-port` flags are ignored in hub mode — ports are
auto-assigned by the registry to avoid collisions.

### Hub Architecture

```
Hub (:3000)                    Per-Repo Instances
┌──────────────────┐          ┌──────────────────────────────┐
│ Landing page     │          │ Repo A (:4001 srv / :5001 ui)│
│ Registry API     │          │ Repo B (:4002 srv / :5002 ui)│
│ ~/.hermes/       │          │ Repo C (:4003 srv / :5003 ui)│
│   hub.pid        │          │                              │
│   hub.lock       │          │ Port convention:             │
│   hermes-hub.db  │          │   server = auto-assigned     │
│   hub.log        │          │   client = server + 1000     │
│   repo-pids/     │          │                              │
│     <id>.pid     │          │ PID files stored as fallback │
│                  │          │ for stop when hub unreachable│
└──────────────────┘          └──────────────────────────────┘
```

### Hub API Cheat Sheet

```bash
# List repos via hub API
curl -s localhost:3000/api/hub/repos | python3 -c "
import json,sys; [print(f'[{r[\"status\"]:8}] {r[\"name\"]:20} :{ r[\"port\"]} {r[\"path\"]}')
for r in json.loads(sys.stdin.read())]"

# Register a repo
curl -s -X POST localhost:3000/api/hub/repos \
  -H 'Content-Type: application/json' \
  -d '{"path": "/home/user/projects/myapp"}'

# Unregister a repo (must be stopped first)
curl -s -X DELETE localhost:3000/api/hub/repos/{id}
```

## The Loop

The core workflow is a loop:

1. **Create tickets** with detailed, self-contained descriptions
2. **Start agents** (status → in_progress)
3. **Monitor** — check PR verdicts, terminal health
4. **Merge approved** PRs
5. **Send back** changes_requested PRs (agent auto-reworks)
6. **Restart** crashed agents (status = todo)
7. **Relaunch** dead reviewers
8. Repeat

## API Cheat Sheet

```bash
# List issues by status
curl -s localhost:4000/api/issues | python3 -c "
import json,sys; [print(f'[{i[\"status\"]:12}] {i[\"title\"][:55]}')
for i in json.loads(sys.stdin.read(),strict=False)
if i['status'] not in ('done',)]"

# Create a ticket
curl -s -X POST localhost:4000/api/issues \
  -H 'Content-Type: application/json' \
  -d @/tmp/ticket.json

# Start an agent
curl -s -X PATCH localhost:4000/api/issues/{id}/status \
  -H 'Content-Type: application/json' -d '{"status": "in_progress"}'

# Check PR verdicts
curl -s localhost:4000/api/prs | python3 -c "
import json,sys; [print(f'{p[\"id\"][:8]} [{p[\"status\"]:18}] {p[\"verdict\"]:18} {p[\"title\"][:50]}')
for p in json.loads(sys.stdin.read(),strict=False)
if p['status'] not in ('merged',)]"

# Merge an approved PR
curl -s -X POST localhost:4000/api/prs/{id}/merge

# Fix merge conflicts
curl -s -X POST localhost:4000/api/prs/{id}/fix-conflicts

# Send back for rework
curl -s -X PATCH localhost:4000/api/issues/{id}/status \
  -H 'Content-Type: application/json' -d '{"status": "in_progress"}'

# Restart crashed agent
# (same as above — just set status to in_progress)

# Relaunch dead reviewer
curl -s -X POST localhost:4000/api/prs/{id}/relaunch-review

# Check if terminals are alive
curl -s localhost:4000/api/terminals | python3 -c "
import json,sys; terms=json.loads(sys.stdin.read());
print(f'{len(terms)} terminals'); [print(f'  {t[\"title\"][:55]}') for t in terms]"
```

## Writing Good Tickets

Tickets are the most important thing. Bad tickets = wasted agent runs.

**MUST HAVE:**
- Exact file paths to change
- What the current behavior is
- What the desired behavior is
- How to verify (what tests to run)
- Self-contained — agent should need NOTHING else

**GOOD EXAMPLE:**
```
Title: Fix shell injection in worktree-manager.ts

Description: worktree-manager.ts uses execSync with string concatenation 
for git commands (line 20-25). Switch to execFileSync with array args.

REFERENCE: git-api.ts already does this correctly (line 66-72).

SPECIFIC CHANGES:
1. Change import from execSync to execFileSync
2. Change git() function signature from string to string[]
3. Update all 8 callers to pass arrays
4. Run tests: npm run test:server
```

**BAD EXAMPLE:**
```
Title: Fix security issues
Description: There are some security problems, please fix them.
```

## Known Pitfalls

### Agent Crashes (status goes to "todo")
**Root cause:** Usually max_turns limit (set to 150 in ~/.hermes/config.yaml).
Complex tickets need 80-120 tool calls. If an agent runs out:
- Check diagnostics: `ls /tmp/hermes-diagnostics/{issue-id}/`
- The diagnostic log shows exactly what the agent accomplished and what's left
- Often the agent was 90% done — you can finish manually from the worktree

### Reviewer Terminals Die Silently
PR gets stuck in "reviewing" with no terminal running. The auto-relaunch 
feature should catch this, but check:
```bash
curl -s localhost:4000/api/terminals  # if 0 terminals but PRs reviewing = dead
curl -s -X POST localhost:4000/api/prs/{id}/relaunch-review
```

### Merge Conflicts
Every merge after the first one risks conflicts. Strategies:
- **Conflict fixer agent:** POST /api/prs/{id}/fix-conflicts (spawns an agent)
- **Manual merge:** `cd ~/github/hermes-monitor && git merge {branch} --no-edit`
- For simple conflicts: `sed -i '/<<<<<<</d; /=======/d; />>>>>>>/d' file && git add file`
- For complex conflicts: just resolve in your editor

### Heavily Diverged Branches
If a branch was created early and many PRs merged since, the conflicts can be
massive (14+ files). At that point:
- Consider rebasing the branch: `git rebase master` in the worktree
- Or just start over — delete the issue and create a fresh ticket

### Screenshot Requirement
CSS/TSX changes trigger screenshot requirements. Agents can bypass with:
`POST /agent/{id}/review?no_ui_changes=true`
The UI change analyzer (merged) now auto-detects non-visual changes.

### Stale Worktrees
Worktrees accumulate in /tmp/hermes-worktrees/. Clean periodically:
```bash
rm -rf /tmp/hermes-worktrees/*
cd ~/github/hermes-monitor && git worktree prune
git branch | grep "issue/" | xargs git branch -D
```

### Hub Issues
If the hub becomes unresponsive:
```bash
hermes-monitor stop           # kill hub + all repos
hermes-monitor hub            # restart fresh
# Or check logs:
cat ~/.hermes/hub.log
```

## Optimal Batch Size

- **Simple tickets** (rename, delete code, add docs): 5-6 at once
- **Medium tickets** (add feature, refactor component): 3-4 at once  
- **Complex tickets** (new system, cross-cutting change): 1-2 at once

More agents = more merge conflicts. Complex tickets need more review rounds.

## Review Patterns

The adversarial reviewer is genuinely good. Typical patterns:
- **1 round:** Simple mechanical changes (rename, delete)
- **2 rounds:** Standard features (new component, new endpoint)
- **3-4 rounds:** Complex infrastructure (WS reconnection, focus traps, time limits)
- **Override at 4+:** If the reviewer is nitpicking, approve manually via:
  `POST /api/prs/{id}/verdict -d '{"verdict": "approved"}'`

## Monitoring One-Liner

Paste this to get a full status dashboard:
```bash
echo "=== ISSUES ===" && curl -s localhost:4000/api/issues | python3 -c "
import json,sys; issues=json.loads(sys.stdin.read(),strict=False)
done=len([i for i in issues if i['status']=='done'])
active=[i for i in issues if i['status'] not in ('done',) and not i['title'].startswith('Screenshot')]
print(f'Score: {done}/{len(issues)}, {len(active)} active')
for i in active: print(f'  [{i[\"status\"]:12}] {i[\"title\"][:55]}')
" && echo "" && echo "=== PRs ===" && curl -s localhost:4000/api/prs | python3 -c "
import json,sys; [print(f'  {p[\"id\"][:8]} [{p[\"status\"]:18}] {p[\"verdict\"]:18} {p[\"title\"][:50]}')
for p in json.loads(sys.stdin.read(),strict=False)
if p['status'] not in ('merged',) and not p['title'].startswith('Screenshot')]
" && echo "" && echo "=== TERMINALS ===" && curl -s localhost:4000/api/terminals | python3 -c "
import json,sys; terms=json.loads(sys.stdin.read())
print(f'{len(terms)} alive')
for t in terms: print(f'  {t[\"title\"][:55]}')
"
```

## Config Tuning

Key settings in ~/.hermes/config.yaml:
```yaml
agent:
  max_turns: 150    # was 60, agents exhaust on complex tickets
  reasoning_effort: xhigh  # helps with complex tasks
```

Server config (via /api/config or env vars):
- `HERMES_MERGE_MODE`: local | github | both
- `HERMES_GITHUB_ENABLED`: true to push branches + create GH PRs
- `HERMES_REQUIRE_SCREENSHOTS`: false to skip screenshot checks
- `HERMES_AGENT_TIMEOUT_MS`: max agent runtime (default 10min)
