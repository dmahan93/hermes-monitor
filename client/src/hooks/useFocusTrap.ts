import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps keyboard focus within a container element.
 *
 * - On mount: saves the previously focused element, then focuses the first
 *   focusable child inside the container.
 * - While mounted: intercepts Tab / Shift+Tab so focus cycles within the
 *   container instead of escaping to elements behind an overlay.
 * - On unmount: restores focus to the previously focused element.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>) {
  // Persist the previously-focused element across renders without causing
  // re-renders (useRef, not useState).
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Remember where focus was before the trap activated
    previousFocusRef.current = document.activeElement;

    // Auto-focus the first focusable element inside the container
    const focusFirst = () => {
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    };

    // Small delay to let the DOM settle (React may still be committing)
    requestAnimationFrame(focusFirst);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

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
      document.removeEventListener('keydown', handleKeyDown);

      // Restore focus to the element that was focused before the trap
      const prev = previousFocusRef.current;
      if (prev && prev instanceof HTMLElement) {
        prev.focus();
      }
    };
  }, [containerRef]);
}
