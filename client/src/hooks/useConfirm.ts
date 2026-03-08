import { useState, useCallback, useRef, createElement } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Hook that provides a themed confirm dialog as a replacement for window.confirm().
 *
 * Usage:
 *   const { confirm, ConfirmDialogElement } = useConfirm();
 *   const ok = await confirm({ title: 'Delete?', message: 'Are you sure?', variant: 'danger' });
 *   if (ok) { doDelete(); }
 *   // Render ConfirmDialogElement somewhere in JSX:
 *   return <div>...{ConfirmDialogElement}</div>;
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const stateRef = useRef<ConfirmState | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    // If there's already an open dialog, resolve it as cancelled
    if (stateRef.current) {
      stateRef.current.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      const newState = { ...options, resolve };
      stateRef.current = newState;
      setState(newState);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (stateRef.current) {
      stateRef.current.resolve(true);
      stateRef.current = null;
    }
    setState(null);
  }, []);

  const handleCancel = useCallback(() => {
    if (stateRef.current) {
      stateRef.current.resolve(false);
      stateRef.current = null;
    }
    setState(null);
  }, []);

  const ConfirmDialogElement = createElement(ConfirmDialog, {
    open: state !== null,
    title: state?.title ?? '',
    message: state?.message ?? '',
    confirmText: state?.confirmText,
    cancelText: state?.cancelText,
    variant: state?.variant,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  });

  return { confirm, ConfirmDialogElement };
}
