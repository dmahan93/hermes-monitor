import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { Issue } from '../src/types';

// ── Shared mock state ──
let mockIssuesReturn: ReturnType<typeof createMockIssuesReturn>;
let mockTerminalsReturn: ReturnType<typeof createMockTerminalsReturn>;
let mockWebSocketReturn: ReturnType<typeof createMockWebSocketReturn>;
let mockPRsReturn: ReturnType<typeof createMockPRsReturn>;
let mockGitGraphReturn: ReturnType<typeof createMockGitGraphReturn>;
let mockAgentsReturn: ReturnType<typeof createMockAgentsReturn>;

vi.mock('../src/hooks/useWebSocket', () => ({
  useWebSocket: () => mockWebSocketReturn,
}));
vi.mock('../src/hooks/useTerminals', () => ({
  useTerminals: () => mockTerminalsReturn,
}));
vi.mock('../src/hooks/useIssues', () => ({
  useIssues: () => mockIssuesReturn,
}));
vi.mock('../src/hooks/usePRs', () => ({
  usePRs: () => mockPRsReturn,
}));
vi.mock('../src/hooks/useAgents', () => ({
  useAgents: () => mockAgentsReturn,
}));
vi.mock('../src/hooks/useGitGraph', () => ({
  useGitGraph: () => mockGitGraphReturn,
}));

function createMockWebSocketReturn() {
  return { connected: true, reconnectCount: 0, send: vi.fn(), subscribe: vi.fn(() => vi.fn()) };
}
function createMockTerminalsReturn() {
  return { terminals: [], layout: [], loading: false, addTerminal: vi.fn(), removeTerminal: vi.fn(), updateLayout: vi.fn(), refetch: vi.fn() };
}
function createMockIssuesReturn(issues: Issue[] = []) {
  return { issues, loading: false, createIssue: vi.fn(), changeStatus: vi.fn().mockResolvedValue(null), updateIssue: vi.fn(), deleteIssue: vi.fn().mockResolvedValue(undefined), startPlanning: vi.fn().mockResolvedValue(true), stopPlanning: vi.fn().mockResolvedValue(undefined), createSubtask: vi.fn().mockResolvedValue(null) };
}
function createMockPRsReturn() {
  return { prs: [], loading: false, addComment: vi.fn(), setVerdict: vi.fn(), mergePR: vi.fn().mockResolvedValue({}), fixConflicts: vi.fn(), relaunchReview: vi.fn(), refetch: vi.fn() };
}
function createMockGitGraphReturn() {
  return { commits: [], graph: [], loading: false, error: null, selectedSha: null, files: [], filesLoading: false, selectCommit: vi.fn(), diffFile: null, diffContent: '', diffLoading: false, diffSha: null, viewDiff: vi.fn(), closeDiff: vi.fn(), refetch: vi.fn() };
}
function createMockAgentsReturn() {
  return { agents: [], loading: false, error: null };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return { id: 'issue-1', title: 'Test', description: '', status: 'in_progress', agent: 'hermes', command: '', terminalId: 'term-1', branch: 'main', parentId: null, createdAt: Date.now(), updatedAt: Date.now(), ...overrides };
}

import { AppProvider, useApp } from '../src/context/AppContext';

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

/** Hook that returns both AppContext and current location for URL assertions */
function useAppWithLocation() {
  const app = useApp();
  const location = useLocation();
  return { ...app, location };
}

describe('Routing integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    mockWebSocketReturn = createMockWebSocketReturn();
    mockTerminalsReturn = createMockTerminalsReturn();
    mockIssuesReturn = createMockIssuesReturn();
    mockPRsReturn = createMockPRsReturn();
    mockGitGraphReturn = createMockGitGraphReturn();
    mockAgentsReturn = createMockAgentsReturn();
  });

  describe('view navigation', () => {
    it('setView("terminals") navigates to /:repoId/terminals', () => {
      const wrapper = createWrapper('/test-repo/kanban');
      const { result } = renderHook(() => useAppWithLocation(), { wrapper });

      act(() => {
        result.current.setView('terminals');
      });

      expect(result.current.view).toBe('terminals');
      expect(result.current.location.pathname).toBe('/test-repo/terminals');
    });

    it('setView("prs") navigates to /:repoId/prs', () => {
      const wrapper = createWrapper('/test-repo/kanban');
      const { result } = renderHook(() => useAppWithLocation(), { wrapper });

      act(() => {
        result.current.setView('prs');
      });

      expect(result.current.view).toBe('prs');
      expect(result.current.location.pathname).toBe('/test-repo/prs');
    });

    it('setView("config") navigates to /:repoId/config', () => {
      const wrapper = createWrapper('/test-repo/kanban');
      const { result } = renderHook(() => useAppWithLocation(), { wrapper });

      act(() => {
        result.current.setView('config');
      });

      expect(result.current.view).toBe('config');
      expect(result.current.location.pathname).toBe('/test-repo/config');
    });

    it('unknown view segment defaults to kanban', () => {
      const wrapper = createWrapper('/test-repo/nonexistent');
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.view).toBe('kanban');
    });

    it('no view segment defaults to kanban', () => {
      const wrapper = createWrapper('/test-repo');
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.view).toBe('kanban');
    });
  });

  describe('issue detail navigation', () => {
    it('setDetailIssueId navigates to /:repoId/issues/:id', () => {
      const issue = makeIssue({ id: 'my-issue' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const wrapper = createWrapper('/test-repo/kanban');
      const { result } = renderHook(() => useAppWithLocation(), { wrapper });

      act(() => {
        result.current.setDetailIssueId('my-issue');
      });

      expect(result.current.detailIssueId).toBe('my-issue');
      expect(result.current.location.pathname).toBe('/test-repo/issues/my-issue');
    });

    it('closeDetail navigates back to the originating view', () => {
      const issue = makeIssue({ id: 'my-issue' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      // Start on kanban, open issue detail
      const wrapper = createWrapper('/test-repo/kanban');
      const { result } = renderHook(() => useAppWithLocation(), { wrapper });

      act(() => {
        result.current.setDetailIssueId('my-issue');
      });

      expect(result.current.detailIssueId).toBe('my-issue');

      act(() => {
        result.current.closeDetail();
      });

      expect(result.current.detailIssueId).toBeNull();
      expect(result.current.location.pathname).toBe('/test-repo/kanban');
    });

    it('closeDetail returns to terminals when issue was opened from terminals view', () => {
      const issue = makeIssue({ id: 'my-issue' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      // Start on terminals view
      const wrapper = createWrapper('/test-repo/terminals');
      const { result } = renderHook(() => useAppWithLocation(), { wrapper });

      expect(result.current.view).toBe('terminals');

      // Open issue detail
      act(() => {
        result.current.setDetailIssueId('my-issue');
      });

      expect(result.current.location.pathname).toBe('/test-repo/issues/my-issue');

      // Close detail — should return to terminals, NOT kanban
      act(() => {
        result.current.closeDetail();
      });

      expect(result.current.detailIssueId).toBeNull();
      expect(result.current.view).toBe('terminals');
      expect(result.current.location.pathname).toBe('/test-repo/terminals');
    });

    it('handleIssueClick navigates to issue URL', () => {
      const issue = makeIssue({ id: 'click-issue' });
      mockIssuesReturn = createMockIssuesReturn([issue]);

      const wrapper = createWrapper('/test-repo/kanban');
      const { result } = renderHook(() => useAppWithLocation(), { wrapper });

      act(() => {
        result.current.handleIssueClick('click-issue');
      });

      expect(result.current.detailIssueId).toBe('click-issue');
      expect(result.current.location.pathname).toBe('/test-repo/issues/click-issue');
    });
  });

  describe('PR detail navigation', () => {
    it('setSelectedPrId navigates to /:repoId/prs/:prId', () => {
      const wrapper = createWrapper('/test-repo/prs');
      const { result } = renderHook(() => useAppWithLocation(), { wrapper });

      act(() => {
        result.current.setSelectedPrId('pr-42');
      });

      expect(result.current.selectedPrId).toBe('pr-42');
      expect(result.current.location.pathname).toBe('/test-repo/prs/pr-42');
    });

    it('clearing selectedPrId navigates to /:repoId/prs', () => {
      const wrapper = createWrapper('/test-repo/prs/pr-42');
      const { result } = renderHook(() => useAppWithLocation(), { wrapper });

      expect(result.current.selectedPrId).toBe('pr-42');

      act(() => {
        result.current.setSelectedPrId(null);
      });

      expect(result.current.selectedPrId).toBeNull();
      expect(result.current.location.pathname).toBe('/test-repo/prs');
    });

    it('prs/:prId URL sets view to prs', () => {
      const wrapper = createWrapper('/test-repo/prs/pr-99');
      const { result } = renderHook(() => useApp(), { wrapper });

      expect(result.current.view).toBe('prs');
      expect(result.current.selectedPrId).toBe('pr-99');
    });
  });

  describe('git route', () => {
    it('/git route opens git panel', () => {
      const wrapper = createWrapper('/test-repo/git');
      const { result } = renderHook(() => useApp(), { wrapper });

      expect(result.current.gitPanelOpen).toBe(true);
      // View defaults to kanban when on git route
      expect(result.current.view).toBe('kanban');
    });
  });

  describe('repoId', () => {
    it('extracts repoId from URL', () => {
      const wrapper = createWrapper('/my-project/kanban');
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.repoId).toBe('my-project');
    });

    it('different repoIds work', () => {
      const wrapper = createWrapper('/another-repo/terminals');
      const { result } = renderHook(() => useApp(), { wrapper });
      expect(result.current.repoId).toBe('another-repo');
      expect(result.current.view).toBe('terminals');
    });
  });
});
