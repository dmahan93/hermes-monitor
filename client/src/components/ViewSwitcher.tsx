import { useNavigate, useParams } from 'react-router-dom';
import type { ViewMode } from '../routeConstants';
import './ViewSwitcher.css';

// Re-export for backward compat (some tests may import from here)
export type { ViewMode } from '../routeConstants';
export { VALID_VIEWS } from '../routeConstants';

interface ViewSwitcherProps {
  mode: ViewMode;
  prCount?: number;
  activeAgentCount?: number;
}

export function ViewSwitcher({ mode, prCount, activeAgentCount }: ViewSwitcherProps) {
  const navigate = useNavigate();
  const { repoId } = useParams<{ repoId: string }>();

  const handleChange = (newMode: ViewMode) => {
    // Use replace to avoid polluting history — tab switches are not page navigations
    navigate(`/${encodeURIComponent(repoId || 'default')}/${newMode}`, { replace: true });
  };

  return (
    <div className="view-switcher">
      <button
        className={`view-switcher-btn ${mode === 'kanban' ? 'view-switcher-active' : ''}`}
        onClick={() => handleChange('kanban')}
      >
        [KANBAN]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'terminals' ? 'view-switcher-active' : ''}`}
        onClick={() => handleChange('terminals')}
      >
        [TERMINALS]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'prs' ? 'view-switcher-active' : ''}`}
        onClick={() => handleChange('prs')}
      >
        [PRs{prCount ? ` ${prCount}` : ''}]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'manager' ? 'view-switcher-active' : ''}`}
        onClick={() => handleChange('manager')}
      >
        [MANAGER{activeAgentCount ? ` ${activeAgentCount}` : ''}]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'research' ? 'view-switcher-active' : ''}`}
        onClick={() => handleChange('research')}
      >
        [RESEARCH]
      </button>
      <button
        className={`view-switcher-btn ${mode === 'config' ? 'view-switcher-active' : ''}`}
        onClick={() => handleChange('config')}
      >
        [CONFIG]
      </button>
    </div>
  );
}
