import type { Issue, AgentPreset } from '../types';

interface AgentTerminalListProps {
  issues: Issue[];
  agents: AgentPreset[];
  activeTerminalId: string | null;
  onSelect: (issueId: string) => void;
}

export function AgentTerminalList({ issues, agents, activeTerminalId, onSelect }: AgentTerminalListProps) {
  const activeIssues = issues.filter((i) => i.terminalId);

  if (activeIssues.length === 0) {
    return (
      <div className="agent-list">
        <div className="agent-list-header">AGENT TERMINALS</div>
        <div className="agent-list-empty">No agents running.</div>
      </div>
    );
  }

  return (
    <div className="agent-list">
      <div className="agent-list-header">AGENT TERMINALS</div>
      <div className="agent-list-items">
        {activeIssues.map((issue) => {
          const agent = agents.find((a) => a.id === issue.agent);
          const isActive = activeTerminalId === issue.terminalId;
          return (
            <button
              key={issue.id}
              className={`agent-list-item ${isActive ? 'agent-list-item-active' : ''}`}
              onClick={() => onSelect(issue.id)}
            >
              <span className="agent-list-icon">{agent?.icon || '▸'}</span>
              <div className="agent-list-item-info">
                <span className="agent-list-item-title">{issue.title}</span>
                <span className="agent-list-item-meta">
                  {issue.status} · {issue.branch || 'no branch'}
                </span>
              </div>
              <span className="agent-list-status">▸</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
