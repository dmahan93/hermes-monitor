import { useRef, useEffect } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './ConfirmDialog.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '[CONFIRM]',
  cancelText = '[CANCEL]',
  variant = 'info',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const confirmClass =
    variant === 'danger'
      ? 'confirm-btn confirm-btn--danger'
      : variant === 'warning'
        ? 'confirm-btn confirm-btn--warning'
        : 'confirm-btn confirm-btn--confirm';

  const titleClass =
    variant === 'danger'
      ? 'confirm-title confirm-title--danger'
      : variant === 'warning'
        ? 'confirm-title confirm-title--warning'
        : 'confirm-title confirm-title--info';

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="confirm-header">
          <span className={titleClass} id="confirm-dialog-title">
            {title}
          </span>
        </div>
        <div className="confirm-body">
          <div className="confirm-message" id="confirm-dialog-message">
            {message}
          </div>
          <div className="confirm-actions">
            <button
              className="confirm-btn confirm-btn--cancel"
              onClick={onCancel}
            >
              {cancelText}
            </button>
            <button className={confirmClass} onClick={onConfirm}>
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
