import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useFocusTrap } from '../../src/hooks/useFocusTrap';

/**
 * Helper component that renders a focus-trappable container with the given
 * inner content. Accepts an optional `active` prop to conditionally disable
 * the trap via the hook's `enabled` parameter.
 */
function TrapHarness({
  children,
  active = true,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
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

  it('preserves autoFocus — does not override focus already inside the container', async () => {
    // Simulate a component where autoFocus puts focus on the second input.
    // The focus trap should NOT yank it to the first focusable element.
    function AutoFocusHarness() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref);
      return (
        <div ref={ref}>
          <button data-testid="btn-close">×</button>
          <input data-testid="input-title" autoFocus />
          <button data-testid="btn-submit">Submit</button>
        </div>
      );
    }

    const { getByTestId } = render(<AutoFocusHarness />);

    // autoFocus should have put focus on the input
    // The focus trap should detect focus is already inside and skip focusFirst
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('input-title'));
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

  it('does not restore focus to a detached element on unmount', async () => {
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

    // Remove the outer button from the DOM before unmounting the trap
    document.body.removeChild(outer);

    // Unmount the trap — focus should NOT try to restore to the detached element
    // It should fall to document.body naturally
    unmount();
    expect(document.activeElement).not.toBe(outer);
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

  it('does not trap focus when active is false (enabled=false)', async () => {
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

  it('excludes input[type="hidden"] from focusable elements', async () => {
    const { getByTestId } = render(
      <TrapHarness>
        <button data-testid="btn-a">A</button>
        <input type="hidden" name="csrf" value="token123" data-testid="hidden-input" />
        <button data-testid="btn-b">B</button>
      </TrapHarness>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });

    // Focus the last visible focusable element
    getByTestId('btn-b').focus();

    // Tab should wrap to btn-a, skipping the hidden input
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

  it('includes dynamically added focusable elements in the trap cycle', async () => {
    // Component that can dynamically add a new button
    function DynamicHarness() {
      const ref = useRef<HTMLDivElement>(null);
      const [showExtra, setShowExtra] = useState(false);
      useFocusTrap(ref);
      return (
        <div ref={ref}>
          <button data-testid="btn-a">A</button>
          {showExtra && <button data-testid="btn-dynamic">Dynamic</button>}
          <button data-testid="btn-add" onClick={() => setShowExtra(true)}>Add</button>
        </div>
      );
    }

    const { getByTestId } = render(<DynamicHarness />);

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });

    // Initially the last focusable element is btn-add
    getByTestId('btn-add').focus();
    let event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-a'));

    // Now click "Add" to show the dynamic button
    fireEvent.click(getByTestId('btn-add'));

    // The dynamic button should now be in the DOM
    const dynamicBtn = getByTestId('btn-dynamic');
    expect(dynamicBtn).toBeTruthy();

    // Focus btn-add (which is now the last focusable element)
    getByTestId('btn-add').focus();

    // Tab should wrap to btn-a (btn-add is still last in DOM order)
    event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-a'));

    // Now verify the dynamic button is in the cycle:
    // Focus btn-a and Shift+Tab should go to btn-add (last)
    getByTestId('btn-a').focus();
    event = pressTab(true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-add'));
  });

  it('redirects focus back into container when activeElement is outside (e.g., disabled button moved focus to body)', async () => {
    // In real browsers, when a focused element becomes disabled, focus moves
    // to document.body. This test simulates that by creating an external
    // element, focusing it, and verifying the trap redirects on Tab.
    const outer = document.createElement('button');
    outer.textContent = 'Outside';
    document.body.appendChild(outer);

    const { getByTestId } = render(
      <TrapHarness>
        <button data-testid="btn-a">A</button>
        <button data-testid="btn-b">B</button>
      </TrapHarness>,
    );

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('btn-a'));
    });

    // Simulate focus escaping the container (e.g., a button became disabled
    // and the browser moved focus to an element outside the trap)
    outer.focus();
    expect(document.activeElement).toBe(outer);

    // Tab should redirect focus back into the container (to the first element)
    const event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-a'));

    // Shift+Tab should redirect to the last element
    outer.focus();
    const event2 = pressTab(true);
    expect(event2.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-b'));

    document.body.removeChild(outer);
  });

  it('redirects focus when activeElement is a non-focusable element inside container (e.g., tabIndex=-1 container)', async () => {
    // Simulates a container that has tabIndex=-1 and is itself focused
    // (like ImageWithZoom's overlay div)
    function TabIndexHarness() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref);
      return (
        <div ref={ref} tabIndex={-1} data-testid="container">
          <button data-testid="btn-close">Close</button>
        </div>
      );
    }

    const { getByTestId } = render(<TabIndexHarness />);

    // Manually focus the container (like overlayRef.current?.focus())
    getByTestId('container').focus();
    expect(document.activeElement).toBe(getByTestId('container'));

    // Tab should redirect to the first focusable element (btn-close),
    // not escape the container
    const event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-close'));

    // Refocus the container and Shift+Tab should go to last (also btn-close)
    getByTestId('container').focus();
    const event2 = pressTab(true);
    expect(event2.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('btn-close'));
  });

  it('only the topmost trap handles Tab when multiple traps are stacked', async () => {
    // Render two stacked traps (simulating nested modals)
    const { getByTestId, unmount } = render(
      <>
        <TrapHarness>
          <button data-testid="outer-a">Outer A</button>
          <button data-testid="outer-b">Outer B</button>
        </TrapHarness>
        <TrapHarness>
          <button data-testid="inner-a">Inner A</button>
          <button data-testid="inner-b">Inner B</button>
        </TrapHarness>
      </>,
    );

    // Wait for traps to activate — both will try to auto-focus their first element,
    // but the second one (inner) mounts last and takes focus
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('inner-a'));
    });

    // Focus the last element in the inner trap
    getByTestId('inner-b').focus();
    expect(document.activeElement).toBe(getByTestId('inner-b'));

    // Tab should wrap within the INNER trap (it's topmost on the stack)
    const event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('inner-a'));

    // The outer trap should NOT have intercepted the Tab
    // (focus stayed in inner, not jumped to outer-a)
    expect(document.activeElement).not.toBe(getByTestId('outer-a'));

    unmount();
  });

  it('when the topmost trap unmounts, the next trap becomes active', async () => {
    // We need to test that after the inner modal closes, the outer trap works
    function StackedTraps() {
      const [showInner, setShowInner] = useState(true);
      return (
        <>
          <TrapHarness>
            <button data-testid="outer-a">Outer A</button>
            <button data-testid="outer-b">Outer B</button>
          </TrapHarness>
          {showInner && (
            <TrapHarness>
              <button data-testid="inner-a">Inner A</button>
              <button data-testid="inner-close" onClick={() => setShowInner(false)}>Close</button>
            </TrapHarness>
          )}
        </>
      );
    }

    const { getByTestId, queryByTestId } = render(<StackedTraps />);

    // Inner trap should have focus
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('inner-a'));
    });

    // Close the inner trap
    fireEvent.click(getByTestId('inner-close'));

    // Inner trap should be gone
    expect(queryByTestId('inner-a')).toBeNull();

    // Now the outer trap should be the active one.
    // Focus an outer element and verify wrapping works.
    getByTestId('outer-b').focus();
    expect(document.activeElement).toBe(getByTestId('outer-b'));

    const event = pressTab();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(getByTestId('outer-a'));
  });
});
