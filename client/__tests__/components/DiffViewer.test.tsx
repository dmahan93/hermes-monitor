import { describe, it, expect } from 'vitest';
import { parseDiff } from '../../src/components/DiffViewer';

describe('parseDiff', () => {
  it('returns empty array for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('parses a simple unified diff with adds and removes', () => {
    const diff = [
      'diff --git a/file.ts b/file.ts',
      'index abc..def 100644',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,3 +1,4 @@',
      ' line one',
      '-old line',
      '+new line',
      '+added line',
      ' line three',
    ].join('\n');

    const lines = parseDiff(diff);

    // Meta lines: diff, index, ---, +++
    const metas = lines.filter(l => l.type === 'meta');
    expect(metas).toHaveLength(4);

    // Header line: @@
    const headers = lines.filter(l => l.type === 'header');
    expect(headers).toHaveLength(1);

    // Context lines
    const contexts = lines.filter(l => l.type === 'context');
    expect(contexts).toHaveLength(2);
    expect(contexts[0].lineNum).toEqual({ old: 1, new: 1 });

    // Added lines
    const adds = lines.filter(l => l.type === 'add');
    expect(adds).toHaveLength(2);
    expect(adds[0].content).toBe('new line');
    expect(adds[0].lineNum).toEqual({ new: 2 });

    // Removed lines
    const removes = lines.filter(l => l.type === 'remove');
    expect(removes).toHaveLength(1);
    expect(removes[0].content).toBe('old line');
    expect(removes[0].lineNum).toEqual({ old: 2 });
  });

  it('tracks line numbers correctly across hunks', () => {
    const diff = [
      '@@ -10,3 +10,3 @@',
      ' context',
      '-removed',
      '+added',
      ' context',
    ].join('\n');

    const lines = parseDiff(diff);
    const contextLines = lines.filter(l => l.type === 'context');
    expect(contextLines[0].lineNum).toEqual({ old: 10, new: 10 });
    expect(contextLines[1].lineNum).toEqual({ old: 12, new: 12 });
  });

  it('handles "\\ No newline at end of file" annotation', () => {
    const diff = [
      '@@ -1,2 +1,2 @@',
      '-old line',
      '\\ No newline at end of file',
      '+new line',
    ].join('\n');

    const lines = parseDiff(diff);

    const metaLines = lines.filter(l => l.type === 'meta');
    expect(metaLines).toHaveLength(1);
    expect(metaLines[0].content).toBe('\\ No newline at end of file');

    // The backslash line should NOT increment line numbers
    const adds = lines.filter(l => l.type === 'add');
    expect(adds[0].lineNum).toEqual({ new: 1 });
  });

  it('strips trailing empty line from split to avoid phantom context', () => {
    // A diff that ends with a newline will produce a trailing '' from split
    const diff = '@@ -1,1 +1,1 @@\n-old\n+new\n';

    const lines = parseDiff(diff);
    const contexts = lines.filter(l => l.type === 'context');
    // Should have no context lines — the trailing newline should be stripped
    expect(contexts).toHaveLength(0);
  });

  it('handles multiple hunks', () => {
    const diff = [
      '@@ -1,2 +1,2 @@',
      ' first',
      '-old1',
      '+new1',
      '@@ -10,2 +10,2 @@',
      ' tenth',
      '-old10',
      '+new10',
    ].join('\n');

    const lines = parseDiff(diff);
    const headers = lines.filter(l => l.type === 'header');
    expect(headers).toHaveLength(2);

    const adds = lines.filter(l => l.type === 'add');
    expect(adds).toHaveLength(2);
    // After the context line "tenth" at line 10/10, the add is at new line 11
    expect(adds[1].lineNum).toEqual({ new: 11 });
  });

  it('slices the +/- prefix from content', () => {
    const diff = [
      '@@ -1,1 +1,2 @@',
      '+added content here',
      '-removed content here',
    ].join('\n');

    const lines = parseDiff(diff);
    const add = lines.find(l => l.type === 'add');
    const remove = lines.find(l => l.type === 'remove');
    expect(add?.content).toBe('added content here');
    expect(remove?.content).toBe('removed content here');
  });
});
