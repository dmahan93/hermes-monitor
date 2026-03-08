import { useMemo } from 'react';
import type { GitCommit, GraphNode, GitFileChange } from '../hooks/useGitGraph';
import './GitGraph.css';

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

// Virtual coordinate constants for the SVG viewBox.  The actual rendered size
// is controlled by rem values so the graph scales with the root font-size
// (see clamp() in App.css).  These stay as unitless numbers that define the
// viewBox coordinate system — they don't set pixel sizes directly.
const LANE_W = 12;     // virtual lane width
const NODE_R = 3;      // virtual commit-dot radius
const ROW_H  = 28;     // virtual row height (viewBox)
const SVG_PAD = 4;     // virtual horizontal padding

// The *actual* CSS row height in rem — must match .git-graph-row in
// GitGraph.css.  Since the app's minimum root font-size is 12px, all rem
// values are calculated as px / 12 (e.g. 28 / 12 ≈ 2.333rem).
const ROW_H_REM = 2.333;

// Extension past SVG boundaries to eliminate sub-pixel rendering gaps between
// adjacent rows (in viewBox units). With the viewBox transform, rounding can
// cause 1-2 device-pixel seams; 1.5 virtual-px gives ~2px overlap at typical
// scale factors, which reliably closes them. Requires overflow:visible on
// .git-graph-svg.
const LINE_EXT = 1.5;

function GraphSvg({ node, maxCols }: { node: GraphNode; maxCols: number }) {
  const vW = (maxCols + 1) * LANE_W + SVG_PAD;
  const wRem = vW / 12; // rem width matching the virtual coordinate system
  const cx = node.col * LANE_W + LANE_W / 2 + 2;
  const cy = ROW_H / 2;

  return (
    <svg
      viewBox={`0 0 ${vW} ${ROW_H}`}
      preserveAspectRatio="none"
      style={{ width: `${wRem}rem`, height: `${ROW_H_REM}rem` }}
      className="git-graph-svg"
    >
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
              y1={-LINE_EXT}
              x2={x2}
              y2={ROW_H + LINE_EXT}
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
              y1={-LINE_EXT}
              x2={x1}
              y2={cy}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.6}
            />
            {/* Curve from node center on source lane to bottom of target lane */}
            <path
              d={`M ${x1} ${cy} C ${x1} ${ROW_H * 0.75}, ${x2} ${ROW_H * 0.25}, ${x2} ${ROW_H + LINE_EXT}`}
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
                            {r.startsWith('origin/') ? '○ ' + r.slice(7) : r}
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
