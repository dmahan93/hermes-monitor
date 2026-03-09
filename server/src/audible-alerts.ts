/**
 * @module audible-alerts
 * Plays audible alert sounds when ticket status changes.
 * Uses terminal bell character (\x07) for a lightweight, dependency-free approach.
 *
 * **Limitations:**
 * - Most terminal emulators coalesce rapid BEL characters into a single beep,
 *   so multi-bell patterns (double/triple) may sound identical to a single beep.
 * - The bell only works when the server runs in an interactive terminal.
 *   If running as a systemd service, in a container, or with stdout redirected,
 *   the bell character is silently lost or written into the pipe/log file.
 */
import { config } from './config.js';
import type { IssueStatus } from '@hermes-monitor/shared/types';

/** Bell character — triggers an audible beep in most terminals. */
const BELL = '\x07';

/**
 * Minimum interval (ms) between audible alerts.
 * Prevents rapid-fire beeps during batch operations (e.g. merging 20 PRs).
 */
const ALERT_DEBOUNCE_MS = 500;

/** Timestamp of the last alert that was actually played. */
let lastAlertTime = 0;

/**
 * Categorize a status transition for choosing an alert pattern.
 * - 'positive': moving to done (task completed)
 * - 'alert': moving to review (needs attention)
 * - 'negative': regression — moving from done/review back to an earlier status
 * - 'neutral': any other transition (e.g., backlog -> in_progress)
 */
export type AlertTone = 'positive' | 'alert' | 'negative' | 'neutral';

/** Status progression order for detecting regressions. */
const STATUS_ORDER: Record<IssueStatus, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  review: 3,
  done: 4,
};

export function getAlertTone(from: IssueStatus, to: IssueStatus): AlertTone {
  if (to === 'done') return 'positive';
  if (to === 'review') return 'alert';
  // Regression: moving backward from a later stage
  if (STATUS_ORDER[from] > STATUS_ORDER[to]) return 'negative';
  return 'neutral';
}

/**
 * Play an audible alert for a status transition.
 * Uses different bell patterns per tone:
 * - positive (-> done): triple beep
 * - alert (-> review): double beep
 * - negative (regression): double beep
 * - neutral (other): single beep
 *
 * Note: Most terminals coalesce rapid BEL characters into a single beep,
 * so multi-bell patterns may not produce distinct sounds in practice.
 *
 * Alerts are debounced: at most one alert per ALERT_DEBOUNCE_MS to avoid
 * rapid-fire beeps during batch operations.
 *
 * Only plays when config.audibleAlerts is enabled.
 * Returns true if an alert was played, false if alerts are disabled,
 * statuses are equal, or debounced.
 */
export function playStatusAlert(from: IssueStatus, to: IssueStatus): boolean {
  if (!config.audibleAlerts) return false;
  if (from === to) return false;

  const now = Date.now();
  if (now - lastAlertTime < ALERT_DEBOUNCE_MS) return false;
  lastAlertTime = now;

  const tone = getAlertTone(from, to);

  switch (tone) {
    case 'positive':
      // Triple beep for completion
      process.stdout.write(BELL + BELL + BELL);
      break;
    case 'alert':
    case 'negative':
      // Double beep for review or regression
      process.stdout.write(BELL + BELL);
      break;
    case 'neutral':
    default:
      // Single beep for other transitions
      process.stdout.write(BELL);
      break;
  }

  return true;
}

/**
 * Reset the debounce timer. Exported for testing only.
 * @internal
 */
export function _resetDebounce(): void {
  lastAlertTime = 0;
}
