import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Module-level stack of active focus trap containers.
 * Only the topmost (last) trap in the stack handles Tab key events.
 * This prevents conflicts when multiple modals/overlays are open simultaneously.
 */
const trapStack: HTMLElement[] = [];

/**
 * Traps keyboard focus within a container element.
 *
 * - On mount: saves the previously focused element, then focuses the first
 *   focusable child inside the container (unless focus is already inside it,
 *   preserving autoFocus behavior on child elements).
 * - While mounted: intercepts Tab / Shift+Tab so focus cycles within the
 *   container instead of escaping to elements behind an overlay.
 *   When multiple traps are active, only the topmost trap handles Tab.
 * - On unmount: restores focus to the previously focused element.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>) {
  // Persist the previously-focused element across renders without causing
  // re-renders (useRef, not useState).
  const previousFocusRef = useRef<Element | null>(null);

  // The containerRef is intentionally in the dependency array to support
  // conditional activation patterns (e.g., DiffViewer passing a stable nullRef
  // when inactive). Callers must ensure the ref object identity is stable when
  // the trap should remain active — use useRef, not inline object literals.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Remember where focus was before the trap activated
    previousFocusRef.current = document.activeElement;

    // Register this container in the trap stack
    trapStack.push(container);

    // Auto-focus the first focusable element inside the container,
    // but only if focus isn't already inside it. This preserves autoFocus
    // on child inputs (e.g., the title field in NewIssueModal).
    const focusFirst = () => {
      if (container.contains(document.activeElement)) return;
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    };

    // Small delay to let the DOM settle (React may still be committing).
    // Store the ID so we can cancel if the component unmounts before it fires.
    const rafId = requestAnimationFrame(focusFirst);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      // Only the topmost trap in the stack should handle Tab events.
      // If this container is not the topmost, bail out.
      if (trapStack[trapStack.length - 1] !== container) return;

      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', handleKeyDown);

      // Remove this container from the trap stack
      const idx = trapStack.indexOf(container);
      if (idx !== -1) {
        trapStack.splice(idx, 1);
      }

      // Restore focus to the element that was focused before the trap
      const prev = previousFocusRef.current;
      if (prev && prev instanceof HTMLElement) {
        prev.focus();
      }
    };
  }, [containerRef]);
}
