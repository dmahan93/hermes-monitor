# Hermes Monitor — Development Plan

> Last updated: 2026-03-07
> Status: Active development, agent-built

## What This Is

A web dashboard for orchestrating AI coding agents. Agents get issues via
a kanban board, work in isolated git worktrees, submit PRs, and get
adversarial code reviews — all automated.

**Stack:** Express+WS+node-pty (:4000) | Vite+React 19+xterm.js (:3000) | SQLite

**Current LOC:** ~3,400 server | ~6,500 client | ~10K total

## Current State (what works)

- ✅ Terminal grid with drag/resize (xterm.js + react-grid-layout)
- ✅ Kanban board (backlog → todo → in_progress → review → done)
- ✅ Agent presets (hermes, claude, codex, gemini, aider, shell, custom)
- ✅ Git worktrees per issue (isolated branches)
- ✅ PR system with adversarial AI reviewer
- ✅ SQLite persistence (survives server restart)
- ✅ Agent API (GET /agent/:id/info, POST /agent/:id/review)
- ✅ Screenshot upload system for UI changes
- ✅ Auto-resume (respawns crashed agent terminals)
- ✅ Subtasks (parent/child issue hierarchy)
- ✅ Planning terminals (interactive agent for backlog items)
- ✅ Research tab (dedicated terminal)
- ✅ Git graph viewer

## Known Quality Issues (from code review 2026-03-07)

Server: 6.5/10 | Client: 6.5/10 | Agent-DX: 5.2/10

### P0 — Security & Bugs
- Shell injection in git commands (worktree-manager, pr-manager use string concat)
- Direct mutation bypassing manager encapsulation (agent-api.ts)
- Missing shutdown cleanup (prManager timers not cleared)
- Unchecked JSON.parse in store.ts (can crash on startup)

### P1 — Architecture
- App.tsx is a 506-line god component (20 state vars, 15 effects)
- App.css is 2717 lines (monolithic, no component scoping)
- Types duplicated between server/client (Issue, PR, etc.)
- No README.md or API reference document
- ✅ `ticket-api.ts` renamed to `agent-api.ts`
- ~~`api.ts` breaks the `*-api.ts` naming convention~~ ✅ Fixed (renamed to `terminal-api.ts`)

### P2 — Type Safety & DX
- `any` types throughout (WS send, error catches, broadcast, store)
- Missing HTTP status checks in client fetch calls
- No user-facing error states for API failures
- Polling hack in TerminalView.tsx for WS reconnect
- Missing AbortController on most fetch calls

### P3 — Code Smells
- Dead code (terminal-manager.ts:158, worktree-manager.ts:182)
- Duplicate definitions (UI_EXTENSIONS in 2 files, PORT in 4 places)
- Redundant dynamic imports in pr-manager.ts
- Inefficient Map iteration (forEach without break)

---

## Work Plan

### Sprint 1: Documentation & Discoverability (agent-DX)

Goal: Make the codebase navigable for AI agents in under 2 minutes.

1. **Create README.md** — what it is, how to run, architecture diagram, 
   file map ("where to find things"), key concepts
2. **Create docs/API.md** — complete API reference for ALL endpoints 
   (currently 15+ undocumented since PLAN.md went stale)
3. ✅ **Renamed `ticket-api.ts` → `agent-api.ts`** and routes `/ticket/` → `/agent/`
4. ~~**Rename `api.ts` → `terminal-api.ts`** to match `*-api.ts` convention~~ ✅ Done
5. **Delete HELLO.md** (test artifact)
6. **Clean up .playwright-cli/** (80+ files cluttering searches)

### Sprint 2: Security & Correctness

7. **Fix shell injection** — switch worktree-manager.ts and pr-manager.ts 
   from `execSync` string concat to `execFileSync` with array args 
   (git-api.ts already does this correctly — use it as reference)
8. **Fix direct mutation** in agent-api.ts — use manager methods instead 
   of mutating issue objects directly
9. **Add shutdown cleanup** — call prManager.clearAllPendingTimers() in 
   index.ts shutdown handler
10. **Wrap JSON.parse in store.ts** with try/catch for corrupt data resilience

### Sprint 3: Architecture Improvements

11. **Break up App.tsx** — extract into context provider + per-view components
12. **Split App.css** — per-component CSS or CSS modules
13. **Consolidate types** — shared types package or server-as-source-of-truth
14. **Add HTTP status checks** to all client fetch calls
15. **Add error states** — surface API failures to UI instead of just console.error

### Sprint 4: Code Quality Cleanup

16. **Remove dead code** — terminal-manager ternary, dead worktree merge method
17. **Unify duplicates** — UI_EXTENSIONS, PORT constant, broadcast functions
18. **Type events** — use union types for event names instead of raw strings
19. **Fix TerminalView polling** — replace 5s setInterval with WS reconnect hook
20. **Add missing tests** — hooks (useIssues, usePRs), components (PRDetail, etc.)

### Future

- Phase 5: Full agent orchestration (multi-agent coordination)
- Shared type package between server/client
- OpenAPI spec generation from route definitions
- Container isolation for agent workspaces
