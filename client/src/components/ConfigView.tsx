import { useState, useEffect, useCallback, useRef } from 'react';
import type { MergeMode } from '../types';
import { API_BASE } from '../config';
import './ConfigView.css';

const GITHUB_URL = 'https://github.com/dmahan93/hermes-monitor';

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
}

export function ConfigView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  // Track the last server-confirmed value of githubRemote so onBlur can detect real changes.
  // Without this, onChange updates local state first, making onBlur's comparison always equal.
  const savedRemoteRef = useRef<string>('origin');

  // Track whether the remote input is currently being edited (dirty).
  // When dirty, server responses from checkbox saves should NOT overwrite the local remote value.
  const remoteIsDirtyRef = useRef(false);

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
  }, [fetchConfig]);

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
            <span className="config-value">{config?.targetBranch ?? '—'}</span>
          </div>
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
