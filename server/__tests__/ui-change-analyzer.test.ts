import { describe, it, expect } from 'vitest';
import {
  analyzeUiDiff,
  parseDiffChangedLines,
  analyzeFileChanges,
  isCssCommentLine,
  isImportLine,
  isJsCommentLine,
} from '../src/ui-change-analyzer.js';

describe('isCssCommentLine', () => {
  it('recognizes CSS comment lines', () => {
    expect(isCssCommentLine('/* this is a comment */')).toBe(true);
    expect(isCssCommentLine('/* start of comment')).toBe(true);
    expect(isCssCommentLine('*/ end of comment')).toBe(true);
    expect(isCssCommentLine('* continuation')).toBe(true);
    expect(isCssCommentLine('// line comment')).toBe(true);
    expect(isCssCommentLine('  /* indented */')).toBe(true);
    expect(isCssCommentLine('')).toBe(true); // blank lines are neutral
  });

  it('rejects non-comment lines', () => {
    expect(isCssCommentLine('color: red;')).toBe(false);
    expect(isCssCommentLine('.class { }')).toBe(false);
    expect(isCssCommentLine('margin: 0;')).toBe(false);
  });
});

describe('isImportLine', () => {
  it('recognizes import statements', () => {
    expect(isImportLine("import React from 'react';")).toBe(true);
    expect(isImportLine("import { useState } from 'react';")).toBe(true);
    expect(isImportLine("import type { FC } from 'react';")).toBe(true);
    expect(isImportLine('')).toBe(true); // blank lines are neutral
  });

  it('recognizes multi-line import fragments', () => {
    expect(isImportLine("} from 'react';")).toBe(true);
    expect(isImportLine('  useState,')).toBe(true);
    expect(isImportLine('  useEffect,')).toBe(true);
  });

  it('rejects non-import lines', () => {
    expect(isImportLine('const x = 5;')).toBe(false);
    expect(isImportLine('return <div />;')).toBe(false);
    expect(isImportLine('function foo() {')).toBe(false);
  });
});

describe('isJsCommentLine', () => {
  it('recognizes JS comment lines', () => {
    expect(isJsCommentLine('// single line comment')).toBe(true);
    expect(isJsCommentLine('/* block comment */')).toBe(true);
    expect(isJsCommentLine('* JSDoc continuation')).toBe(true);
    expect(isJsCommentLine('')).toBe(true);
  });

  it('rejects non-comment lines', () => {
    expect(isJsCommentLine('const x = 5;')).toBe(false);
    expect(isJsCommentLine('return null;')).toBe(false);
  });
});

describe('parseDiffChangedLines', () => {
  it('parses a unified diff into per-file changes', () => {
    const diff = [
      'diff --git a/styles.css b/styles.css',
      'index abc1234..def5678 100644',
      '--- a/styles.css',
      '+++ b/styles.css',
      '@@ -1,3 +1,3 @@',
      ' .header {',
      '-  color: red;',
      '+  color: blue;',
      ' }',
    ].join('\n');

    const result = parseDiffChangedLines(diff);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('styles.css');
    expect(result[0].removed).toEqual(['  color: red;']);
    expect(result[0].added).toEqual(['  color: blue;']);
  });

  it('handles multiple files', () => {
    const diff = [
      'diff --git a/a.css b/a.css',
      '--- a/a.css',
      '+++ b/a.css',
      '@@ -1 +1 @@',
      '-/* old */',
      '+/* new */',
      'diff --git a/b.tsx b/b.tsx',
      '--- a/b.tsx',
      '+++ b/b.tsx',
      '@@ -1 +1 @@',
      "-import A from 'a';",
      "+import B from 'b';",
    ].join('\n');

    const result = parseDiffChangedLines(diff);
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe('a.css');
    expect(result[1].file).toBe('b.tsx');
  });

  it('handles empty diff', () => {
    const result = parseDiffChangedLines('');
    expect(result).toHaveLength(0);
  });
});

describe('analyzeFileChanges', () => {
  it('detects comment-only CSS changes as non-visual', () => {
    const result = analyzeFileChanges(
      'styles.css',
      ['/* updated comment */'],
      ['/* old comment */']
    );
    expect(result.nonVisual).toBe(true);
    expect(result.reason).toContain('comment');
  });

  it('detects whitespace-only CSS changes as non-visual', () => {
    const result = analyzeFileChanges(
      'styles.css',
      ['  .foo {  color: red;  }'],
      ['.foo { color: red; }']
    );
    expect(result.nonVisual).toBe(true);
    expect(result.reason).toContain('whitespace');
  });

  it('detects empty changes as non-visual (rename)', () => {
    const result = analyzeFileChanges('styles.css', [], []);
    expect(result.nonVisual).toBe(true);
    expect(result.reason).toContain('rename');
  });

  it('detects property changes as visual', () => {
    const result = analyzeFileChanges(
      'styles.css',
      ['  color: blue;'],
      ['  color: red;']
    );
    expect(result.nonVisual).toBe(false);
    expect(result.reason).toContain('CSS property');
  });

  it('detects new selector as visual', () => {
    const result = analyzeFileChanges(
      'styles.css',
      ['.new-class { color: red; }'],
      []
    );
    expect(result.nonVisual).toBe(false);
  });

  it('detects import-only TSX changes as non-visual', () => {
    const result = analyzeFileChanges(
      'App.tsx',
      ["import { Button } from './ui';"],
      ["import { Button } from './components';"]
    );
    expect(result.nonVisual).toBe(true);
    expect(result.reason).toContain('import');
  });

  it('detects comment-only TSX changes as non-visual', () => {
    const result = analyzeFileChanges(
      'App.tsx',
      ['// updated comment'],
      ['// old comment']
    );
    expect(result.nonVisual).toBe(true);
    expect(result.reason).toContain('comment');
  });

  it('detects JSX changes as visual', () => {
    const result = analyzeFileChanges(
      'App.tsx',
      ['  return <div className="new" />;'],
      ['  return <div className="old" />;']
    );
    expect(result.nonVisual).toBe(false);
    expect(result.reason).toContain('component');
  });

  it('detects whitespace-only TSX changes as non-visual', () => {
    const result = analyzeFileChanges(
      'App.tsx',
      ['   const x = 5;', ''],
      ['const x = 5;']
    );
    expect(result.nonVisual).toBe(true);
    expect(result.reason).toContain('whitespace');
  });

  it('handles SCSS files like CSS', () => {
    const result = analyzeFileChanges(
      'theme.scss',
      ['/* new comment */'],
      ['/* old comment */']
    );
    expect(result.nonVisual).toBe(true);
  });

  it('handles LESS files like CSS', () => {
    const result = analyzeFileChanges(
      'theme.less',
      [''],
      ['  ']
    );
    expect(result.nonVisual).toBe(true);
  });
});

describe('analyzeUiDiff', () => {
  it('returns non-visual for empty diff', () => {
    const result = analyzeUiDiff('');
    expect(result.allNonVisual).toBe(true);
    expect(result.reason).toContain('empty diff');
  });

  it('returns non-visual for comment-only CSS changes', () => {
    const diff = [
      'diff --git a/styles.css b/styles.css',
      '--- a/styles.css',
      '+++ b/styles.css',
      '@@ -1,2 +1,2 @@',
      '-/* old comment */',
      '+/* new comment */',
    ].join('\n');

    const result = analyzeUiDiff(diff);
    expect(result.allNonVisual).toBe(true);
    expect(result.reason).toContain('auto-bypass');
    expect(result.reason).toContain('comment');
  });

  it('returns non-visual for import-only TSX changes', () => {
    const diff = [
      'diff --git a/App.tsx b/App.tsx',
      '--- a/App.tsx',
      '+++ b/App.tsx',
      '@@ -1,2 +1,2 @@',
      "-import { old } from './old';",
      "+import { new_ } from './new';",
    ].join('\n');

    const result = analyzeUiDiff(diff);
    expect(result.allNonVisual).toBe(true);
    expect(result.reason).toContain('import');
  });

  it('returns visual when CSS properties change', () => {
    const diff = [
      'diff --git a/styles.css b/styles.css',
      '--- a/styles.css',
      '+++ b/styles.css',
      '@@ -1,3 +1,3 @@',
      ' .header {',
      '-  background: white;',
      '+  background: black;',
      ' }',
    ].join('\n');

    const result = analyzeUiDiff(diff);
    expect(result.allNonVisual).toBe(false);
    expect(result.reason).toContain('styles.css');
  });

  it('returns visual when any file has visual changes in a multi-file diff', () => {
    const diff = [
      'diff --git a/a.css b/a.css',
      '--- a/a.css',
      '+++ b/a.css',
      '@@ -1 +1 @@',
      '-/* comment */',
      '+/* updated */',
      'diff --git a/b.css b/b.css',
      '--- a/b.css',
      '+++ b/b.css',
      '@@ -1 +1 @@',
      '-  color: red;',
      '+  color: blue;',
    ].join('\n');

    const result = analyzeUiDiff(diff);
    expect(result.allNonVisual).toBe(false);
    expect(result.fileAnalyses[0].nonVisual).toBe(true);  // a.css - comment only
    expect(result.fileAnalyses[1].nonVisual).toBe(false);  // b.css - visual change
  });

  it('returns non-visual when all files in multi-file diff are non-visual', () => {
    const diff = [
      'diff --git a/a.css b/a.css',
      '--- a/a.css',
      '+++ b/a.css',
      '@@ -1 +1 @@',
      '-/* comment */',
      '+/* updated */',
      'diff --git a/b.tsx b/b.tsx',
      '--- a/b.tsx',
      '+++ b/b.tsx',
      '@@ -1 +1 @@',
      "-import A from 'a';",
      "+import B from 'b';",
    ].join('\n');

    const result = analyzeUiDiff(diff);
    expect(result.allNonVisual).toBe(true);
    expect(result.reason).toContain('auto-bypass');
  });

  it('provides per-file analysis', () => {
    const diff = [
      'diff --git a/styles.css b/styles.css',
      '--- a/styles.css',
      '+++ b/styles.css',
      '@@ -1 +1 @@',
      '-/* old */',
      '+/* new */',
    ].join('\n');

    const result = analyzeUiDiff(diff);
    expect(result.fileAnalyses).toHaveLength(1);
    expect(result.fileAnalyses[0].file).toBe('styles.css');
    expect(result.fileAnalyses[0].nonVisual).toBe(true);
    expect(result.fileAnalyses[0].reason).toContain('comment');
  });

  it('handles CSS file split (all whitespace/comment/rename changes)', () => {
    // Simulates a CSS file being split: original file removed, new files added
    // with the same content — the diff would show only removed/added lines that
    // are comments or whitespace
    const diff = [
      'diff --git a/main.css b/main.css',
      '--- a/main.css',
      '+++ b/main.css',
      '@@ -1,3 +1 @@',
      '-/* Header styles */',
      '-/* imported from header.css */',
      '-',
      '+/* See header.css and footer.css */',
    ].join('\n');

    const result = analyzeUiDiff(diff);
    expect(result.allNonVisual).toBe(true);
  });
});
