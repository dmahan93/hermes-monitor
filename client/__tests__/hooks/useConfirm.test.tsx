import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useConfirm } from '../../src/hooks/useConfirm';
import { useState } from 'react';

function TestHarness() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [result, setResult] = useState<string>('none');

  const handleClick = async () => {
    const ok = await confirm({
      title: 'Test Title',
      message: 'Test message',
      confirmText: '[YES]',
      cancelText: '[NO]',
      variant: 'danger',
    });
    setResult(ok ? 'confirmed' : 'cancelled');
  };

  return (
    <div>
      <button onClick={handleClick}>Open Dialog</button>
      <span data-testid="result">{result}</span>
      {ConfirmDialogElement}
    </div>
  );
}

describe('useConfirm', () => {
  it('initially shows no dialog', () => {
    render(<TestHarness />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows dialog when confirm is called', async () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByText('Open Dialog'));
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('resolves true when user confirms', async () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByText('Open Dialog'));
    await waitFor(() => {
      expect(screen.getByText('[YES]')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('[YES]'));
    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('confirmed');
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves false when user cancels', async () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByText('Open Dialog'));
    await waitFor(() => {
      expect(screen.getByText('[NO]')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('[NO]'));
    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('cancelled');
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves false when Escape is pressed', async () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByText('Open Dialog'));
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('cancelled');
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resolves false when overlay is clicked', async () => {
    render(<TestHarness />);
    fireEvent.click(screen.getByText('Open Dialog'));
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
    // Click the overlay (parent of alertdialog)
    const overlay = screen.getByRole('alertdialog').parentElement!;
    fireEvent.click(overlay);
    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('cancelled');
    });
  });

  it('cancels previous dialog when a new one is opened', async () => {
    // This tests the edge case where confirm() is called again before the first resolves
    function DoubleConfirmHarness() {
      const { confirm, ConfirmDialogElement } = useConfirm();
      const [results, setResults] = useState<string[]>([]);

      const handleFirst = async () => {
        const ok = await confirm({ title: 'First', message: 'First dialog' });
        setResults((prev) => [...prev, ok ? 'first-confirmed' : 'first-cancelled']);
      };

      const handleSecond = async () => {
        const ok = await confirm({ title: 'Second', message: 'Second dialog' });
        setResults((prev) => [...prev, ok ? 'second-confirmed' : 'second-cancelled']);
      };

      return (
        <div>
          <button onClick={handleFirst}>First</button>
          <button onClick={handleSecond}>Second</button>
          <span data-testid="results">{results.join(',')}</span>
          {ConfirmDialogElement}
        </div>
      );
    }

    render(<DoubleConfirmHarness />);
    // Open first dialog
    fireEvent.click(screen.getByText('First'));
    await waitFor(() => {
      expect(screen.getByText('First dialog')).toBeInTheDocument();
    });

    // Open second dialog (should cancel first)
    fireEvent.click(screen.getByText('Second'));
    await waitFor(() => {
      expect(screen.getByText('Second dialog')).toBeInTheDocument();
    });

    // First should have been cancelled
    await waitFor(() => {
      expect(screen.getByTestId('results')).toHaveTextContent('first-cancelled');
    });
  });
});
