import type { ErrorEntry } from '../hooks/useErrorToast';
import './ErrorToast.css';

interface ErrorToastProps {
  errors: ErrorEntry[];
  onDismiss: (id: string) => void;
}

export function ErrorToast({ errors, onDismiss }: ErrorToastProps) {
  if (errors.length === 0) return null;

  return (
    <div className="error-toast-container">
      {errors.map((error) => (
        <div key={error.id} className="error-toast" role="alert">
          <span className="error-toast-message">{error.message}</span>
          <button
            className="error-toast-dismiss"
            onClick={() => onDismiss(error.id)}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
