import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../config';
import './FolderPicker.css';

interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

interface BrowseResponse {
  path: string;
  parent: string | null;
  entries: DirEntry[];
}

interface FolderPickerProps {
  /** Called when the user selects a directory */
  onSelect: (path: string) => void;
  /** Called when the user closes the picker */
  onClose: () => void;
  /** Initial path to browse (optional, defaults to server's home dir) */
  initialPath?: string;
}

/**
 * Directory browser for selecting a repository folder.
 * Fetches directory listings from GET /api/hub/browse and lets the user
 * navigate through the filesystem to find and select a git repo.
 */
export function FolderPicker({ onSelect, onClose, initialPath }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Manual path input
  const [manualPath, setManualPath] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const mountedRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const browse = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await fetch(`${API_BASE}/hub/browse${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to browse (${res.status})`);
      }
      const data: BrowseResponse = await res.json();
      if (!mountedRef.current) return;
      setCurrentPath(data.path);
      setEntries(data.entries);
      setParentPath(data.parent);
      setManualPath(data.path);
      // Scroll list to top on navigation
      if (listRef.current) listRef.current.scrollTop = 0;
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err.message || 'Failed to browse directory');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    browse(initialPath);
  }, [browse, initialPath]);

  const handleNavigate = (path: string) => {
    browse(path);
  };

  const handleGoUp = () => {
    if (parentPath) browse(parentPath);
  };

  const handleSelect = (path: string) => {
    onSelect(path);
  };

  const handleManualGo = () => {
    const trimmed = manualPath.trim();
    if (trimmed) browse(trimmed);
  };

  const handleManualKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualGo();
    }
    if (e.key === 'Escape') {
      setShowManualInput(false);
    }
  };

  /** Build breadcrumb segments from the current path */
  const breadcrumbs = currentPath.split('/').filter(Boolean);

  return (
    <div className="folder-picker" data-testid="folder-picker">
      <div className="folder-picker-header">
        <span className="folder-picker-title">Browse Folders</span>
        <button
          className="folder-picker-close"
          onClick={onClose}
          aria-label="Close folder picker"
          title="Close"
        >
          \u2715
        </button>
      </div>

      {/* Breadcrumb navigation */}
      <div className="folder-picker-breadcrumbs">
        <button
          className="folder-picker-crumb"
          onClick={() => handleNavigate('/')}
          title="Root"
        >
          /
        </button>
        {breadcrumbs.map((seg, i) => {
          const segPath = '/' + breadcrumbs.slice(0, i + 1).join('/');
          const isLast = i === breadcrumbs.length - 1;
          return (
            <span key={segPath} className="folder-picker-crumb-wrap">
              <span className="folder-picker-crumb-sep">/</span>
              {isLast ? (
                <span className="folder-picker-crumb folder-picker-crumb-current">{seg}</span>
              ) : (
                <button
                  className="folder-picker-crumb"
                  onClick={() => handleNavigate(segPath)}
                  title={segPath}
                >
                  {seg}
                </button>
              )}
            </span>
          );
        })}
        <button
          className="folder-picker-edit-path"
          onClick={() => setShowManualInput(!showManualInput)}
          title="Type a path manually"
          aria-label="Type a path manually"
        >
          \u270e
        </button>
      </div>

      {/* Manual path input (togglable) */}
      {showManualInput && (
        <div className="folder-picker-manual">
          <input
            className="folder-picker-manual-input"
            type="text"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            onKeyDown={handleManualKeyDown}
            placeholder="/path/to/directory"
            autoFocus
          />
          <button
            className="folder-picker-manual-go"
            onClick={handleManualGo}
          >
            Go
          </button>
        </div>
      )}

      {error && (
        <div className="folder-picker-error" role="alert">{error}</div>
      )}

      {/* Directory listing */}
      <div className="folder-picker-list" ref={listRef}>
        {loading ? (
          <div className="folder-picker-loading">Loading...</div>
        ) : (
          <>
            {parentPath && (
              <div
                className="folder-picker-entry folder-picker-parent"
                onClick={handleGoUp}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleGoUp(); }
                }}
              >
                <span className="folder-picker-icon">\ud83d\udcc1</span>
                <span className="folder-picker-name">..</span>
              </div>
            )}
            {entries.length === 0 && !loading && (
              <div className="folder-picker-empty">No subdirectories</div>
            )}
            {entries.map((entry) => (
              <div
                key={entry.path}
                className={`folder-picker-entry${entry.isGitRepo ? ' folder-picker-git' : ''}`}
              >
                <div
                  className="folder-picker-entry-info"
                  onClick={() => handleNavigate(entry.path)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNavigate(entry.path); }
                  }}
                >
                  <span className="folder-picker-icon">
                    {entry.isGitRepo ? '\ud83d\udce6' : '\ud83d\udcc1'}
                  </span>
                  <span className="folder-picker-name">{entry.name}</span>
                  {entry.isGitRepo && (
                    <span className="folder-picker-git-badge">git</span>
                  )}
                </div>
                <button
                  className="folder-picker-select-btn"
                  onClick={() => handleSelect(entry.path)}
                  title={`Select ${entry.name}`}
                  aria-label={`Select ${entry.name}`}
                >
                  Select
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer: select current directory */}
      <div className="folder-picker-footer">
        <button
          className="folder-picker-select-current"
          onClick={() => handleSelect(currentPath)}
          disabled={loading}
        >
          [SELECT THIS FOLDER]
        </button>
      </div>
    </div>
  );
}
