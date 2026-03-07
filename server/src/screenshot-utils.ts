import { readdirSync } from 'fs';
import { join, extname } from 'path';
import { config } from './config.js';

/** Image file extensions accepted for screenshots */
export const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/** UI file extensions that warrant screenshot requirements */
export const UI_EXTENSIONS = ['.tsx', '.jsx', '.css', '.scss', '.less', '.html', '.vue', '.svelte'];

export interface ScreenshotInfo {
  filename: string;
  url: string;
}

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

/**
 * Get screenshot info (filename + relative URL) for an issue.
 * Consolidates the filename-to-URL mapping in one place.
 */
export function getScreenshotInfos(issueId: string): ScreenshotInfo[] {
  const files = getUploadedScreenshots(issueId);
  return files.map((f) => ({
    filename: f,
    url: `/screenshots/${issueId}/${f}`,
  }));
}

/**
 * Enrich a PR object with screenshot data for API/WS responses.
 * Adds `screenshots` (ScreenshotInfo[]) and `screenshotCount` fields.
 */
export function enrichPRWithScreenshots<T extends { issueId: string }>(
  pr: T
): T & { screenshots: ScreenshotInfo[]; screenshotCount: number } {
  const screenshots = getScreenshotInfos(pr.issueId);
  return { ...pr, screenshots, screenshotCount: screenshots.length };
}

/**
 * Build the screenshot section for a review context.md file.
 *
 * Three code paths:
 * 1. Screenshots present → embed markdown images
 * 2. No screenshots + UI files changed → warning to request screenshots
 * 3. No screenshots + no UI files → informational "not needed" message
 */
export function buildScreenshotSection(
  issueId: string,
  changedFiles: string[],
  port: string | number = '4000'
): string[] {
  const screenshotFiles = getUploadedScreenshots(issueId);
  const screenshotUrls = screenshotFiles.map(
    (f) => `http://localhost:${port}/screenshots/${issueId}/${f}`
  );

  const section: string[] = [];

  if (screenshotUrls.length > 0) {
    section.push(
      '## Screenshots',
      `${screenshotUrls.length} screenshot(s) uploaded for this PR:`,
      '',
      ...screenshotUrls.map((url, i) => {
        const filename = screenshotFiles[i];
        const label = filename
          .replace(/\.[^.]+$/, '')
          .replace(/[-_][a-f0-9]{8}$/, '')
          .replace(/[-_]/g, ' ');
        return `- ![${label}](${url})`;
      }),
      '',
      'Review the screenshots to verify the visual changes look correct.',
      'If something looks wrong in the screenshots, flag it in your review.',
    );
  } else {
    const hasUiFiles = changedFiles.some((f) =>
      UI_EXTENSIONS.some((ext) => f.endsWith(ext))
    );
    if (hasUiFiles) {
      section.push(
        '## Screenshots',
        '⚠ WARNING: This PR modifies UI files but NO screenshots were uploaded.',
        'UI files changed: ' +
          changedFiles
            .filter((f) => UI_EXTENSIONS.some((ext) => f.endsWith(ext)))
            .join(', '),
        '',
        'Flag this in your review and request screenshots with VERDICT: CHANGES_REQUESTED.',
      );
    } else {
      section.push(
        '## Screenshots',
        'No screenshots uploaded (no UI files changed — this is expected).',
      );
    }
  }

  return section;
}
