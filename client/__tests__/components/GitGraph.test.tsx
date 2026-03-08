import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitGraph } from '../../src/components/GitGraph';
import type { GitCommit, GraphNode } from '../../src/hooks/useGitGraph';

const makeCommit = (
  hash: string,
  message: string,
  refs: string[] = [],
): GitCommit => ({
  hash,
  shortHash: hash.slice(0, 7),
  message,
  author: 'Test Author',
  date: '2025-01-01',
  parents: [],
  refs,
});

const makeNode = (
  hash: string,
  col = 0,
  lines: GraphNode['lines'] = [],
): GraphNode => ({
  hash,
  col,
  lines,
});

const defaultProps = {
  commits: [] as GitCommit[],
  graph: [] as GraphNode[],
  loading: false,
  error: null,
  selectedSha: null,
  files: [],
  filesLoading: false,
  onSelectCommit: vi.fn(),
  onFileClick: vi.fn(),
};

describe('GitGraph', () => {
  it('renders loading state', () => {
    render(<GitGraph {...defaultProps} loading={true} />);
    expect(screen.getByText('loading...')).toBeInTheDocument();
    expect(screen.getByText('GIT')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<GitGraph {...defaultProps} error="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('GIT')).toBeInTheDocument();
  });

  it('renders commit list when data is provided', () => {
    const commits = [
      makeCommit('abc1234567890', 'Initial commit'),
      makeCommit('def4567890123', 'Add feature'),
    ];
    const graph = [
      makeNode('abc1234567890'),
      makeNode('def4567890123'),
    ];

    render(<GitGraph {...defaultProps} commits={commits} graph={graph} />);
    expect(screen.getByText('Initial commit')).toBeInTheDocument();
    expect(screen.getByText('Add feature')).toBeInTheDocument();
    expect(screen.getByText('GIT GRAPH')).toBeInTheDocument();
  });

  it('handles empty commit list', () => {
    render(<GitGraph {...defaultProps} />);
    expect(screen.getByText('GIT GRAPH')).toBeInTheDocument();
    // No commit elements rendered
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('clicking a commit calls onSelectCommit', () => {
    const onSelectCommit = vi.fn();
    const commits = [makeCommit('abc1234567890', 'Fix bug')];
    const graph = [makeNode('abc1234567890')];

    render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        onSelectCommit={onSelectCommit}
      />,
    );

    fireEvent.click(screen.getByText('Fix bug'));
    expect(onSelectCommit).toHaveBeenCalledWith('abc1234567890');
  });

  it('renders branch labels/refs', () => {
    const commits = [
      makeCommit('abc1234567890', 'On main', ['HEAD -> main']),
      makeCommit('def4567890123', 'On feature', ['origin/feature-x']),
    ];
    const graph = [
      makeNode('abc1234567890'),
      makeNode('def4567890123'),
    ];

    render(<GitGraph {...defaultProps} commits={commits} graph={graph} />);
    expect(screen.getByText('HEAD -> main')).toBeInTheDocument();
    // origin/ prefix is stripped and replaced with ○ prefix
    expect(screen.getByText('○ feature-x')).toBeInTheDocument();
  });

  it('shows ref CSS classes based on ref type', () => {
    const commits = [
      makeCommit('abc1234567890', 'Commit', ['HEAD -> main', 'origin/main', 'develop']),
    ];
    const graph = [makeNode('abc1234567890')];

    render(<GitGraph {...defaultProps} commits={commits} graph={graph} />);

    const headRef = screen.getByText('HEAD -> main');
    expect(headRef).toHaveClass('git-ref-head');

    const remoteRef = screen.getByText('○ main');
    expect(remoteRef).toHaveClass('git-ref-remote');

    const branchRef = screen.getByText('develop');
    expect(branchRef).toHaveClass('git-ref-branch');
  });

  it('renders short hash and metadata', () => {
    const commits = [makeCommit('abc1234567890', 'Some change')];
    const graph = [makeNode('abc1234567890')];

    render(<GitGraph {...defaultProps} commits={commits} graph={graph} />);
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('Test Author')).toBeInTheDocument();
    expect(screen.getByText('2025-01-01')).toBeInTheDocument();
  });

  it('highlights selected commit row', () => {
    const commits = [makeCommit('abc1234567890', 'Selected commit')];
    const graph = [makeNode('abc1234567890')];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} selectedSha="abc1234567890" />,
    );
    const row = container.querySelector('.git-graph-row-selected');
    expect(row).toBeInTheDocument();
  });

  it('shows file list when commit is selected', () => {
    const commits = [makeCommit('abc1234567890', 'Commit with files')];
    const graph = [makeNode('abc1234567890')];
    const files = [
      { path: 'src/index.ts', status: 'M' as const, additions: 5, deletions: 2 },
      { path: 'src/new-file.ts', status: 'A' as const, additions: 10, deletions: 0 },
    ];

    render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        selectedSha="abc1234567890"
        files={files}
      />,
    );

    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('new-file.ts')).toBeInTheDocument();
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.getByText('-2')).toBeInTheDocument();
  });

  it('shows files loading state', () => {
    const commits = [makeCommit('abc1234567890', 'Loading files')];
    const graph = [makeNode('abc1234567890')];

    render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        selectedSha="abc1234567890"
        filesLoading={true}
      />,
    );

    expect(screen.getByText('loading files...')).toBeInTheDocument();
  });

  it('shows empty files state', () => {
    const commits = [makeCommit('abc1234567890', 'No files')];
    const graph = [makeNode('abc1234567890')];

    render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        selectedSha="abc1234567890"
        files={[]}
      />,
    );

    expect(screen.getByText('no files')).toBeInTheDocument();
  });

  it('clicking a file calls onFileClick', () => {
    const onFileClick = vi.fn();
    const commits = [makeCommit('abc1234567890', 'Commit')];
    const graph = [makeNode('abc1234567890')];
    const files = [
      { path: 'src/app.ts', status: 'M' as const, additions: 1, deletions: 1 },
    ];

    render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        selectedSha="abc1234567890"
        files={files}
        onFileClick={onFileClick}
      />,
    );

    fireEvent.click(screen.getByText('app.ts'));
    expect(onFileClick).toHaveBeenCalledWith('abc1234567890', 'src/app.ts');
  });

  it('renders SVG commit circle at correct column position', () => {
    const commits = [makeCommit('abc1234567890', 'Commit on lane 2')];
    const graph = [makeNode('abc1234567890', 2)];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} />,
    );

    const circle = container.querySelector('circle');
    expect(circle).toBeInTheDocument();
    // col=2, LANE_W=12, so cx = 2*12 + 12/2 + 2 = 32
    expect(circle?.getAttribute('cx')).toBe('32');
  });

  it('renders SVG lane lines for straight type', () => {
    const commits = [
      makeCommit('abc1234567890', 'Commit with line'),
    ];
    const graph = [
      makeNode('abc1234567890', 0, [{ fromCol: 0, toCol: 0, type: 'straight' }]),
    ];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} />,
    );

    const svgLines = container.querySelectorAll('svg line');
    expect(svgLines.length).toBeGreaterThanOrEqual(1);
  });

  it('renders SVG curved lines for merge types', () => {
    const commits = [
      makeCommit('abc1234567890', 'Merge commit'),
    ];
    const graph = [
      makeNode('abc1234567890', 0, [{ fromCol: 1, toCol: 0, type: 'merge-left' }]),
    ];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} />,
    );

    // Curved merge lines render a <g> with a <line> + <path>
    const paths = container.querySelectorAll('svg path');
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it('renders deleted file status icon and class', () => {
    const commits = [makeCommit('abc1234567890', 'Delete file')];
    const graph = [makeNode('abc1234567890')];
    const files = [
      { path: 'old-file.ts', status: 'D' as const, additions: 0, deletions: 15 },
    ];

    const { container } = render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        selectedSha="abc1234567890"
        files={files}
      />,
    );

    // statusIcon('D') = '−', statusClass('D') = 'git-file-deleted'
    expect(screen.getByText('−')).toBeInTheDocument();
    const statusEl = container.querySelector('.git-file-deleted');
    expect(statusEl).toBeInTheDocument();
    expect(screen.getByText('-15')).toBeInTheDocument();
  });

  it('renders renamed file status icon and class', () => {
    const commits = [makeCommit('abc1234567890', 'Rename file')];
    const graph = [makeNode('abc1234567890')];
    const files = [
      { path: 'src/new-name.ts', status: 'R' as const, additions: 0, deletions: 0 },
    ];

    const { container } = render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        selectedSha="abc1234567890"
        files={files}
      />,
    );

    // statusIcon('R') = '→', statusClass('R') = 'git-file-renamed'
    expect(screen.getByText('→')).toBeInTheDocument();
    const statusEl = container.querySelector('.git-file-renamed');
    expect(statusEl).toBeInTheDocument();
  });

  it('renders unknown file status with fallback', () => {
    const commits = [makeCommit('abc1234567890', 'Unknown status')];
    const graph = [makeNode('abc1234567890')];
    const files = [
      { path: 'src/weird.ts', status: 'U' as const, additions: 0, deletions: 0 },
    ];

    render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        selectedSha="abc1234567890"
        files={files}
      />,
    );

    // statusIcon(unknown) = '?'
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
