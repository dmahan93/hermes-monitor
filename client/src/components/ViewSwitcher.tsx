export type ViewMode = 'terminals' | 'kanban';

interface ViewSwitcherProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewSwitcher({ mode, onChange }: ViewSwitcherProps) {
  return (
    <div className="view-switcher">
      <button
        className={`view-switcher-btn ${mode === 'kanban' ? 'active' : ''}`}
        onClick={() => onChange('kanban')}
      >
        [KANBAN]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'terminals' ? 'active' : ''}`}
        onClick={() => onChange('terminals')}
      >
        [TERMINALS]
      </button>
    </div>
  );
}
