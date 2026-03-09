import { useState, useEffect, useCallback, useRef } from 'react';
import type { MergeMode, ManagerTerminalAgent } from '../types';
import { API_BASE } from '../config';
import './ConfigView.css';

const GITHUB_URL = 'https://github.com/dmahan93/hermes-monitor';
const MANAGER_TERMINAL_OPTIONS: Array<{ value: ManagerTerminalAgent; label: string }> = [
  { value: 'hermes', label: 'Hermes' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini CLI' },
];

interface AppConfig {
  repoPath: string;
  worktreeBase: string;
  reviewBase: string;
  screenshotBase: string;
  targetBranch: string;
  requireScreenshotsForUiChanges: boolean;
  githubEnabled: boolean;
  githubRemote: string;
  mergeMode: MergeMode;
  managerTerminalAgent: ManagerTerminalAgent;
}

export function ConfigView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [branches, setBranches] = useState<string[]>([]);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchError, setBranchError] = useState<string | null>(null);

  // Track the last server-confirmed value of githubRemote so onBlur can detect real changes.
  // Without this, onChange updates local state first, making onBlur's comparison always equal.
  const savedRemoteRef = useRef<string>('origin');

  // Track whether the remote input is currently being edited (dirty).
  // When dirty, server responses from checkbox saves should NOT overwrite the local remote value.
  const remoteIsDirtyRef = useRef(false);

  const fetchBranches = useCallback(() => {
    fetch(`${API_BASE}/branches`)
      .then((res) => res.json())
      .then((data) => {
        if (data.branches) setBranches(data.branches);
      })
      .catch(() => { /* ignore */ });
  }, []);

  const fetchConfig = useCallback(() => {
    fetch(`${API_BASE}/config`)
      .then((res) => res.json())
      .then((data) => {
        setConfig(data);
        savedRemoteRef.current = data.githubRemote ?? 'origin';
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchBranches();
  }, [fetchConfig, fetchBranches]);

  const updateConfig = useCallback(async (updates: Partial<AppConfig>) => {
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await fetch(`${API_BASE}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        // If the remote input is dirty (user is typing), preserve their in-progress edit
        // instead of clobbering it with the server's old value.
        setConfig((prev) => {
          if (remoteIsDirtyRef.current && prev) {
            return { ...data, githubRemote: prev.githubRemote };
          }
          return data;
        });
        // Update the saved ref for fields that were just persisted
        if (updates.githubRemote !== undefined) {
          savedRemoteRef.current = data.githubRemote;
          remoteIsDirtyRef.current = false;
        }
        setSaveStatus('saved');
        // Notify AppContext (and any other listeners) about config changes
        // so they can update their local state without a page reload.
        window.dispatchEvent(new CustomEvent('hermes:config-updated', { detail: data }));
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }, []);

  const handleBranchChange = useCallback((value: string) => {
    if (value === '__create__') {
      setCreatingBranch(true);
      setNewBranchName('');
      setBranchError(null);
    } else {
      setCreatingBranch(false);
      updateConfig({ targetBranch: value });
    }
  }, [updateConfig]);

  const handleCreateBranch = useCallback(async () => {
    const trimmed = newBranchName.trim();
    if (!trimmed) return;
    setBranchError(null);
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreatingBranch(false);
        setNewBranchName('');
        fetchBranches();
        fetchConfig();
        setSaveStatus('saved');
        window.dispatchEvent(new CustomEvent('hermes:config-updated', { detail: data.config }));
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setBranchError(data.error || 'Failed to create branch');
      }
    } catch {
      setBranchError('Failed to create branch');
    } finally {
      setSaving(false);
    }
  }, [newBranchName, fetchBranches, fetchConfig]);

  if (loading) {
    return (
      <div className="config-view">
        <div className="config-panel">
          <h2 className="config-heading">CONFIGURATION</h2>
          <p className="config-text">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="config-view">
      <div className="config-panel">
        <h2 className="config-heading">CONFIGURATION</h2>

        {saveStatus === 'saved' && (
          <div className="config-save-status config-save-ok">✓ Settings saved</div>
        )}
        {saveStatus === 'error' && (
          <div className="config-save-status config-save-err">✗ Failed to save</div>
        )}

        <div className="config-section">
          <h3 className="config-section-title">GitHub Integration</h3>
          <p className="config-text">
            Push agent branches to GitHub and create pull requests automatically.
            Requires a GitHub remote and <code>gh</code> CLI authenticated.
          </p>
          <div className="config-field">
            <label className="config-toggle">
              <input
                type="checkbox"
                checked={config?.githubEnabled ?? false}
                disabled={saving}
                onChange={(e) => updateConfig({ githubEnabled: e.target.checked })}
              />
              <span className="config-toggle-label">
                {config?.githubEnabled ? '● ENABLED' : '○ DISABLED'}
              </span>
            </label>
          </div>
          <div className="config-field">
            <label className="config-label">Remote</label>
            <input
              type="text"
              className="config-input"
              value={config?.githubRemote ?? 'origin'}
              disabled={saving}
              onChange={(e) => {
                remoteIsDirtyRef.current = true;
                setConfig((c) => c ? { ...c, githubRemote: e.target.value } : c);
              }}
              onBlur={(e) => {
                const val = e.target.value.trim();
                // Compare against the last server-confirmed value, not local state
                // (onChange already updated local state, so config?.githubRemote === val)
                if (val && val !== savedRemoteRef.current) {
                  updateConfig({ githubRemote: val });
                } else {
                  remoteIsDirtyRef.current = false;
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <span className="config-hint">Git remote name (e.g., origin, upstream)</span>
          </div>
          <div className="config-field">
            <label className="config-label">Merge Mode</label>
            <select
              className="config-input"
              value={config?.mergeMode ?? 'local'}
              disabled={saving}
              onChange={(e) => updateConfig({ mergeMode: e.target.value as MergeMode })}
            >
              <option value="local">Local — merge locally, optionally push</option>
              <option value="github">GitHub — push branch + create GH PR, skip local merge</option>
              <option value="both">Both — merge locally AND create GH PR</option>
            </select>
            <span className="config-hint">
              How the Merge button works: local merge, GitHub PR, or both
            </span>
          </div>
        </div>

        <div className="config-section">
          <h3 className="config-section-title">Manager Terminal</h3>
          <div className="config-field">
            <label className="config-label">CLI Tool</label>
            <select
              className="config-input"
              value={config?.managerTerminalAgent ?? 'hermes'}
              disabled={saving}
              onChange={(e) => updateConfig({ managerTerminalAgent: e.target.value as ManagerTerminalAgent })}
            >
              {MANAGER_TERMINAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <span className="config-hint">
              The manager terminal launches this CLI when the manager view opens
            </span>
          </div>
        </div>

        <div className="config-section">
          <h3 className="config-section-title">Review Settings</h3>
          <div className="config-field">
            <label className="config-toggle">
              <input
                type="checkbox"
                checked={config?.requireScreenshotsForUiChanges ?? true}
                disabled={saving}
                onChange={(e) => updateConfig({ requireScreenshotsForUiChanges: e.target.checked })}
              />
              <span className="config-toggle-label">
                Require screenshots for UI changes
              </span>
            </label>
          </div>
        </div>

        <div className="config-section">
          <h3 className="config-section-title">Repository</h3>
          <div className="config-field">
            <label className="config-label">Repo Path</label>
            <span className="config-value">{config?.repoPath ?? '—'}</span>
          </div>
          <div className="config-field">
            <label className="config-label">Target Branch</label>
            <select
              className="config-input"
              value={creatingBranch ? '__create__' : (config?.targetBranch ?? '')}
              disabled={saving}
              onChange={(e) => handleBranchChange(e.target.value)}
            >
              {branches.map((branch) => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
              {config?.targetBranch && !branches.includes(config.targetBranch) && (
                <option value={config.targetBranch}>{config.targetBranch}</option>
              )}
              <option value="__create__">＋ Create new branch…</option>
            </select>
            <span className="config-hint">
              All future merges will target this branch
            </span>
          </div>
          {creatingBranch && (
            <div className="config-field config-create-branch">
              <label className="config-label">New Branch Name</label>
              <div className="config-branch-input-row">
                <input
                  type="text"
                  className="config-input"
                  value={newBranchName}
                  disabled={saving}
                  placeholder="e.g. develop, release/v2"
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateBranch();
                    if (e.key === 'Escape') {
                      setCreatingBranch(false);
                      setBranchError(null);
                    }
                  }}
                  autoFocus
                />
                <button
                  className="config-btn config-btn-create"
                  disabled={saving || !newBranchName.trim()}
                  onClick={handleCreateBranch}
                >
                  Create
                </button>
                <button
                  className="config-btn config-btn-cancel"
                  disabled={saving}
                  onClick={() => {
                    setCreatingBranch(false);
                    setBranchError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              {branchError && (
                <span className="config-branch-error">{branchError}</span>
              )}
              <span className="config-hint">
                Branch will be created from current target branch ({config?.targetBranch})
              </span>
            </div>
          )}
        </div>

        <div className="config-section">
          <h3 className="config-section-title">About</h3>
          <p className="config-text">
            Hermes Monitor — terminal grid, kanban board, and PR management for autonomous agents.
          </p>
        </div>
        <div className="config-section">
          <h3 className="config-section-title">Links</h3>
          <a
            className="config-link"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            ⟶ GitHub Repository
          </a>
        </div>
      </div>
    </div>
  );
}
