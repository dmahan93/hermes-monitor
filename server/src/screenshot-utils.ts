import { readdirSync } from 'fs';
import { join, extname } from 'path';
import { config } from './config.js';

/** Image file extensions accepted for screenshots */
export const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/**
 * Get uploaded screenshot filenames for an issue.
 * Returns an array of filenames (images only), or empty array if none exist.
 */
export function getUploadedScreenshots(issueId: string): string[] {
  const screenshotDir = join(config.screenshotBase, issueId);
  try {
    return readdirSync(screenshotDir).filter((f) => {
      const ext = extname(f).toLowerCase();
      return ALLOWED_EXTENSIONS.has(ext);
    });
  } catch {
    // Directory doesn't exist — no screenshots
    return [];
  }
}
