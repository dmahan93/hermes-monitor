import { useState, useEffect, useCallback } from 'react';
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
}

export function ConfigView() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const fetchConfig = useCallback(() => {
    fetch(`${API_BASE}/config`)
      .then((res) => res.json())
      .then((data) => {
        setConfig(data);
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
        setConfig(data);
        setSaveStatus('saved');
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
              onChange={(e) => setConfig((c) => c ? { ...c, githubRemote: e.target.value } : c)}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val && val !== config?.githubRemote) {
                  updateConfig({ githubRemote: val });
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
