const GITHUB_URL = 'https://github.com/dmahan93/hermes-monitor';

export function ConfigView() {
  return (
    <div className="config-view">
      <div className="config-panel">
        <h2 className="config-heading">CONFIGURATION</h2>
        <div className="config-section">
          <h3 className="config-section-title">About</h3>
          <p className="config-text">
            Hermes Monitor — terminal grid, kanban board, and PR management for autonomous agents.
          </p>
          <p className="config-text">
            Configuration options will be added here as the project grows.
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
