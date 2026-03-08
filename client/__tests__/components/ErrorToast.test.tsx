import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorToast } from '../../src/components/ErrorToast';

const makeError = (id: string, message: string) => ({
  id,
  message,
  timestamp: Date.now(),
});

describe('ErrorToast', () => {
  it('renders nothing when there are no errors', () => {
    const { container } = render(<ErrorToast errors={[]} onDismiss={() => {}} />);
    expect(container.querySelector('.error-toast-container')).toBeNull();
  });

  it('renders error messages', () => {
    const errors = [
      makeError('e1', 'Something failed'),
      makeError('e2', 'Another failure'),
    ];
    render(<ErrorToast errors={errors} onDismiss={() => {}} />);

    expect(screen.getByText('Something failed')).toBeInTheDocument();
    expect(screen.getByText('Another failure')).toBeInTheDocument();
  });

  it('calls onDismiss with correct id when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    const errors = [makeError('e1', 'Dismiss me')];

    render(<ErrorToast errors={errors} onDismiss={onDismiss} />);

    const dismissBtn = screen.getByLabelText('Dismiss error');
    fireEvent.click(dismissBtn);

    expect(onDismiss).toHaveBeenCalledWith('e1');
  });

  it('renders multiple dismiss buttons for multiple errors', () => {
    const errors = [
      makeError('e1', 'Error 1'),
      makeError('e2', 'Error 2'),
    ];
    render(<ErrorToast errors={errors} onDismiss={() => {}} />);

    const dismissBtns = screen.getAllByLabelText('Dismiss error');
    expect(dismissBtns).toHaveLength(2);
  });

  it('has the alert role on each individual toast for accessibility', () => {
    const errors = [
      makeError('e1', 'Alert error 1'),
      makeError('e2', 'Alert error 2'),
    ];
    render(<ErrorToast errors={errors} onDismiss={() => {}} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
  });

  it('does not put role=alert on the container', () => {
    const errors = [makeError('e1', 'Test error')];
    const { container } = render(<ErrorToast errors={errors} onDismiss={() => {}} />);

    const toastContainer = container.querySelector('.error-toast-container');
    expect(toastContainer).not.toBeNull();
    expect(toastContainer?.getAttribute('role')).toBeNull();
  });
});
