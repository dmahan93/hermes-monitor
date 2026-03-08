import './ViewSwitcher.css';

export type ViewMode = 'kanban' | 'terminals' | 'prs' | 'research' | 'config';

interface ViewSwitcherProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  prCount?: number;
}

export function ViewSwitcher({ mode, onChange, prCount }: ViewSwitcherProps) {
  return (
    <div className="view-switcher">
      <button
        className={`view-switcher-btn ${mode === 'kanban' ? 'view-switcher-active' : ''}`}
        onClick={() => onChange('kanban')}
      >
        [KANBAN]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'terminals' ? 'view-switcher-active' : ''}`}
        onClick={() => onChange('terminals')}
      >
        [TERMINALS]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'prs' ? 'view-switcher-active' : ''}`}
        onClick={() => onChange('prs')}
      >
        [PRs{prCount ? ` ${prCount}` : ''}]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'research' ? 'view-switcher-active' : ''}`}
        onClick={() => onChange('research')}
      >
        [RESEARCH]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'config' ? 'view-switcher-active' : ''}`}
        onClick={() => onChange('config')}
      >
        [CONFIG]
      </button>
    </div>
  );
}
