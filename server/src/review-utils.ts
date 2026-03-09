/**
 * @module review-utils
 * Shared utilities for parsing review feedback.
 */

/**
 * Extract action items from a review body.
 * Looks for bullet points (- or *) and numbered lists (1. 2. etc.).
 * Filters out VERDICT: lines that happen to be on bullet points.
 */
export function extractActionItems(body: string): string[] {
  const items: string[] = [];

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    // Match bullet points (- or *) and numbered lists (1. 2. etc.)
    const match = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)/);
    if (match) {
      // Skip VERDICT: lines — they're metadata, not action items
      if (/VERDICT:\s*(APPROVED|CHANGES_REQUESTED)/i.test(match[1])) {
        continue;
      }
      items.push(match[1].trim());
    }
  }

  return items;
}
