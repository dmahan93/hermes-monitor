import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../config';
import './HubLanding.css';

interface RepoInfo {
  id: string;
  name: string;
  path: string;
  issueCount?: number;
  prCount?: number;
}

/**
 * Landing page showing a list of repos to manage.
 *
 * TODO: The /api/repos endpoint does not exist yet on the server.
 * This component is scaffolding for future multi-repo support.
 * Currently it always falls back to a single "default" entry.
 * When the endpoint is added, remove the fallback logic below.
 */
export function HubLanding() {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/repos`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch repos (${res.status})`);
        return res.json();
      })
      .then((data: RepoInfo[]) => {
        setRepos(data);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // TODO: Remove this fallback once /api/repos is implemented on the server.
        // For now, silently degrade to a single default repo entry.
        console.warn('HubLanding: /api/repos unavailable, using default fallback.', err.message);
        setRepos([{ id: 'default', name: 'default', path: '.' }]);
        setError(null);
        setLoading(false);
      });
    return () => controller.abort();
  }, []);

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
        <h1 className="hub-title">HERMES MONITOR</h1>
        <p className="hub-subtitle">Select a repository to manage</p>
      </header>
      <div className="hub-repos">
        {error && <div className="hub-error">{error}</div>}
        {repos.length === 0 ? (
          <div className="hub-empty">No repositories found.</div>
        ) : (
          repos.map((repo) => (
            <Link key={repo.id} to={`/${encodeURIComponent(repo.id)}`} className="hub-repo-card">
              <span className="hub-repo-icon">⎇</span>
              <div className="hub-repo-info">
                <span className="hub-repo-name">{repo.name}</span>
                <span className="hub-repo-path">{repo.path}</span>
              </div>
              <div className="hub-repo-stats">
                {repo.issueCount !== undefined && (
                  <span className="hub-repo-stat">{repo.issueCount} issues</span>
                )}
                {repo.prCount !== undefined && (
                  <span className="hub-repo-stat">{repo.prCount} PRs</span>
                )}
              </div>
              <span className="hub-repo-arrow">→</span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
