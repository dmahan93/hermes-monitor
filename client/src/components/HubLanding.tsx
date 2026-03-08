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
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // Fallback: if /api/repos doesn't exist, show a default entry
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
            <Link key={repo.id} to={`/${repo.id}`} className="hub-repo-card">
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
