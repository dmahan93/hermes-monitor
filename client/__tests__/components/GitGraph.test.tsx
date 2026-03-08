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
  refreshing: false,
  error: null,
  selectedSha: null,
  files: [],
  filesLoading: false,
  onSelectCommit: vi.fn(),
  onFileClick: vi.fn(),
  onRefresh: vi.fn(),
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
    // Only the refresh button — no commit row buttons
    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute('aria-label', 'Refresh git graph');
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

  it('renders tag ref labels with tag style', () => {
    const commits = [
      makeCommit('abc1234567890', 'Release', ['tag: v1.0.0']),
    ];
    const graph = [makeNode('abc1234567890')];

    render(<GitGraph {...defaultProps} commits={commits} graph={graph} />);
    // tag: prefix is stripped and replaced with ⚑ prefix
    const tagRef = screen.getByText('⚑ v1.0.0');
    expect(tagRef).toBeInTheDocument();
    expect(tagRef).toHaveClass('git-ref-tag');
  });

  it('renders multiple ref types on a single commit', () => {
    const commits = [
      makeCommit('abc1234567890', 'Tagged release', [
        'HEAD -> main',
        'tag: v2.0',
        'origin/main',
      ]),
    ];
    const graph = [makeNode('abc1234567890')];

    render(<GitGraph {...defaultProps} commits={commits} graph={graph} />);
    expect(screen.getByText('HEAD -> main')).toHaveClass('git-ref-head');
    expect(screen.getByText('⚑ v2.0')).toHaveClass('git-ref-tag');
    expect(screen.getByText('○ main')).toHaveClass('git-ref-remote');
  });

  it('handles long commit messages with ellipsis via CSS class', () => {
    const longMsg =
      'This is a very long commit message that should be truncated with an ellipsis when it overflows the container width';
    const commits = [makeCommit('abc1234567890', longMsg)];
    const graph = [makeNode('abc1234567890')];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} />,
    );
    const subject = container.querySelector('.git-graph-subject');
    expect(subject).toBeInTheDocument();
    expect(subject?.textContent).toBe(longMsg);
    // The CSS class handles truncation — verify the element exists with the right class
    expect(subject?.classList.contains('git-graph-subject')).toBe(true);
  });

  it('first row straight line starts at commit center, not above', () => {
    // When the first commit has a straight line, the y1 should be cy (ROW_H/2 = 14)
    // instead of -LINE_EXT (-1.5) to prevent a line from extending above the topmost row
    const commits = [
      makeCommit('abc1234567890', 'HEAD commit'),
      makeCommit('def4567890123', 'Second commit'),
    ];
    const graph = [
      makeNode('abc1234567890', 0, [{ fromCol: 0, toCol: 0, type: 'straight' }]),
      makeNode('def4567890123', 0, [{ fromCol: 0, toCol: 0, type: 'straight' }]),
    ];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} />,
    );

    const rows = container.querySelectorAll('.git-graph-row');
    expect(rows.length).toBe(2);

    // First row: line should start at cy=14 (not -1.5)
    const firstRowLine = rows[0].querySelector('svg line');
    expect(firstRowLine).toBeInTheDocument();
    expect(firstRowLine?.getAttribute('y1')).toBe('14');

    // Second row: line should start at -LINE_EXT = -1.5
    const secondRowLine = rows[1].querySelector('svg line');
    expect(secondRowLine).toBeInTheDocument();
    expect(secondRowLine?.getAttribute('y1')).toBe('-1.5');
  });

  it('first row curved line omits the straight segment above the commit', () => {
    // For merge/branch lines on the first row, the straight segment from
    // -LINE_EXT to cy should be omitted entirely (no line going above the dot)
    const commits = [
      makeCommit('abc1234567890', 'Merge at HEAD'),
      makeCommit('def4567890123', 'Normal merge'),
    ];
    const graph = [
      makeNode('abc1234567890', 0, [{ fromCol: 1, toCol: 0, type: 'merge-left' }]),
      makeNode('def4567890123', 0, [{ fromCol: 1, toCol: 0, type: 'merge-left' }]),
    ];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} />,
    );

    const rows = container.querySelectorAll('.git-graph-row');

    // First row: should have a path (bezier) but NO line element inside the <g>
    const firstRowG = rows[0].querySelector('svg g');
    expect(firstRowG).toBeInTheDocument();
    const firstRowLines = firstRowG!.querySelectorAll('line');
    expect(firstRowLines.length).toBe(0);
    // But should still have the bezier path
    const firstRowPaths = firstRowG!.querySelectorAll('path');
    expect(firstRowPaths.length).toBe(1);

    // Second row: should have both a line and a path inside the <g>
    const secondRowG = rows[1].querySelector('svg g');
    expect(secondRowG).toBeInTheDocument();
    const secondRowLines = secondRowG!.querySelectorAll('line');
    expect(secondRowLines.length).toBe(1);
    expect(secondRowLines[0].getAttribute('y1')).toBe('-1.5');
    const secondRowPaths = secondRowG!.querySelectorAll('path');
    expect(secondRowPaths.length).toBe(1);
  });

  it('first row SVG has git-graph-svg-first class for CSS clip-path', () => {
    const commits = [
      makeCommit('abc1234567890', 'HEAD commit'),
      makeCommit('def4567890123', 'Second commit'),
    ];
    const graph = [
      makeNode('abc1234567890', 0, [{ fromCol: 0, toCol: 0, type: 'straight' }]),
      makeNode('def4567890123', 0, [{ fromCol: 0, toCol: 0, type: 'straight' }]),
    ];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} />,
    );

    const svgs = container.querySelectorAll('.git-graph-svg');
    expect(svgs.length).toBe(2);
    // First row SVG has the -first class
    expect(svgs[0].classList.contains('git-graph-svg-first')).toBe(true);
    // Second row SVG does not
    expect(svgs[1].classList.contains('git-graph-svg-first')).toBe(false);
  });

  it('first row merge commit: straight line starts at cy, branch bezier still renders', () => {
    // A merge commit at HEAD has both a straight line (first parent) and
    // a branch-right line (second parent). The straight line should start
    // at cy, and the branch-right bezier should render without a straight
    // segment above the circle.
    const commits = [
      makeCommit('abc1234567890', 'Merge at HEAD'),
      makeCommit('def4567890123', 'Parent commit'),
    ];
    const graph = [
      makeNode('abc1234567890', 0, [
        { fromCol: 0, toCol: 0, type: 'straight' },
        { fromCol: 0, toCol: 1, type: 'branch-right' },
      ]),
      makeNode('def4567890123', 0, [{ fromCol: 0, toCol: 0, type: 'straight' }]),
    ];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} />,
    );

    const rows = container.querySelectorAll('.git-graph-row');
    const firstRowSvg = rows[0].querySelector('svg')!;

    // The straight line should start at cy=14
    const straightLine = firstRowSvg.querySelector('line');
    expect(straightLine).toBeInTheDocument();
    expect(straightLine?.getAttribute('y1')).toBe('14');

    // The branch-right bezier group should have a <path> but NO <line>
    // (the straight segment above the circle is suppressed for first row)
    const gElements = firstRowSvg.querySelectorAll('g');
    expect(gElements.length).toBe(1);
    expect(gElements[0].querySelectorAll('path').length).toBe(1);
    expect(gElements[0].querySelectorAll('line').length).toBe(0);
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

  // ── Refresh button tests ──

  it('renders refresh button in header when onRefresh is provided', () => {
    const commits = [makeCommit('abc1234567890', 'Commit')];
    const graph = [makeNode('abc1234567890')];

    render(<GitGraph {...defaultProps} commits={commits} graph={graph} />);

    const refreshBtn = screen.getByRole('button', { name: 'Refresh git graph' });
    expect(refreshBtn).toBeInTheDocument();
    expect(refreshBtn).toHaveTextContent('↻');
  });

  it('does not render refresh button when onRefresh is not provided', () => {
    const commits = [makeCommit('abc1234567890', 'Commit')];
    const graph = [makeNode('abc1234567890')];

    render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        onRefresh={undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Refresh git graph' })).not.toBeInTheDocument();
  });

  it('calls onRefresh when refresh button is clicked', () => {
    const onRefresh = vi.fn();
    const commits = [makeCommit('abc1234567890', 'Commit')];
    const graph = [makeNode('abc1234567890')];

    render(
      <GitGraph
        {...defaultProps}
        commits={commits}
        graph={graph}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh git graph' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('refresh button has spinning class when refreshing', () => {
    const commits = [makeCommit('abc1234567890', 'Commit')];
    const graph = [makeNode('abc1234567890')];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} refreshing={true} />,
    );

    const refreshBtn = container.querySelector('.git-graph-refresh-spinning');
    expect(refreshBtn).toBeInTheDocument();
  });

  it('refresh button is disabled when refreshing', () => {
    const commits = [makeCommit('abc1234567890', 'Commit')];
    const graph = [makeNode('abc1234567890')];

    render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} refreshing={true} />,
    );

    const refreshBtn = screen.getByRole('button', { name: 'Refresh git graph' });
    expect(refreshBtn).toBeDisabled();
  });

  it('refresh button does not have spinning class when not refreshing', () => {
    const commits = [makeCommit('abc1234567890', 'Commit')];
    const graph = [makeNode('abc1234567890')];

    const { container } = render(
      <GitGraph {...defaultProps} commits={commits} graph={graph} refreshing={false} />,
    );

    expect(container.querySelector('.git-graph-refresh-spinning')).not.toBeInTheDocument();
  });

  it('renders refresh button in error state header', () => {
    render(<GitGraph {...defaultProps} error="Failed to load" />);

    const refreshBtn = screen.getByRole('button', { name: 'Refresh git graph' });
    expect(refreshBtn).toBeInTheDocument();
  });

  it('clicking refresh in error state calls onRefresh', () => {
    const onRefresh = vi.fn();

    render(<GitGraph {...defaultProps} error="Failed to load" onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh git graph' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('error-state refresh button has spinning class when refreshing', () => {
    const { container } = render(
      <GitGraph {...defaultProps} error="Failed to load" refreshing={true} />,
    );

    const refreshBtn = container.querySelector('.git-graph-refresh-spinning');
    expect(refreshBtn).toBeInTheDocument();
  });

  it('error-state refresh button is disabled when refreshing', () => {
    render(
      <GitGraph {...defaultProps} error="Failed to load" refreshing={true} />,
    );

    const refreshBtn = screen.getByRole('button', { name: 'Refresh git graph' });
    expect(refreshBtn).toBeDisabled();
  });
});
