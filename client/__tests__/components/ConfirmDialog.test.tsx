import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../../src/components/ConfirmDialog';

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const defaultProps = {
    open: true,
    title: 'Confirm Action',
    message: 'Are you sure?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { ...render(<ConfirmDialog {...defaultProps} />), props: defaultProps };
}

describe('ConfirmDialog', () => {
  it('renders nothing when open is false', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('renders dialog when open is true', () => {
    renderDialog();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('displays title and message', () => {
    renderDialog({ title: 'Delete Item', message: 'This cannot be undone.' });
    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('uses default button text', () => {
    renderDialog();
    expect(screen.getByText('[CONFIRM]')).toBeInTheDocument();
    expect(screen.getByText('[CANCEL]')).toBeInTheDocument();
  });

  it('uses custom button text', () => {
    renderDialog({ confirmText: '[DELETE]', cancelText: '[NOPE]' });
    expect(screen.getByText('[DELETE]')).toBeInTheDocument();
    expect(screen.getByText('[NOPE]')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByText('[CONFIRM]'));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button is clicked', () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByText('[CANCEL]'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when overlay is clicked', () => {
    const { props } = renderDialog();
    const overlay = screen.getByRole('alertdialog').parentElement!;
    fireEvent.click(overlay);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not call onCancel when dialog body is clicked', () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole('alertdialog'));
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when Escape key is pressed', () => {
    const { props } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('applies danger variant styling to title', () => {
    renderDialog({ variant: 'danger', title: 'DANGER' });
    const title = screen.getByText('DANGER');
    expect(title.className).toContain('confirm-title--danger');
  });

  it('applies warning variant styling to title', () => {
    renderDialog({ variant: 'warning', title: 'WARNING' });
    const title = screen.getByText('WARNING');
    expect(title.className).toContain('confirm-title--warning');
  });

  it('applies info variant styling to title', () => {
    renderDialog({ variant: 'info', title: 'INFO' });
    const title = screen.getByText('INFO');
    expect(title.className).toContain('confirm-title--info');
  });

  it('applies danger class to confirm button', () => {
    renderDialog({ variant: 'danger' });
    const btn = screen.getByText('[CONFIRM]');
    expect(btn.className).toContain('confirm-btn--danger');
  });

  it('applies warning class to confirm button', () => {
    renderDialog({ variant: 'warning' });
    const btn = screen.getByText('[CONFIRM]');
    expect(btn.className).toContain('confirm-btn--warning');
  });

  it('applies default confirm class for info variant', () => {
    renderDialog({ variant: 'info' });
    const btn = screen.getByText('[CONFIRM]');
    expect(btn.className).toContain('confirm-btn--confirm');
  });

  it('has proper ARIA attributes', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'confirm-dialog-message');
  });
});
