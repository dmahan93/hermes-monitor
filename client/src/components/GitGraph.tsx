import { useMemo } from 'react';
import type { GitCommit, GraphNode, GitFileChange } from '../hooks/useGitGraph';

interface GitGraphProps {
  commits: GitCommit[];
  graph: GraphNode[];
  loading: boolean;
  error: string | null;
  selectedSha: string | null;
  files: GitFileChange[];
  filesLoading: boolean;
  onSelectCommit: (sha: string | null) => void;
  onFileClick: (sha: string, path: string) => void;
}

const LANE_COLORS = [
  'var(--accent)',     // green
  'var(--link)',       // blue
  'var(--warn)',       // yellow
  '#cc66ff',           // purple
  '#ff6688',           // pink
  '#66cccc',           // teal
  '#ff9944',           // orange
  '#88cc44',           // lime
];

function laneColor(col: number): string {
  return LANE_COLORS[col % LANE_COLORS.length];
}

const LANE_W = 12;
const NODE_R = 3;
const ROW_H = 22;

function GraphSvg({ node, maxCols }: { node: GraphNode; maxCols: number }) {
  const w = (maxCols + 1) * LANE_W + 4;
  const cx = node.col * LANE_W + LANE_W / 2 + 2;
  const cy = ROW_H / 2;

  return (
    <svg width={w} height={ROW_H} className="git-graph-svg">
      {/* Pass-through and branch lines */}
      {node.lines.map((line, i) => {
        const x1 = line.fromCol * LANE_W + LANE_W / 2 + 2;
        const x2 = line.toCol * LANE_W + LANE_W / 2 + 2;
        const color = laneColor(line.fromCol);

        if (line.type === 'straight') {
          return (
            <line
              key={i}
              x1={x1}
              y1={0}
              x2={x2}
              y2={ROW_H}
              stroke={color}
              strokeWidth={1.5}
              opacity={line.fromCol === node.col ? 0.8 : 0.35}
            />
          );
        }

        // Curved merge/branch lines:
        // Draw from the node (mid-height) curving down to the target lane at the bottom.
        // Also draw a straight segment from the top to the node for the incoming lane.
        return (
          <g key={i}>
            {/* Straight segment from top to node center on the source lane */}
            <line
              x1={x1}
              y1={0}
              x2={x1}
              y2={cy}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.6}
            />
            {/* Curve from node center on source lane to bottom of target lane */}
            <path
              d={`M ${x1} ${cy} C ${x1} ${ROW_H * 0.75}, ${x2} ${ROW_H * 0.25}, ${x2} ${ROW_H}`}
              stroke={laneColor(line.toCol)}
              strokeWidth={1.5}
              fill="none"
              opacity={0.6}
            />
          </g>
        );
      })}

      {/* Commit node */}
      <circle
        cx={cx}
        cy={cy}
        r={NODE_R}
        fill={laneColor(node.col)}
        stroke="var(--bg)"
        strokeWidth={1}
      />
    </svg>
  );
}

function statusIcon(status: string): string {
  switch (status) {
    case 'A': return '+';
    case 'D': return '−';
    case 'M': return '~';
    case 'R': return '→';
    default: return '?';
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'A': return 'git-file-added';
    case 'D': return 'git-file-deleted';
    case 'M': return 'git-file-modified';
    case 'R': return 'git-file-renamed';
    default: return '';
  }
}

export function GitGraph({
  commits,
  graph,
  loading,
  error,
  selectedSha,
  files,
  filesLoading,
  onSelectCommit,
  onFileClick,
}: GitGraphProps) {
  const maxCols = useMemo(
    () =>
      graph.reduce((max, n) => {
        const lineCols = n.lines.reduce(
          (m, l) => Math.max(m, l.fromCol, l.toCol),
          0
        );
        return Math.max(max, n.col, lineCols);
      }, 0),
    [graph]
  );

  if (loading) {
    return (
      <div className="git-graph-panel">
        <div className="git-graph-header">GIT</div>
        <div className="git-graph-loading">loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="git-graph-panel">
        <div className="git-graph-header">GIT</div>
        <div className="git-graph-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="git-graph-panel">
      <div className="git-graph-header">GIT GRAPH</div>
      <div className="git-graph-list">
        {commits.map((commit, idx) => {
          const node = graph[idx];
          const isSelected = selectedSha === commit.hash;
          const hasRefs = commit.refs.length > 0;

          return (
            <div key={commit.hash}>
              <button
                className={`git-graph-row ${isSelected ? 'git-graph-row-selected' : ''}`}
                onClick={() => onSelectCommit(commit.hash)}
                title={`${commit.hash}\n${commit.author}\n${commit.date}`}
              >
                {node && <GraphSvg node={node} maxCols={maxCols} />}
                <div className="git-graph-info">
                  <div className="git-graph-msg">
                    {hasRefs && (
                      <span className="git-graph-refs">
                        {commit.refs.map((r) => (
                          <span
                            key={r}
                            className={`git-graph-ref ${
                              r.startsWith('HEAD') ? 'git-ref-head' : 
                              r.startsWith('origin/') ? 'git-ref-remote' : 'git-ref-branch'
                            }`}
                          >
                            {r.replace('origin/', '○ ')}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="git-graph-subject">{commit.message}</span>
                  </div>
                  <div className="git-graph-meta">
                    <span className="git-graph-hash">{commit.shortHash}</span>
                    <span className="git-graph-author">{commit.author}</span>
                    <span className="git-graph-date">{commit.date}</span>
                  </div>
                </div>
              </button>

              {/* Expanded file list */}
              {isSelected && (
                <div className="git-graph-files">
                  {filesLoading ? (
                    <div className="git-graph-files-loading">loading files...</div>
                  ) : files.length === 0 ? (
                    <div className="git-graph-files-empty">no files</div>
                  ) : (
                    files.map((file) => (
                      <button
                        key={file.path}
                        className="git-graph-file"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFileClick(commit.hash, file.path);
                        }}
                      >
                        <span className={`git-file-status ${statusClass(file.status)}`}>
                          {statusIcon(file.status)}
                        </span>
                        <span className="git-file-name" title={file.path}>
                          {file.path.split('/').pop()}
                        </span>
                        {(file.additions > 0 || file.deletions > 0) && (
                          <span className="git-file-stats">
                            {file.additions > 0 && (
                              <span className="git-file-added">+{file.additions}</span>
                            )}
                            {file.deletions > 0 && (
                              <span className="git-file-deleted">-{file.deletions}</span>
                            )}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
