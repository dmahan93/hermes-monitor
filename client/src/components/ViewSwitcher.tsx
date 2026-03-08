import { useNavigate, useParams } from 'react-router-dom';
import './ViewSwitcher.css';

export type ViewMode = 'kanban' | 'terminals' | 'prs' | 'research' | 'config' | 'manager';

export const VALID_VIEWS: readonly ViewMode[] = ['kanban', 'terminals', 'prs', 'research', 'config', 'manager'];

interface ViewSwitcherProps {
  mode: ViewMode;
  onChange?: (mode: ViewMode) => void;
  prCount?: number;
  activeAgentCount?: number;
}

export function ViewSwitcher({ mode, onChange, prCount, activeAgentCount }: ViewSwitcherProps) {
  const navigate = useNavigate();
  const { repoId } = useParams<{ repoId: string }>();

  const handleChange = (newMode: ViewMode) => {
    if (onChange) {
      onChange(newMode);
    }
    navigate(`/${repoId}/${newMode}`);
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
