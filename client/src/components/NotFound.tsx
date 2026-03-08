import { Link } from 'react-router-dom';
import './NotFound.css';

export function NotFound() {
  return (
    <div className="not-found">
      <h1 className="not-found-title">404</h1>
      <p className="not-found-message">Repo not found</p>
      <Link to="/" className="not-found-link">[← BACK TO REPOS]</Link>
    </div>
  );
}
