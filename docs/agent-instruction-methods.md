# Agent Instruction Methods: Research & Design

## Problem

Currently agents are instructed via a single `-q` prompt that tells them to curl
the hermes-monitor API. This is:

1. **Circular**: Agent uses hermes (the tool) to parse instructions about
   interacting with hermes-monitor (also a tool). Agent must parse raw JSON
   from curl, extract fields, figure out what to do.
2. **Fragile**: All context crammed into a single shell-quoted prompt string.
   Complex instructions get lost or malformed with shell escaping.
3. **No persistent context**: Agent only gets what the `-q` prompt tells it and
   what it curls from `/agent/:id/info`.

## Research: Alternative Approaches

### Approach 1: File-Based Context Injection (TASK.md)

**Concept**: Write a `TASK.md` file directly into the worktree before spawning
the agent. Contains all task info: title, description, rework feedback, review
history, guidelines — everything the agent currently has to curl for.

**Pros**:
- Zero network round-trips for initial context
- Natural for all agent types (they all read files)
- Survives agent crashes/restarts — file persists in worktree
- Human-readable — you can inspect what the agent was told
- Shell-escaping issues eliminated (content is in a file, not a prompt string)

**Cons**:
- Stale if task is updated while agent is running (rare)
- Still needs API for actions (submit review, upload screenshots)

**Agent compatibility**: Universal — all agents can read files.

### Approach 2: Agent-Native Context Files

**Concept**: Write context files using each agent's native auto-load mechanism:
- **Hermes**: `AGENTS.md` (auto-loaded, also `.cursorrules`, `SOUL.md`)
- **Claude Code**: `CLAUDE.md` or `.claude/CLAUDE.md` (auto-loaded at session start)
- **Codex CLI**: `AGENTS.md` or `AGENTS.override.md` (auto-loaded)
- **Gemini CLI**: `GEMINI.md` (auto-loaded, configurable to read `AGENTS.md`)
- **Aider**: No auto-load; use `--read CONVENTIONS.md` or `.aider.conf.yml`

**Pros**:
- Zero-effort context injection — agents pick up files automatically
- Context survives `/compact` (context compression) in Claude
- Follows each agent's best practices and conventions
- Can include project-specific coding standards alongside task info

**Cons**:
- Different file names for different agents (complexity in generation)
- Aider requires explicit CLI flags (no auto-load)
- Risk of conflicting with user's own context files in the main repo

**Agent compatibility**: Excellent for Hermes/Claude/Codex/Gemini. Aider needs workaround.

### Approach 3: Helper Scripts in Worktree

**Concept**: Write executable shell scripts into the worktree that wrap common
API interactions:
- `.hermes-monitor/submit-for-review.sh` — replaces `curl -X POST .../review`
- `.hermes-monitor/report-progress.sh "message"` — replaces progress curl
- `.hermes-monitor/upload-screenshot.sh path.png` — replaces screenshot curl
- `.hermes-monitor/get-info.sh` — replaces the info curl

**Pros**:
- Reduces cognitive load — simple script names instead of complex curl commands
- Self-documenting (script contents show what they do)
- Can handle error cases, retries, JSON parsing

**Cons**:
- Still requires agents to know about and execute shell commands
- More files to manage in the worktree
- Agent may not know which scripts are available without being told

**Agent compatibility**: Universal — all agents can run shell scripts.

### Approach 4: MCP Server Integration

**Concept**: Expose hermes-monitor as an MCP (Model Context Protocol) server.
Agents with MCP support can call tools like `get_task_info()`,
`submit_for_review()`, `upload_screenshot()` natively.

**Pros**:
- Native tool integration — no curl, no file reading
- Type-safe interactions with structured inputs/outputs
- Real-time — always gets fresh data
- Follows emerging industry standard

**Cons**:
- Not all agents support MCP yet (aider doesn't)
- Significant implementation effort (full MCP server)
- Requires MCP client configuration in each agent
- Overkill for the simple "read task, do work, submit" flow

**Agent compatibility**: Claude Code (excellent), Hermes (has MCP support),
Codex/Gemini/Aider (limited or no MCP support).

### Approach 5: Enhanced Template Variables

**Concept**: Expand the `{{var}}` interpolation system to inject full task
context directly into the command template. Add variables like `{{reworkFeedback}}`,
`{{previousReviews}}`, `{{guidelines}}`, `{{worktreePath}}`.

**Pros**:
- Minimal code change — just add more template variables
- No new files or infrastructure
- Backward compatible

**Cons**:
- Makes the shell escaping problem WORSE (more content in the prompt string)
- Still limited by shell quoting constraints
- Doesn't solve the fundamental "prompt string" fragility

**Agent compatibility**: Universal, but fragile.

## Recommendation: Combined File-Based Approach (1 + 2 + 3)

The most effective solution combines the first three approaches:

1. **TASK.md**: Written to worktree root with complete task context. This is
   the single source of truth the agent reads.

2. **Agent-native context files**: Write `AGENTS.md` (for Hermes/Codex/Gemini)
   and `CLAUDE.md` (for Claude) that reference TASK.md and include project
   instructions. These are auto-loaded by agents, so the agent automatically
   knows to look at TASK.md.

3. **Helper scripts**: Write `.hermes-monitor/` directory with scripts for
   submitting, progress reporting, and screenshots.

4. **Simplified templates**: Command templates shrink to just launching the
   agent. Context comes from files, not the prompt string.

### Flow comparison

**Before:**
```
1. Agent spawns with complex -q prompt containing curl instructions
2. Agent runs: curl -s http://localhost:4000/agent/:id/info
3. Agent parses JSON output
4. Agent does work
5. Agent runs: curl -s -X POST http://localhost:4000/agent/:id/review
```

**After:**
```
1. hermes-monitor writes TASK.md + AGENTS.md + helper scripts to worktree
2. Agent spawns with minimal -q prompt: "Read TASK.md for your task"
3. Agent reads TASK.md (or auto-loads AGENTS.md which references it)
4. Agent does work
5. Agent runs: ./.hermes-monitor/submit.sh (or the curl command from TASK.md)
```

## Implementation

See `server/src/task-context.ts` for the prototype implementation.
