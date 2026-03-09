/**
 * @module audible-alerts
 * Plays audible alert sounds when ticket status changes.
 * Uses terminal bell character (\x07) for a lightweight, dependency-free approach.
 * Different bell patterns distinguish transition types.
 */
import { config } from './config.js';
import type { IssueStatus } from '@hermes-monitor/shared/types';

/** Bell character — triggers an audible beep in most terminals. */
const BELL = '\x07';

/**
 * Categorize a status transition for choosing an alert pattern.
 * - 'positive': moving to done (task completed)
 * - 'alert': moving to review (needs attention)
 * - 'neutral': any other transition (e.g., backlog -> in_progress)
 */
export type AlertTone = 'positive' | 'alert' | 'neutral';

export function getAlertTone(from: IssueStatus, to: IssueStatus): AlertTone {
  if (to === 'done') return 'positive';
  if (to === 'review') return 'alert';
  return 'neutral';
}

/**
 * Play an audible alert for a status transition.
 * Uses different bell patterns per tone:
 * - positive (-> done): triple beep
 * - alert (-> review): double beep
 * - neutral (other): single beep
 *
 * Only plays when config.audibleAlerts is enabled.
 * Returns true if an alert was played, false if alerts are disabled or statuses are equal.
 */
export function playStatusAlert(from: IssueStatus, to: IssueStatus): boolean {
  if (!config.audibleAlerts) return false;
  if (from === to) return false;

  const tone = getAlertTone(from, to);

  switch (tone) {
    case 'positive':
      // Triple beep for completion
      process.stdout.write(BELL + BELL + BELL);
      break;
    case 'alert':
      // Double beep for review
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
