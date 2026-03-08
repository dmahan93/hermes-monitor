import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Issue } from '../../src/types';

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

function createMockPRsReturn() {
  return {
    prs: [],
    loading: false,
    addComment: vi.fn(),
    setVerdict: vi.fn(),
    mergePR: vi.fn().mockResolvedValue({}),
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

// ── Import after mocks ──

// Must be imported after vi.mock calls so vitest can intercept
import { AppProvider, useApp } from '../../src/context/AppContext';

function wrapper({ children }: { children: ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

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

  // ── 5. Computed flags ──

  describe('computed flags', () => {
    it('showTaskTerminal is true when in kanban view with expanded issue that has terminal', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      // Switch to kanban view and expand an issue
      act(() => {
        result.current.setView('kanban');
        result.current.setExpandedIssueId('issue-1');
      });

      expect(result.current.showTaskTerminal).toBe(true);
    });

    it('showTaskTerminal is false when not in kanban view', () => {
      const issue = makeIssue({ id: 'issue-1', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.setView('terminals');
        result.current.setExpandedIssueId('issue-1');
      });

      expect(result.current.showTaskTerminal).toBe(false);
    });

    it('showPlanning is true when in kanban view with a backlog planning issue', () => {
      const issue = makeIssue({ id: 'issue-1', status: 'backlog', terminalId: 'term-1' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.setView('kanban');
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

      // Open detail with editing
      act(() => {
        result.current.setDetailIssueId('issue-1');
        result.current.setDetailEditing(true);
      });

      expect(result.current.detailIssue).not.toBeNull();
      expect(result.current.detailEditing).toBe(true);

      // Close detail
      act(() => {
        result.current.closeDetail();
      });

      expect(result.current.detailIssue).toBeNull();
      expect(result.current.detailEditing).toBe(false);
    });
  });

  // ── 8. View state ──

  describe('view state', () => {
    it('defaults to kanban view', () => {
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.view).toBe('kanban');
    });

    it('setView changes the current view', () => {
      const { result } = renderHook(() => useApp(), { wrapper });

      act(() => {
        result.current.setView('terminals');
      });

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
});
