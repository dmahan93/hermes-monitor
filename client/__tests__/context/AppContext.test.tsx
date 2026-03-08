import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Issue, PullRequest } from '../../src/types';

// ── Shared mock state (mutated between tests) ──

let mockIssuesReturn: ReturnType<typeof createMockIssuesReturn>;
let mockTerminalsReturn: ReturnType<typeof createMockTerminalsReturn>;
let mockWebSocketReturn: ReturnType<typeof createMockWebSocketReturn>;
let mockPRsReturn: ReturnType<typeof createMockPRsReturn>;
let mockGitGraphReturn: ReturnType<typeof createMockGitGraphReturn>;
let mockAgentsReturn: ReturnType<typeof createMockAgentsReturn>;

// ── Mock all hooks ──

vi.mock('../../src/hooks/useWebSocket', () => ({
  useWebSocket: () => mockWebSocketReturn,
}));

vi.mock('../../src/hooks/useTerminals', () => ({
  useTerminals: () => mockTerminalsReturn,
}));

vi.mock('../../src/hooks/useIssues', () => ({
  useIssues: () => mockIssuesReturn,
}));

vi.mock('../../src/hooks/usePRs', () => ({
  usePRs: () => mockPRsReturn,
}));

vi.mock('../../src/hooks/useAgents', () => ({
  useAgents: () => mockAgentsReturn,
}));

vi.mock('../../src/hooks/useGitGraph', () => ({
  useGitGraph: () => mockGitGraphReturn,
  // Re-export the types so the import in AppContext doesn't break
}));

// ── Factory helpers ──

function createMockWebSocketReturn() {
  return {
    connected: true,
    reconnectCount: 0,
    send: vi.fn(),
    subscribe: vi.fn(() => vi.fn()), // returns unsubscribe
  };
}

function createMockTerminalsReturn() {
  return {
    terminals: [],
    layout: [],
    loading: false,
    addTerminal: vi.fn(),
    removeTerminal: vi.fn(),
    updateLayout: vi.fn(),
    refetch: vi.fn(),
  };
}

function createMockIssuesReturn(issues: Issue[] = []) {
  return {
    issues,
    loading: false,
    createIssue: vi.fn(),
    changeStatus: vi.fn().mockResolvedValue(null),
    updateIssue: vi.fn(),
    deleteIssue: vi.fn().mockResolvedValue(undefined),
    startPlanning: vi.fn().mockResolvedValue(true),
    stopPlanning: vi.fn().mockResolvedValue(undefined),
    createSubtask: vi.fn().mockResolvedValue(null),
  };
}

function createMockPRsReturn(prs: PullRequest[] = []) {
  return {
    prs,
    loading: false,
    addComment: vi.fn(),
    setVerdict: vi.fn(),
    mergePR: vi.fn().mockResolvedValue({}),
    confirmMerge: vi.fn().mockResolvedValue({}),
    fixConflicts: vi.fn(),
    relaunchReview: vi.fn(),
    refetch: vi.fn(),
  };
}

function createMockGitGraphReturn() {
  return {
    commits: [],
    graph: [],
    loading: false,
    error: null,
    selectedSha: null,
    files: [],
    filesLoading: false,
    selectCommit: vi.fn(),
    diffFile: null,
    diffContent: '',
    diffLoading: false,
    diffSha: null,
    viewDiff: vi.fn(),
    closeDiff: vi.fn(),
    refetch: vi.fn(),
  };
}

function createMockAgentsReturn() {
  return { agents: [], loading: false, error: null };
}

// ── Test fixtures ──

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    title: 'Test Issue',
    description: 'A test issue',
    status: 'in_progress',
    agent: 'hermes',
    command: 'echo hello',
    terminalId: 'term-1',
    branch: 'feature/test',
    parentId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'pr-1',
    issueId: 'issue-1',
    title: 'Test PR',
    description: 'A test PR',
    submitterNotes: '',
    sourceBranch: 'feature/test',
    targetBranch: 'main',
    repoPath: '/tmp/repo',
    status: 'reviewing',
    diff: '',
    changedFiles: [],
    verdict: 'pending',
    reviewerTerminalId: 'review-term-1',
    comments: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Import after mocks ──

// Must be imported after vi.mock calls so vitest can intercept
import { AppProvider, useApp } from '../../src/context/AppContext';

/** Wrap AppProvider in MemoryRouter with /:repoId/* route */
function createWrapper(initialRoute = '/test-repo/kanban') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/:repoId/*" element={<AppProvider>{children}</AppProvider>} />
        </Routes>
      </MemoryRouter>
    );
  };
}

// Default wrapper for most tests
const wrapper = createWrapper();

// ── Tests ──

describe('AppContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();

    // Reset all mock returns to defaults
    mockWebSocketReturn = createMockWebSocketReturn();
    mockTerminalsReturn = createMockTerminalsReturn();
    mockIssuesReturn = createMockIssuesReturn();
    mockPRsReturn = createMockPRsReturn();
    mockGitGraphReturn = createMockGitGraphReturn();
    mockAgentsReturn = createMockAgentsReturn();
  });

  // ── 1. useApp() outside provider ──

  describe('useApp() outside provider', () => {
    it('throws when used outside <AppProvider>', () => {
      // Suppress React error boundary noise
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useApp());
      }).toThrow('useApp must be used within <AppProvider>');

      spy.mockRestore();
    });
  });

  // ── 2. handleDeleteIssue clears related state ──

  describe('handleDeleteIssue', () => {
    it('clears expandedIssueId when deleting the expanded issue', async () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Expand the issue
      act(() => {
        result.current.setExpandedIssueId('issue-1');
      });

      expect(result.current.expandedIssue).not.toBeNull();
      expect(result.current.expandedIssue!.id).toBe('issue-1');

      // Delete the same issue
      await act(async () => {
        await result.current.handleDeleteIssue('issue-1');
      });

      // expandedIssue should be cleared
      expect(result.current.expandedIssue).toBeNull();
    });

    it('clears planningIssueId when deleting the planning issue', async () => {
      const issue = makeIssue({ id: 'issue-1', status: 'backlog', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Open planning for the issue
      act(() => {
        result.current.setPlanningIssueId('issue-1');
      });

      expect(result.current.planningIssue).not.toBeNull();

      // Delete the same issue
      await act(async () => {
        await result.current.handleDeleteIssue('issue-1');
      });

      // planningIssue should be cleared
      expect(result.current.planningIssue).toBeNull();
    });

    it('does not clear expandedIssueId when deleting a different issue', async () => {
      const issue1 = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      const issue2 = makeIssue({ id: 'issue-2', terminalId: 'term-2' });
      mockIssuesReturn = createMockIssuesReturn([issue1, issue2]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Expand issue-1
      act(() => {
        result.current.setExpandedIssueId('issue-1');
      });

      expect(result.current.expandedIssue!.id).toBe('issue-1');

      // Delete issue-2 (different issue)
      await act(async () => {
        await result.current.handleDeleteIssue('issue-2');
      });

      // expandedIssue should NOT be cleared
      expect(result.current.expandedIssue).not.toBeNull();
      expect(result.current.expandedIssue!.id).toBe('issue-1');
    });
  });

  // ── 3. Auto-close effects ──

  describe('auto-close effects', () => {
    it('clears expandedIssueId when the expanded issue loses its terminalId', async () => {
      const issueWithTerminal = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issueWithTerminal]);

      const { result, rerender } = renderHook(() => useApp(), { wrapper });

      // Expand the issue
      act(() => {
        result.current.setExpandedIssueId('issue-1');
      });

      expect(result.current.expandedIssue).not.toBeNull();
      expect(result.current.expandedIssue!.terminalId).toBe('term-1');

      // Now the issue loses its terminalId (e.g., agent stopped)
      const issueWithoutTerminal = makeIssue({ id: 'issue-1', terminalId: null });
      mockIssuesReturn = createMockIssuesReturn([issueWithoutTerminal]);
      rerender();

      // The auto-close effect should fire and clear expandedIssueId
      await waitFor(() => {
        expect(result.current.expandedIssue).toBeNull();
      });
    });

    it('clears planningIssueId when the planning issue is no longer in backlog', async () => {
      const backlogIssue = makeIssue({ id: 'issue-1', status: 'backlog', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([backlogIssue]);

      const { result, rerender } = renderHook(() => useApp(), { wrapper });

      // Open planning
      act(() => {
        result.current.setPlanningIssueId('issue-1');
      });

      expect(result.current.planningIssue).not.toBeNull();

      // Issue moves out of backlog (e.g., promoted to todo)
      const todoIssue = makeIssue({ id: 'issue-1', status: 'todo', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([todoIssue]);
      rerender();

      await waitFor(() => {
        expect(result.current.planningIssue).toBeNull();
      });
    });

    it('clears planningIssueId when the planning issue is deleted from the list', async () => {
      const issue = makeIssue({ id: 'issue-1', status: 'backlog', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result, rerender } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.setPlanningIssueId('issue-1');
      });

      expect(result.current.planningIssue).not.toBeNull();

      // Issue disappears from the list
      mockIssuesReturn = createMockIssuesReturn([]);
      rerender();

      await waitFor(() => {
        expect(result.current.planningIssue).toBeNull();
      });
    });
  });

  // ── 4. handleTermViewSelect toggle ──

  describe('handleTermViewSelect', () => {
    it('selects an agent terminal', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.handleTermViewSelect({ kind: 'agent', issueId: 'issue-1' });
      });

      expect(result.current.termViewAgentIssue).not.toBeNull();
      expect(result.current.termViewAgentIssue!.id).toBe('issue-1');
    });

    it('deselects when selecting the same agent again (toggle)', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Select
      act(() => {
        result.current.handleTermViewSelect({ kind: 'agent', issueId: 'issue-1' });
      });

      expect(result.current.termViewSelection).not.toBeNull();

      // Select same again → toggle off
      act(() => {
        result.current.handleTermViewSelect({ kind: 'agent', issueId: 'issue-1' });
      });

      expect(result.current.termViewSelection).toBeNull();
      expect(result.current.termViewAgentIssue).toBeNull();
    });

    it('switches to a different agent without toggling off', () => {
      const issue1 = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      const issue2 = makeIssue({ id: 'issue-2', terminalId: 'term-2' });
      mockIssuesReturn = createMockIssuesReturn([issue1, issue2]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Select issue-1
      act(() => {
        result.current.handleTermViewSelect({ kind: 'agent', issueId: 'issue-1' });
      });

      expect(result.current.termViewAgentIssue!.id).toBe('issue-1');

      // Select issue-2 (different) → should switch, not deselect
      act(() => {
        result.current.handleTermViewSelect({ kind: 'agent', issueId: 'issue-2' });
      });

      expect(result.current.termViewAgentIssue).not.toBeNull();
      expect(result.current.termViewAgentIssue!.id).toBe('issue-2');
    });
  });

  // ── 4b. Reviewer terminal selection ──

  describe('reviewer terminal selection', () => {
    it('selects a reviewer terminal and builds a synthetic issue with reviewerTerminalId', () => {
      const pr = makePR({ id: 'pr-1', reviewerTerminalId: 'review-term-1' });
      mockPRsReturn = createMockPRsReturn([pr]);

      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });

      expect(result.current.termViewAgentIssue).not.toBeNull();
      expect(result.current.termViewAgentIssue!.terminalId).toBe('review-term-1');
      expect(result.current.termViewAgentIssue!.title).toBe('Review: Test PR');
    });

    it('synthetic reviewer issue uses the PR reviewerTerminalId, not the worker terminalId', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'worker-term-1' });
      const pr = makePR({ id: 'pr-1', issueId: 'issue-1', reviewerTerminalId: 'review-term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);
      mockPRsReturn = createMockPRsReturn([pr]);

      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });

      // Must be the reviewer terminal, NOT the worker terminal
      expect(result.current.termViewAgentIssue!.terminalId).toBe('review-term-1');
      expect(result.current.termViewAgentIssue!.terminalId).not.toBe('worker-term-1');
    });

    it('deselects when selecting the same reviewer again (toggle)', () => {
      const pr = makePR({ id: 'pr-1', reviewerTerminalId: 'review-term-1' });
      mockPRsReturn = createMockPRsReturn([pr]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Select
      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });
      expect(result.current.termViewSelection).not.toBeNull();

      // Select same again → toggle off
      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });
      expect(result.current.termViewSelection).toBeNull();
      expect(result.current.termViewAgentIssue).toBeNull();
    });

    it('switches from an agent to a reviewer terminal', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'agent-term-1' });
      const pr = makePR({ id: 'pr-1', reviewerTerminalId: 'review-term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);
      mockPRsReturn = createMockPRsReturn([pr]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Select agent first
      act(() => {
        result.current.handleTermViewSelect({ kind: 'agent', issueId: 'issue-1' });
      });
      expect(result.current.termViewAgentIssue!.terminalId).toBe('agent-term-1');

      // Switch to reviewer
      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });
      expect(result.current.termViewAgentIssue!.terminalId).toBe('review-term-1');
    });

    it('switches from a reviewer to an agent terminal', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'agent-term-1' });
      const pr = makePR({ id: 'pr-1', reviewerTerminalId: 'review-term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);
      mockPRsReturn = createMockPRsReturn([pr]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Select reviewer first
      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });
      expect(result.current.termViewAgentIssue!.terminalId).toBe('review-term-1');

      // Switch to agent
      act(() => {
        result.current.handleTermViewSelect({ kind: 'agent', issueId: 'issue-1' });
      });
      expect(result.current.termViewAgentIssue!.terminalId).toBe('agent-term-1');
    });

    it('switches between different reviewers', () => {
      const pr1 = makePR({ id: 'pr-1', title: 'PR One', reviewerTerminalId: 'review-term-1' });
      const pr2 = makePR({ id: 'pr-2', title: 'PR Two', reviewerTerminalId: 'review-term-2' });
      mockPRsReturn = createMockPRsReturn([pr1, pr2]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Select reviewer 1
      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });
      expect(result.current.termViewAgentIssue!.terminalId).toBe('review-term-1');

      // Select reviewer 2
      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-2' });
      });
      expect(result.current.termViewAgentIssue!.terminalId).toBe('review-term-2');
      expect(result.current.termViewAgentIssue!.title).toBe('Review: PR Two');
    });

    it('clears selection when PR loses reviewerTerminalId', async () => {
      const pr = makePR({ id: 'pr-1', reviewerTerminalId: 'review-term-1' });
      mockPRsReturn = createMockPRsReturn([pr]);

      const { result, rerender } = renderHook(() => useApp(), { wrapper });

      // Select reviewer
      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });
      expect(result.current.termViewAgentIssue).not.toBeNull();

      // PR loses its reviewerTerminalId (reviewer finished)
      const updatedPR = makePR({ id: 'pr-1', reviewerTerminalId: null });
      mockPRsReturn = createMockPRsReturn([updatedPR]);
      rerender();

      // Selection should auto-clear since synthetic issue would have no terminal
      await waitFor(() => {
        expect(result.current.termViewAgentIssue).toBeNull();
      });
    });

    it('clears selection when PR disappears from the list', async () => {
      const pr = makePR({ id: 'pr-1', reviewerTerminalId: 'review-term-1' });
      mockPRsReturn = createMockPRsReturn([pr]);

      const { result, rerender } = renderHook(() => useApp(), { wrapper });

      // Select reviewer
      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });
      expect(result.current.termViewAgentIssue).not.toBeNull();

      // PR disappears (e.g., merged)
      mockPRsReturn = createMockPRsReturn([]);
      rerender();

      await waitFor(() => {
        expect(result.current.termViewSelection).toBeNull();
        expect(result.current.termViewAgentIssue).toBeNull();
      });
    });

    it('synthetic issue has correct status mapping from PR status', () => {
      const reviewingPR = makePR({ id: 'pr-1', status: 'reviewing', reviewerTerminalId: 'review-term-1' });
      mockPRsReturn = createMockPRsReturn([reviewingPR]);

      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });

      // 'reviewing' PR status → 'review' issue status
      expect(result.current.termViewAgentIssue!.status).toBe('review');
    });

    it('synthetic issue maps PR open status to in_progress', () => {
      const openPR = makePR({ id: 'pr-1', status: 'open', reviewerTerminalId: 'review-term-1' });
      mockPRsReturn = createMockPRsReturn([openPR]);

      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });

      // 'open' PR status → 'in_progress' issue status (default case)
      expect(result.current.termViewAgentIssue!.status).toBe('in_progress');
    });

    it('synthetic issue includes PR sourceBranch as branch', () => {
      const pr = makePR({ id: 'pr-1', sourceBranch: 'feature/cool', reviewerTerminalId: 'review-term-1' });
      mockPRsReturn = createMockPRsReturn([pr]);

      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.handleTermViewSelect({ kind: 'reviewer', prId: 'pr-1' });
      });

      expect(result.current.termViewAgentIssue!.branch).toBe('feature/cool');
    });
  });

  // ── 5. Computed flags ──

  describe('computed flags', () => {
    it('showTaskTerminal is true when in kanban view with expanded issue that has terminal', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Already on kanban (initial route), expand an issue
      act(() => {
        result.current.setExpandedIssueId('issue-1');
      });

      expect(result.current.showTaskTerminal).toBe(true);
    });

    it('showTaskTerminal is false when not in kanban view', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      // Start on terminals view
      const terminalsWrapper = createWrapper('/test-repo/terminals');
      const { result } = renderHook(() => useApp(), { wrapper: terminalsWrapper });

      act(() => {
        result.current.setExpandedIssueId('issue-1');
      });

      expect(result.current.showTaskTerminal).toBe(false);
    });

    it('showPlanning is true when in kanban view with a backlog planning issue', () => {
      const issue = makeIssue({ id: 'issue-1', status: 'backlog', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Already on kanban, open planning
      act(() => {
        result.current.setPlanningIssueId('issue-1');
      });

      expect(result.current.showPlanning).toBe(true);
    });
  });

  // ── 6. handleTerminalClick toggle ──

  describe('handleTerminalClick', () => {
    it('toggles expandedIssueId on repeated clicks', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Click to expand
      act(() => {
        result.current.handleTerminalClick('issue-1');
      });
      expect(result.current.expandedIssue!.id).toBe('issue-1');

      // Click same to collapse
      act(() => {
        result.current.handleTerminalClick('issue-1');
      });
      expect(result.current.expandedIssue).toBeNull();
    });
  });

  // ── 7. closeDetail ──

  describe('closeDetail', () => {
    it('clears detailIssueId and detailEditing', () => {
      const issue = makeIssue({ id: 'issue-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Open detail with editing (navigates to /test-repo/issues/issue-1)
      act(() => {
        result.current.setDetailIssueId('issue-1');
        result.current.setDetailEditing(true);
      });

      expect(result.current.detailIssueId).toBe('issue-1');
      expect(result.current.detailEditing).toBe(true);

      // Close detail (navigates back to view URL)
      act(() => {
        result.current.closeDetail();
      });

      expect(result.current.detailIssueId).toBeNull();
      expect(result.current.detailEditing).toBe(false);
    });

    it('returns to the originating view, not the default', () => {
      const issue = makeIssue({ id: 'issue-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      // Start on terminals view
      const terminalsWrapper = createWrapper('/test-repo/terminals');
      const { result } = renderHook(() => useApp(), { wrapper: terminalsWrapper });

      expect(result.current.view).toBe('terminals');

      // Open issue detail (URL changes to /test-repo/issues/issue-1)
      act(() => {
        result.current.setDetailIssueId('issue-1');
      });

      expect(result.current.detailIssueId).toBe('issue-1');

      // Close detail — should return to terminals, not kanban
      act(() => {
        result.current.closeDetail();
      });

      expect(result.current.detailIssueId).toBeNull();
      expect(result.current.view).toBe('terminals');
    });
  });

  // ── 8. View state ──

  describe('view state', () => {
    it('defaults to kanban view', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.view).toBe('kanban');
    });

    it('setView changes the current view via navigation', () => {
      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.setView('terminals');
      });

      expect(result.current.view).toBe('terminals');
    });

    it('view is derived from the URL', () => {
      const terminalsWrapper = createWrapper('/test-repo/terminals');
      const { result } = renderHook(() => useApp(), { wrapper: terminalsWrapper });

      expect(result.current.view).toBe('terminals');
    });

    it('lazy-mounts research view when research tab is visited', () => {
      const { result } = renderHook(() => useApp(), { wrapper });

      expect(result.current.researchMounted).toBe(false);

      act(() => {
        result.current.setView('research');
      });

      expect(result.current.researchMounted).toBe(true);
    });
  });

  // ── 9. URL-driven issue detail ──

  describe('URL-driven issue detail', () => {
    it('opens issue detail from URL', () => {
      const issue = makeIssue({ id: 'issue-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const issueWrapper = createWrapper('/test-repo/issues/issue-1');
      const { result } = renderHook(() => useApp(), { wrapper: issueWrapper });

      expect(result.current.detailIssueId).toBe('issue-1');
      expect(result.current.detailIssue).not.toBeNull();
      expect(result.current.detailIssue!.id).toBe('issue-1');
    });

    it('returns null detailIssue when URL issue not found', () => {
      mockIssuesReturn = createMockIssuesReturn([]);

      const issueWrapper = createWrapper('/test-repo/issues/nonexistent');
      const { result } = renderHook(() => useApp(), { wrapper: issueWrapper });

      expect(result.current.detailIssueId).toBe('nonexistent');
      expect(result.current.detailIssue).toBeNull();
    });
  });

  // ── 10. URL-driven PR detail ──

  describe('URL-driven PR detail', () => {
    it('opens PR detail from URL', () => {
      const prWrapper = createWrapper('/test-repo/prs/pr-1');
      const { result } = renderHook(() => useApp(), { wrapper: prWrapper });

      expect(result.current.selectedPrId).toBe('pr-1');
      expect(result.current.view).toBe('prs');
    });

    it('clears selectedPrId when navigating back to /prs', () => {
      const prWrapper = createWrapper('/test-repo/prs/pr-1');
      const { result } = renderHook(() => useApp(), { wrapper: prWrapper });

      expect(result.current.selectedPrId).toBe('pr-1');

      act(() => {
        result.current.setSelectedPrId(null);
      });

      expect(result.current.selectedPrId).toBeNull();
      expect(result.current.view).toBe('prs');
    });
  });

  // ── 11. repoId from URL ──

  describe('repoId', () => {
    it('provides repoId from URL params', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.repoId).toBe('test-repo');
    });

    it('uses the repoId from the matched route segment', () => {
      const customWrapper = createWrapper('/my-custom-repo/kanban');
      const { result } = renderHook(() => useApp(), { wrapper: customWrapper });
      expect(result.current.repoId).toBe('my-custom-repo');
    });
  });
});
