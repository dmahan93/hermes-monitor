import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { config } from '../src/config.js';
import {
  getUploadedScreenshots,
  getScreenshotInfos,
  enrichPRWithScreenshots,
  buildScreenshotSection,
} from '../src/screenshot-utils.js';

describe('buildScreenshotSection', () => {
  let screenshotDir: string;
  const issueId = 'test-screenshot-section';

  afterEach(() => {
    if (screenshotDir) {
      try { rmSync(screenshotDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('embeds markdown images when screenshots are present', () => {
    screenshotDir = join(config.screenshotBase, issueId);
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, 'before-abc12345.png'), 'fake');
    writeFileSync(join(screenshotDir, 'after-changes.jpg'), 'fake');

    const section = buildScreenshotSection(issueId, ['file.ts'], '4000');

    expect(section[0]).toBe('## Screenshots');
    expect(section[1]).toContain('2 screenshot(s) uploaded');

    // Should contain markdown image syntax with full localhost URLs
    const sectionText = section.join('\n');
    expect(sectionText).toContain('![');
    expect(sectionText).toContain(`http://localhost:4000/screenshots/${issueId}/`);
    expect(sectionText).toContain('Review the screenshots to verify');
  });

  it('generates readable labels from filenames (strips extension, hash suffix, underscores)', () => {
    screenshotDir = join(config.screenshotBase, issueId);
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, 'dark-mode_toggle-a1b2c3d4.png'), 'fake');

    const section = buildScreenshotSection(issueId, [], '4000');
    const sectionText = section.join('\n');

    // Label should strip .png, strip -a1b2c3d4 hash, replace [-_] with spaces
    expect(sectionText).toContain('![dark mode toggle]');
  });

  it('warns when UI files changed but no screenshots uploaded', () => {
    // No screenshot directory = no screenshots
    const section = buildScreenshotSection(
      'nonexistent-issue-id',
      ['src/App.tsx', 'src/styles.css', 'server/index.ts'],
      '4000'
    );

    expect(section[0]).toBe('## Screenshots');
    expect(section[1]).toContain('WARNING');
    expect(section[1]).toContain('NO screenshots were uploaded');

    const sectionText = section.join('\n');
    // Should list only the UI files, not server/index.ts
    expect(sectionText).toContain('src/App.tsx');
    expect(sectionText).toContain('src/styles.css');
    expect(sectionText).not.toContain('server/index.ts');
    expect(sectionText).toContain('CHANGES_REQUESTED');
  });

  it('shows informational message when no UI files and no screenshots', () => {
    const section = buildScreenshotSection(
      'nonexistent-issue-id',
      ['server/index.ts', 'utils/helpers.ts'],
      '4000'
    );

    expect(section[0]).toBe('## Screenshots');
    expect(section[1]).toContain('No screenshots uploaded');
    expect(section[1]).toContain('no UI files changed');
    expect(section[1]).toContain('this is expected');
  });

  it('uses the provided port in screenshot URLs', () => {
    screenshotDir = join(config.screenshotBase, issueId);
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, 'shot.png'), 'fake');

    const section = buildScreenshotSection(issueId, [], '5555');
    const sectionText = section.join('\n');
    expect(sectionText).toContain('http://localhost:5555/screenshots/');
  });
});

describe('getScreenshotInfos', () => {
  let screenshotDir: string;
  const issueId = 'test-screenshot-infos';

  afterEach(() => {
    if (screenshotDir) {
      try { rmSync(screenshotDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('returns ScreenshotInfo[] with relative URLs', () => {
    screenshotDir = join(config.screenshotBase, issueId);
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, 'photo.png'), 'fake');

    const infos = getScreenshotInfos(issueId);
    expect(infos).toHaveLength(1);
    expect(infos[0].filename).toBe('photo.png');
    expect(infos[0].url).toBe(`/screenshots/${issueId}/photo.png`);
  });

  it('returns empty array when no screenshots exist', () => {
    const infos = getScreenshotInfos('nonexistent-issue');
    expect(infos).toEqual([]);
  });
});

describe('enrichPRWithScreenshots', () => {
  let screenshotDir: string;
  const issueId = 'test-enrich-pr';

  afterEach(() => {
    if (screenshotDir) {
      try { rmSync(screenshotDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('adds screenshots and screenshotCount to a PR-like object', () => {
    screenshotDir = join(config.screenshotBase, issueId);
    mkdirSync(screenshotDir, { recursive: true });
    writeFileSync(join(screenshotDir, 'a.png'), 'fake');
    writeFileSync(join(screenshotDir, 'b.jpg'), 'fake');

    const pr = { id: 'pr-1', issueId, title: 'Test' };
    const enriched = enrichPRWithScreenshots(pr);

    expect(enriched.id).toBe('pr-1');
    expect(enriched.title).toBe('Test');
    expect(enriched.screenshotCount).toBe(2);
    expect(enriched.screenshots).toHaveLength(2);
    expect(enriched.screenshots[0].url).toContain(`/screenshots/${issueId}/`);
  });

  it('adds screenshotCount=0 when no screenshots exist', () => {
    const pr = { id: 'pr-2', issueId: 'nonexistent', title: 'No Shots' };
    const enriched = enrichPRWithScreenshots(pr);

    expect(enriched.screenshotCount).toBe(0);
    expect(enriched.screenshots).toEqual([]);
  });
});
