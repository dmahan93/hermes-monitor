import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from '../../src/hooks/useFocusTrap';

/**
 * Helper component that renders a focus-trappable container with the given
 * inner content. Accepts an optional `active` prop to conditionally disable
 * the trap (mirrors how DiffViewer uses it).
 */
function TrapHarness({
  children,
  active = true,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(active ? ref : { current: null });
  return <div ref={ref}>{children}</div>;
}

/**
 * Fires a real keydown event on `document` for Tab or Shift+Tab.
 * Returns the event so tests can check `defaultPrevented`.
 */
function pressTab(shift = false) {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

describe('useFocusTrap', () => {
  it('auto-focuses the first focusable element on mount', async () => {
    const { getByTestId } = render(
      <TrapHarness>
        <button data-testid="btn-a">A</button>
        <button data-testid="btn-b">B</button>
      </TrapHarness>,
    );

    // useFocusTrap uses requestAnimationFrame, so we need to flush it
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });
  });

  it('wraps focus from last to first on Tab', async () => {
    const { getByTestId } = render(
      <TrapHarness>
        <button data-testid="btn-a">A</button>
        <button data-testid="btn-b">B</button>
        <button data-testid="btn-c">C</button>
      </TrapHarness>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });

    // Focus the last element manually
    getByTestId('btn-c').focus();
    expect(document.activeElement).toBe(getByTestId('btn-c'));

    // Press Tab — should wrap to first
    const event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-a'));
  });

  it('wraps focus from first to last on Shift+Tab', async () => {
    const { getByTestId } = render(
      <TrapHarness>
        <button data-testid="btn-a">A</button>
        <button data-testid="btn-b">B</button>
        <button data-testid="btn-c">C</button>
      </TrapHarness>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });

    // Press Shift+Tab on first — should wrap to last
    const event = pressTab(true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-c'));
  });

  it('does not prevent default for Tab in the middle of the list', async () => {
    const { getByTestId } = render(
      <TrapHarness>
        <button data-testid="btn-a">A</button>
        <button data-testid="btn-b">B</button>
        <button data-testid="btn-c">C</button>
      </TrapHarness>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });

    // Focus the middle element
    getByTestId('btn-b').focus();

    // Tab should NOT be prevented (natural browser behavior handles it)
    const event = pressTab();
    expect(event.defaultPrevented).toBe(false);
  });

  it('restores focus to the previously focused element on unmount', async () => {
    // Create an external button and focus it before the trap mounts
    const outer = document.createElement('button');
    outer.textContent = 'Outside';
    document.body.appendChild(outer);
    outer.focus();
    expect(document.activeElement).toBe(outer);

    const { getByTestId, unmount } = render(
      <TrapHarness>
        <button data-testid="btn-a">A</button>
      </TrapHarness>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });

    // Unmount the trap — focus should return to the outer button
    unmount();
    expect(document.activeElement).toBe(outer);

    document.body.removeChild(outer);
  });

  it('handles a container with no focusable elements gracefully', async () => {
    const { container } = render(
      <TrapHarness>
        <span>No focusable content here</span>
      </TrapHarness>,
    );

    // Should not throw; Tab presses should be harmless
    pressTab();
    pressTab(true);

    // Just verify the content rendered
    expect(container.textContent).toContain('No focusable content here');
  });

  it('does not trap focus when active is false (container ref is null)', async () => {
    const outer = document.createElement('button');
    outer.textContent = 'Outside';
    document.body.appendChild(outer);
    outer.focus();

    render(
      <TrapHarness active={false}>
        <button data-testid="btn-a">A</button>
      </TrapHarness>,
    );

    // Focus should remain on the outer button since the trap is inactive
    // (requestAnimationFrame won't trigger auto-focus because container is null)
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).toBe(outer);

    document.body.removeChild(outer);
  });

  it('skips disabled and tabindex="-1" elements', async () => {
    const { getByTestId } = render(
      <TrapHarness>
        <button data-testid="btn-a">A</button>
        <button disabled data-testid="btn-disabled">Disabled</button>
        <button tabIndex={-1} data-testid="btn-hidden">Hidden from tab order</button>
        <button data-testid="btn-b">B</button>
      </TrapHarness>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });

    // Focus last focusable element (btn-b, since disabled and tabindex=-1 are skipped)
    getByTestId('btn-b').focus();
    expect(document.activeElement).toBe(getByTestId('btn-b'));

    // Tab should wrap to btn-a (not to disabled or tabindex=-1)
    const event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-a'));
  });

  it('handles various focusable element types', async () => {
    const { getByTestId } = render(
      <TrapHarness>
        <input data-testid="input" type="text" />
        <textarea data-testid="textarea" />
        <select data-testid="select"><option>opt</option></select>
        <a href="#" data-testid="link">Link</a>
        <button data-testid="btn">Button</button>
      </TrapHarness>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('input'));
    });

    // Focus the last element (button)
    getByTestId('btn').focus();

    // Tab should wrap back to input
    const event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('input'));
  });

  it('ignores non-Tab key events', async () => {
    const { getByTestId } = render(
      <TrapHarness>
        <button data-testid="btn-a">A</button>
        <button data-testid="btn-b">B</button>
      </TrapHarness>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });

    // Press Enter — should not affect focus
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    expect(document.activeElement).toBe(getByTestId('btn-a'));
  });
});
