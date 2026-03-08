/**
 * @module ui-change-analyzer
 * Analyzes diffs of UI files to determine whether changes are visual or structural.
 *
 * "Non-visual" changes are those that have no visual impact on the UI, such as:
 * - Comment-only changes (CSS/JS/JSX comments)
 * - Whitespace/formatting-only changes
 * - Import-only changes in .tsx/.jsx files
 * - Empty diffs (file renamed/moved with no content change)
 *
 * When all UI file changes are non-visual, the screenshot requirement can be
 * auto-bypassed, saving agents from uploading unnecessary screenshots.
 */

import { extname } from 'path';

export interface ChangeAnalysis {
  /** True if the change has no visual impact */
  nonVisual: boolean;
  /** Human-readable reason explaining why the change is/isn't visual */
  reason: string;
}

/** CSS/SCSS/LESS file extensions */
const CSS_EXTENSIONS = new Set(['.css', '.scss', '.less']);

/** JSX/TSX file extensions */
const JSX_EXTENSIONS = new Set(['.tsx', '.jsx']);

/**
 * Check if a diff line (stripped of the leading +/-) is a CSS comment line.
 * Covers: full-line comments, comment openers/closers, and mid-block comment lines.
 */
function isCssCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true; // blank lines are neutral
  // /* ... */ on one line, or just /* or */ or * continuation
  if (trimmed.startsWith('/*') || trimmed.startsWith('*/') || trimmed.startsWith('*')) return true;
  if (trimmed.startsWith('//')) return true;
  return false;
}

/**
 * Check if a diff line (stripped of the leading +/-) is a JS/TS import statement.
 */
function isImportLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true; // blank lines are neutral
  return trimmed.startsWith('import ') || trimmed.startsWith('import{')
    || trimmed.startsWith("from '") || trimmed.startsWith('from "')
    // Multi-line imports: lines that are just `} from '...'` or continuation
    || /^\}\s*from\s+['"]/.test(trimmed)
    // Lines that are part of a multi-line import: just identifiers with commas
    || /^[A-Za-z_$,\s{}]+$/.test(trimmed);
}

/**
 * Check if a diff line (stripped of the leading +/-) is a JS/TS/JSX comment.
 */
function isJsCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('/*') || trimmed.startsWith('*/') || trimmed.startsWith('*')) return true;
  return false;
}

/**
 * Parse a unified diff into per-file sections, extracting only the changed lines
 * (lines starting with + or -, excluding the diff header lines).
 */
function parseDiffChangedLines(diff: string): Array<{ file: string; added: string[]; removed: string[] }> {
  const files: Array<{ file: string; added: string[]; removed: string[] }> = [];
  const lines = diff.split('\n');
  let currentFile = '';
  let added: string[] = [];
  let removed: string[] = [];

  for (const line of lines) {
    // New file in diff: "diff --git a/path b/path"
    if (line.startsWith('diff --git ')) {
      if (currentFile) {
        files.push({ file: currentFile, added, removed });
      }
      // Extract the b/ path
      const match = line.match(/diff --git a\/.+ b\/(.+)/);
      currentFile = match ? match[1] : '';
      added = [];
      removed = [];
      continue;
    }
    // Skip diff metadata lines
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')
        || line.startsWith('index ') || line.startsWith('new file')
        || line.startsWith('deleted file') || line.startsWith('rename')
        || line.startsWith('similarity') || line.startsWith('old mode')
        || line.startsWith('new mode') || line.startsWith('Binary')) {
      continue;
    }
    // Changed lines
    if (line.startsWith('+')) {
      added.push(line.slice(1));
    } else if (line.startsWith('-')) {
      removed.push(line.slice(1));
    }
  }

  // Don't forget the last file
  if (currentFile) {
    files.push({ file: currentFile, added, removed });
  }

  return files;
}

/**
 * Analyze a single file's changes to determine if they're non-visual.
 */
function analyzeFileChanges(
  file: string,
  added: string[],
  removed: string[]
): ChangeAnalysis {
  const ext = extname(file).toLowerCase();

  // No actual changes — file rename/move or metadata-only
  if (added.length === 0 && removed.length === 0) {
    return { nonVisual: true, reason: 'file rename/move (no content change)' };
  }

  // CSS/SCSS/LESS files
  if (CSS_EXTENSIONS.has(ext)) {
    // Check: whitespace-only changes
    const addedContent = added.map(l => l.replace(/\s+/g, '').trim()).filter(l => l !== '');
    const removedContent = removed.map(l => l.replace(/\s+/g, '').trim()).filter(l => l !== '');

    if (addedContent.length === 0 && removedContent.length === 0) {
      return { nonVisual: true, reason: 'whitespace/formatting-only changes' };
    }

    // Check: comment-only changes
    const allAddedComments = added.every(l => isCssCommentLine(l));
    const allRemovedComments = removed.every(l => isCssCommentLine(l));

    if (allAddedComments && allRemovedComments) {
      return { nonVisual: true, reason: 'comment-only changes' };
    }

    // Check: whitespace normalization (same content after stripping whitespace)
    if (addedContent.length === removedContent.length
      && addedContent.every((line, i) => line === removedContent[i])) {
      return { nonVisual: true, reason: 'whitespace/formatting-only changes' };
    }

    return { nonVisual: false, reason: 'CSS property or selector changes detected' };
  }

  // TSX/JSX files
  if (JSX_EXTENSIONS.has(ext)) {
    // Check: import-only changes
    const allAddedImports = added.every(l => isImportLine(l));
    const allRemovedImports = removed.every(l => isImportLine(l));

    if (allAddedImports && allRemovedImports) {
      return { nonVisual: true, reason: 'import-only changes' };
    }

    // Check: comment-only changes
    const allAddedJsComments = added.every(l => isJsCommentLine(l));
    const allRemovedJsComments = removed.every(l => isJsCommentLine(l));

    if (allAddedJsComments && allRemovedJsComments) {
      return { nonVisual: true, reason: 'comment-only changes' };
    }

    // Check: whitespace-only
    const addedContent = added.map(l => l.replace(/\s+/g, '').trim()).filter(l => l !== '');
    const removedContent = removed.map(l => l.replace(/\s+/g, '').trim()).filter(l => l !== '');
    if (addedContent.length === 0 && removedContent.length === 0) {
      return { nonVisual: true, reason: 'whitespace/formatting-only changes' };
    }

    // Check: whitespace normalization (same content after stripping whitespace)
    if (addedContent.length === removedContent.length
      && addedContent.every((line, i) => line === removedContent[i])) {
      return { nonVisual: true, reason: 'whitespace/formatting-only changes' };
    }

    return { nonVisual: false, reason: 'component or markup changes detected' };
  }

  // HTML/Vue/Svelte — harder to analyze, be conservative
  // Check whitespace-only as a baseline
  const addedContent = added.map(l => l.replace(/\s+/g, '').trim()).filter(l => l !== '');
  const removedContent = removed.map(l => l.replace(/\s+/g, '').trim()).filter(l => l !== '');

  if (addedContent.length === 0 && removedContent.length === 0) {
    return { nonVisual: true, reason: 'whitespace/formatting-only changes' };
  }

  return { nonVisual: false, reason: 'visual changes detected' };
}

/**
 * Analyze a unified diff of UI files and determine if all changes are non-visual.
 *
 * Returns an overall analysis plus per-file details.
 */
export function analyzeUiDiff(diff: string): {
  allNonVisual: boolean;
  reason: string;
  fileAnalyses: Array<{ file: string } & ChangeAnalysis>;
} {
  if (!diff || diff.trim() === '') {
    return {
      allNonVisual: true,
      reason: 'empty diff (file rename/move only)',
      fileAnalyses: [],
    };
  }

  const fileChanges = parseDiffChangedLines(diff);
  const fileAnalyses = fileChanges.map(({ file, added, removed }) => ({
    file,
    ...analyzeFileChanges(file, added, removed),
  }));

  const allNonVisual = fileAnalyses.length > 0 && fileAnalyses.every(a => a.nonVisual);

  if (allNonVisual) {
    const reasons = Array.from(new Set(fileAnalyses.map(a => a.reason)));
    return {
      allNonVisual: true,
      reason: `auto-bypass: ${reasons.join(', ')}`,
      fileAnalyses,
    };
  }

  const visualFiles = fileAnalyses.filter(a => !a.nonVisual);
  return {
    allNonVisual: false,
    reason: `visual changes in: ${visualFiles.map(a => a.file).join(', ')}`,
    fileAnalyses,
  };
}

// Re-export for testing
export { parseDiffChangedLines, analyzeFileChanges, isCssCommentLine, isImportLine, isJsCommentLine };
