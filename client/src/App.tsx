import { useNavigate } from 'react-router-dom';
import { Header } from './components/Header';
import { TerminalGrid } from './components/TerminalGrid';
import { KanbanBoard } from './components/KanbanBoard';
import { IssueDetail } from './components/IssueDetail';
import { TaskTerminalPane } from './components/TaskTerminalPane';
import { PlanningPane } from './components/PlanningPane';
import { AgentTerminalList } from './components/AgentTerminalList';
import { PRList } from './components/PRList';
import { GitGraph } from './components/GitGraph';
import { DiffViewer } from './components/DiffViewer';
import { ConfigView } from './components/ConfigView';
import { ManagerView } from './components/ManagerView';
import { ViewSwitcher } from './components/ViewSwitcher';
import { StatusBar } from './components/StatusBar';
import { ErrorToast } from './components/ErrorToast';
import { AppProvider, useApp } from './context/AppContext';
import './App.css';

function AppContent() {
  const {
    connected, reconnectCount, send, subscribe,
    terminals, loading, updateLayout,
    issues, updateIssue, createSubtask,
    prs, addComment, setVerdict, mergePR, confirmMerge, fixConflicts, relaunchReview, closePR, closeAllStalePRs, mergeMode,
    agents, agentsLoading, agentsError,
    gitGraph,
    view, setView,
    gitPanelOpen, setGitPanelOpen,
    expandedIssue, setExpandedIssueId,
    termViewAgentIssue, setTermViewSelection, handleTermViewSelect,
    detailIssue, detailIssueId, detailEditing, detailSubtasks, detailPR,
    setDetailIssueId, setDetailEditing,
    selectedPrId, setSelectedPrId,
    planningIssue, setPlanningIssueId,
    awaitingInputIds,
    layout,
    showTaskTerminal, showPlanning,
    handleAddTerminal, handleCloseTerminal,
    handleCreateIssue, handleStatusChange, handleDeleteIssue,
    handleTerminalClick, handleIssueClick, handleEditIssue, handlePlanClick,
    handlePromote, handleStartPlanning, handleStopPlanning,
    closeDetail,
    errors, removeError,
  } = useApp();

  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="app">
        <div className="app-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        onAdd={view === 'terminals' ? handleAddTerminal : undefined}
        onHome={() => navigate('/')}
        connected={connected}
      >
        <ViewSwitcher
          mode={view}
          prCount={prs.length}
          activeAgentCount={issues.filter((i) => i.status === 'in_progress' || i.status === 'review').length}
        />
      </Header>
      <div className="app-body">
        {/* Git Graph Left Sidebar */}
        <div className={`git-graph-sidebar ${gitPanelOpen ? 'git-graph-open' : 'git-graph-closed'}`}>
          {gitPanelOpen ? (
            <GitGraph
              commits={gitGraph.commits}
              graph={gitGraph.graph}
              loading={gitGraph.loading}
              refreshing={gitGraph.refreshing}
              error={gitGraph.error}
              selectedSha={gitGraph.selectedSha}
              files={gitGraph.files}
              filesLoading={gitGraph.filesLoading}
              onSelectCommit={gitGraph.selectCommit}
              onFileClick={gitGraph.viewDiff}
              onRefresh={gitGraph.refresh}
            />
          ) : (
            <button
              className="git-graph-toggle"
              onClick={() => setGitPanelOpen(true)}
              title="Open git graph"
              aria-label="Open git graph"
            >
              ⎇
            </button>
          )}
          {gitPanelOpen && (
            <button
              className="git-graph-collapse"
              onClick={() => setGitPanelOpen(false)}
              title="Collapse git graph"
              aria-label="Collapse git graph"
            >
              ◂
            </button>
          )}
        </div>

        {/* Main content area */}
        <main className="main">
          {/* Terminal view: sidebar + grid/expanded agent */}
          <div className={`view-panel ${view === 'terminals' ? 'view-active' : 'view-hidden'}`}>
            <div className="terminals-layout">
              <div className="terminals-main">
                {termViewAgentIssue && termViewAgentIssue.terminalId ? (
                  <TaskTerminalPane
                    key={termViewAgentIssue.terminalId}
                    issue={termViewAgentIssue}
                    send={send}
                    subscribe={subscribe}
                    reconnectCount={reconnectCount}
                    onMinimize={() => setTermViewSelection(null)}
                    awaitingInput={awaitingInputIds.has(termViewAgentIssue.terminalId)}
                  />
                ) : (
                  <TerminalGrid
                    terminals={terminals}
                    layout={layout}
                    onLayoutChange={updateLayout}
                    send={send}
                    subscribe={subscribe}
                    reconnectCount={reconnectCount}
                    onClose={handleCloseTerminal}
                    awaitingInputIds={awaitingInputIds}
                  />
                )}
              </div>
              <div className="terminals-sidebar">
                <AgentTerminalList
                  issues={issues}
                  prs={prs}
                  agents={agents}
                  activeTerminalId={termViewAgentIssue?.terminalId || null}
                  onSelect={handleTermViewSelect}
                />
              </div>
            </div>
          </div>

          {/* Kanban view: board + optional split terminal */}
          <div className={`view-panel ${view === 'kanban' ? 'view-active' : 'view-hidden'}`}>
            {showPlanning && planningIssue ? (
              <PlanningPane
                key={planningIssue.id}
                issue={planningIssue}
                agents={agents}
                send={send}
                subscribe={subscribe}
                reconnectCount={reconnectCount}
                onUpdate={updateIssue}
                onPromote={handlePromote}
                onStartPlanning={handleStartPlanning}
                onStopPlanning={handleStopPlanning}
                onClose={() => setPlanningIssueId(null)}
              />
            ) : (
              <div className={`kanban-split ${showTaskTerminal ? 'split-open' : ''}`}>
                <div className="kanban-split-left">
                  <KanbanBoard
                    issues={issues}
                    agents={agents}
                    agentsLoading={agentsLoading}
                    agentsError={agentsError}
                    onStatusChange={handleStatusChange}
                    onCreateIssue={handleCreateIssue}
                    onDeleteIssue={handleDeleteIssue}
                    onEditIssue={handleEditIssue}
                    onTerminalClick={handleTerminalClick}
                    onIssueClick={handleIssueClick}
                    onPlanClick={handlePlanClick}
                  />
                </div>
                {showTaskTerminal && expandedIssue && (
                  <div className="kanban-split-right">
                    <TaskTerminalPane
                      issue={expandedIssue}
                      send={send}
                      subscribe={subscribe}
                      reconnectCount={reconnectCount}
                      onMinimize={() => setExpandedIssueId(null)}
                      awaitingInput={expandedIssue.terminalId ? awaitingInputIds.has(expandedIssue.terminalId) : false}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PR view */}
          <div className={`view-panel ${view === 'prs' ? 'view-active' : 'view-hidden'}`}>
            <PRList
              prs={prs}
              issues={issues}
              mergeMode={mergeMode}
              selectedPrId={selectedPrId}
              onSelectPr={setSelectedPrId}
              onComment={addComment}
              onVerdict={setVerdict}
              onMerge={mergePR}
              onConfirmMerge={confirmMerge}
              onFixConflicts={fixConflicts}
              onRelaunchReview={relaunchReview}
              onClosePR={closePR}
              onCloseAllStale={closeAllStalePRs}
              onMoveToInProgress={async (issueId) => { await handleStatusChange(issueId, 'in_progress'); }}
            />
          </div>

          {/* Manager view */}
          <div className={`view-panel ${view === 'manager' ? 'view-active' : 'view-hidden'}`}>
            <ManagerView
              issues={issues}
              prs={prs}
              agents={agents}
              isActive={view === 'manager'}
              onStatusChange={handleStatusChange}
              onMerge={mergePR}
              onRelaunchReview={relaunchReview}
              onViewTerminal={(issueId) => { setView('terminals'); handleTermViewSelect({ kind: 'agent', issueId }); }}
              onViewPR={() => setView('prs')}
              send={send}
              subscribe={subscribe}
              reconnectCount={reconnectCount}
            />
          </div>

          {/* Config view */}
          <div className={`view-panel ${view === 'config' ? 'view-active' : 'view-hidden'}`}>
            <ConfigView />
          </div>
        </main>
      </div>
      <StatusBar terminalCount={terminals.length} issueCount={issues.length} awaitingInputCount={awaitingInputIds.size} />

      {/* Diff viewer overlay */}
      {gitGraph.diffFile && gitGraph.diffSha && (
        <DiffViewer
          sha={gitGraph.diffSha}
          file={gitGraph.diffFile}
          diff={gitGraph.diffContent}
          loading={gitGraph.diffLoading}
          onClose={gitGraph.closeDiff}
        />
      )}
      {detailIssue && (
        <IssueDetail
          key={`${detailIssueId}-${detailEditing}`}
          issue={detailIssue}
          agents={agents}
          pr={detailPR}
          initialEditing={detailEditing}
          subtasks={detailSubtasks}
          parentIssue={detailIssue.parentId ? issues.find((i) => i.id === detailIssue.parentId) : undefined}
          onClose={closeDetail}
          onUpdate={(id, updates) => updateIssue(id, updates)}
          onStatusChange={async (id, status) => { const err = await handleStatusChange(id, status); if (!err) closeDetail(); return err; }}
          onDelete={(id) => { handleDeleteIssue(id); closeDetail(); }}
          onTerminalClick={(issueId) => { closeDetail(); handleTerminalClick(issueId); }}
          onPRClick={() => { closeDetail(); setView('prs'); }}
          onCreateSubtask={(parentId, title, desc) => createSubtask(parentId, title, desc)}
          onSubtaskClick={(issueId) => { setDetailIssueId(issueId); setDetailEditing(false); }}
          onParentClick={(issueId) => { setDetailIssueId(issueId); setDetailEditing(false); }}
        />
      )}
      <ErrorToast errors={errors} onDismiss={removeError} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
