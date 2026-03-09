import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config';
import { useConfirm } from '../hooks/useConfirm';
import { FolderPicker } from './FolderPicker';
import './HubLanding.css';

export type RepoStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface RepoEntry {
  id: string;
  name: string;
  path: string;
  port: number;
  pid: number | null;
  status: RepoStatus;
  createdAt: number;
  updatedAt: number;
  // TODO: Stats enrichment not yet implemented on the server — these fields
  // are forward-looking scaffolding. The client type is a superset of the
  // server's RepoEntry (see registry.ts). Populate via /api/hub/repos when
  // the server supports it.
  issueCount?: number;
  activeAgents?: number;
  prCount?: number;
}

/**
 * Landing page for the Hermes Monitor Hub — shows all registered repos
 * in a card grid with status indicators, quick stats, and repo management.
 *
 * Fetches from /api/hub/repos and provides add/start/stop/remove actions.
 */
export function HubLanding() {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add repo form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addPath, setAddPath] = useState('');
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Per-repo mutation guard to prevent double-click / concurrent mutations
  const [mutatingRepos, setMutatingRepos] = useState<Set<string>>(new Set());

  // Track whether user has manually edited the name field
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  // Folder picker state
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // Track mounted state to avoid state updates after unmount
  const mountedRef = useRef(true);

  const navigate = useNavigate();
  const { confirm, ConfirmDialogElement } = useConfirm();

  const fetchRepos = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`${API_BASE}/hub/repos`, { signal });
      if (!res.ok) throw new Error(`Failed to fetch repos (${res.status})`);
      const data: RepoEntry[] = await res.json();
      setRepos(data);
      setError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.warn('HubLanding: /api/hub/repos unavailable', err.message);
      setError('Failed to load repositories');
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    fetchRepos(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [fetchRepos]);

  /** Reset the add-repo form to pristine state */
  const resetAddForm = () => {
    setAddPath('');
    setAddName('');
    setAddError(null);
    setNameManuallyEdited(false);
    setShowAddForm(false);
    setShowFolderPicker(false);
  };

  /** Auto-detect name from path (last segment of the directory) */
  const handlePathChange = (value: string) => {
    setAddPath(value);
    setAddError(null);
    // Only auto-detect name if the user hasn't manually edited it
    if (!nameManuallyEdited) {
      const trimmed = value.trim().replace(/\/+$/, '');
      const segments = trimmed.split('/');
      const detected = segments[segments.length - 1] || '';
      setAddName(detected);
    }
  };

  /** Handle manual name edits — marks name as user-edited */
  const handleNameChange = (value: string) => {
    setAddName(value);
    setNameManuallyEdited(true);
  };

  /** Register a new repo via POST /api/hub/repos */
  const handleAddRepo = async () => {
    const trimmed = addPath.trim();
    if (!trimmed) {
      setAddError('Path is required');
      return;
    }
    if (!trimmed.startsWith('/')) {
      setAddError('Path must be absolute (start with /)');
      return;
    }

    setAdding(true);
    setAddError(null);

    try {
      const body: { path: string; name?: string } = { path: trimmed };
      if (addName.trim()) body.name = addName.trim();

      const res = await fetch(`${API_BASE}/hub/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to register (${res.status})`);
      }

      // Success — refresh list, reset form
      resetAddForm();
      if (mountedRef.current) await fetchRepos();
    } catch (err: any) {
      setAddError(err.message || 'Failed to register repo');
    } finally {
      setAdding(false);
    }
  };

  /**
   * Toggle start/stop via the spawner API.
   * Uses POST /api/hub/repos/:id/start or /stop to actually spawn/kill
   * the hermes-monitor child process, not just update the registry status.
   */
  const handleToggle = async (repo: RepoEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mutatingRepos.has(repo.id)) return;

    const action = (repo.status === 'running' || repo.status === 'starting')
      ? 'stop'
      : 'start';

    setMutatingRepos(prev => new Set(prev).add(repo.id));
    try {
      const res = await fetch(`${API_BASE}/hub/repos/${encodeURIComponent(repo.id)}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${action} (${res.status})`);
      }
      if (mountedRef.current) await fetchRepos();
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || `Failed to ${action} repo`);
    } finally {
      setMutatingRepos(prev => { const next = new Set(prev); next.delete(repo.id); return next; });
    }
  };

  /** Remove repo via DELETE /api/hub/repos/:id (with confirmation) */
  const handleRemove = async (repo: RepoEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mutatingRepos.has(repo.id)) return;

    const ok = await confirm({
      title: 'Remove Repository',
      message: `Remove "${repo.name}" from the hub? This will not delete any files.`,
      confirmText: '[REMOVE]',
      variant: 'danger',
    });
    if (!ok) return;

    setMutatingRepos(prev => new Set(prev).add(repo.id));
    try {
      const res = await fetch(`${API_BASE}/hub/repos/${encodeURIComponent(repo.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to remove (${res.status})`);
      }
      if (mountedRef.current) await fetchRepos();
    } catch (err: any) {
      if (mountedRef.current) setError(err.message || 'Failed to remove repo');
    } finally {
      setMutatingRepos(prev => { const next = new Set(prev); next.delete(repo.id); return next; });
    }
  };

  /**
   * Build the per-repo client URL.
   * Each repo runs its own Vite client on (server port + CLIENT_PORT_OFFSET).
   * We must navigate to that origin — NOT use client-side routing — because
   * the Vite proxy on the current origin points to a different server.
   */
  const getRepoClientUrl = (repo: RepoEntry, path = ''): string => {
    const clientPort = repo.port + __CLIENT_PORT_OFFSET__;
    return `http://localhost:${clientPort}${path}`;
  };

  /** Navigate to repo settings — opens on the repo's own client */
  const handleSettings = (repo: RepoEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (repo.status === 'running') {
      window.location.href = getRepoClientUrl(repo, `/${encodeURIComponent(repo.id)}/config`);
    } else {
      navigate(`/${encodeURIComponent(repo.id)}/config`);
    }
  };

  /** Navigate to repo dashboard — opens on the repo's own client */
  const handleCardClick = (repo: RepoEntry) => {
    if (repo.status === 'running') {
      window.location.href = getRepoClientUrl(repo, `/${encodeURIComponent(repo.id)}`);
    } else {
      navigate(`/${encodeURIComponent(repo.id)}`);
    }
  };

  const statusLabel = (status: RepoStatus): string => {
    switch (status) {
      case 'running': return 'Running';
      case 'starting': return 'Starting';
      case 'stopped': return 'Stopped';
      case 'error': return 'Error';
      default: return status;
    }
  };

  if (loading) {
    return (
      <div className="hub-landing">
        <div className="hub-loading">Loading repositories...</div>
      </div>
    );
  }

  return (
    <div className="hub-landing">
      <header className="hub-header">
        <div className="hub-logo">⎇</div>
        <h1 className="hub-title">HERMES MONITOR HUB</h1>
        <p className="hub-subtitle">Select a repository to manage</p>
      </header>

      {error && (
        <div
          className="hub-error"
          role="alert"
        >
          {error}
          <button
            className="hub-error-dismiss"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="hub-toolbar">
        <button
          className="hub-add-btn"
          onClick={() => showAddForm ? resetAddForm() : setShowAddForm(true)}
          aria-label={showAddForm ? 'Cancel adding repository' : 'Add repository'}
        >
          {showAddForm ? '✕ Cancel' : '+ Add Repo'}
        </button>
      </div>

      {showAddForm && (
        <div className="hub-add-form" data-testid="add-repo-form">
          <div className="hub-add-field">
            <label className="hub-add-label" htmlFor="hub-add-path">
              Repository path
            </label>
            <div className="hub-add-path-row">
              <input
                id="hub-add-path"
                className="hub-add-input"
                type="text"
                placeholder="/home/user/my-project"
                value={addPath}
                onChange={(e) => handlePathChange(e.target.value)}
                autoFocus
              />
              <button
                className="hub-browse-btn"
                type="button"
                onClick={() => setShowFolderPicker(!showFolderPicker)}
                aria-label="Browse folders"
                title={showFolderPicker ? 'Close folder browser' : 'Browse folders'}
                data-testid="browse-folders-btn"
              >
                {showFolderPicker ? '\u2715' : '\ud83d\udcc2 Browse'}
              </button>
            </div>
          </div>
          {showFolderPicker && (
            <FolderPicker
              initialPath={addPath || undefined}
              onSelect={(path) => {
                handlePathChange(path);
                setShowFolderPicker(false);
              }}
              onClose={() => setShowFolderPicker(false)}
            />
          )}
          <div className="hub-add-field">
            <label className="hub-add-label" htmlFor="hub-add-name">
              Name (auto-detected)
            </label>
            <input
              id="hub-add-name"
              className="hub-add-input"
              type="text"
              placeholder="my-project"
              value={addName}
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </div>
          {addError && <div className="hub-add-error">{addError}</div>}
          <button
            className="hub-add-submit"
            onClick={handleAddRepo}
            disabled={adding}
          >
            {adding ? 'Registering...' : '[REGISTER]'}
          </button>
        </div>
      )}

      {repos.length === 0 && !error && (
        <div className="hub-empty">
          {"No repositories registered. Click \"Add Repo\" to get started."}
        </div>
      )}

      <div className="hub-grid">
        {repos.map((repo) => (
          <div
            key={repo.id}
            className="hub-card"
            onClick={() => handleCardClick(repo)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCardClick(repo);
              }
            }}
          >
            <div className="hub-card-header">
              <span
                className={`hub-status-dot hub-status-${repo.status}`}
                title={statusLabel(repo.status)}
                aria-label={statusLabel(repo.status)}
              />
              <span className="hub-card-name">{repo.name}</span>
            </div>
            <span className="hub-card-path">{repo.path}</span>

            {repo.status === 'running' && (
              <div className="hub-card-stats">
                {repo.issueCount !== undefined && (
                  <span className="hub-stat">{repo.issueCount} issues</span>
                )}
                {repo.activeAgents !== undefined && (
                  <span className="hub-stat">{repo.activeAgents} agents</span>
                )}
                {repo.prCount !== undefined && (
                  <span className="hub-stat">{repo.prCount} PRs</span>
                )}
              </div>
            )}

            <div className="hub-card-actions">
              <button
                className={`hub-action-btn ${repo.status === 'running' || repo.status === 'starting' ? 'hub-action-stop' : 'hub-action-start'}`}
                onClick={(e) => handleToggle(repo, e)}
                disabled={mutatingRepos.has(repo.id)}
                title={repo.status === 'running' || repo.status === 'starting' ? 'Stop' : 'Start'}
                aria-label={repo.status === 'running' || repo.status === 'starting' ? 'Stop' : 'Start'}
              >
                {repo.status === 'running' || repo.status === 'starting' ? '■ Stop' : '▶ Start'}
              </button>
              <button
                className="hub-action-btn hub-action-settings"
                onClick={(e) => handleSettings(repo, e)}
                title="Settings"
                aria-label="Settings"
              >
                ⚙
              </button>
              <button
                className="hub-action-btn hub-action-remove"
                onClick={(e) => handleRemove(repo, e)}
                disabled={mutatingRepos.has(repo.id) || repo.status === 'running' || repo.status === 'starting'}
                title={repo.status === 'running' || repo.status === 'starting' ? 'Stop the repo before removing' : 'Remove'}
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      {ConfirmDialogElement}
    </div>
  );
}
