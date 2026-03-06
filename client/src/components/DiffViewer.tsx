interface DiffViewerProps {
  diff: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
}

function parseDiff(diff: string): DiffLine[] {
  if (!diff) return [];
  return diff.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
      return { type: 'header' as const, content: line };
    }
    if (line.startsWith('@@')) {
      return { type: 'header' as const, content: line };
    }
    if (line.startsWith('+')) {
      return { type: 'add' as const, content: line };
    }
    if (line.startsWith('-')) {
      return { type: 'remove' as const, content: line };
    }
    return { type: 'context' as const, content: line };
  });
}

export function DiffViewer({ diff }: DiffViewerProps) {
  const lines = parseDiff(diff);

  if (!diff) {
    return (
      <div className="diff-viewer-empty">
        No changes detected.
      </div>
    );
  }

  return (
    <div className="diff-viewer">
      <pre className="diff-content">
        {lines.map((line, i) => (
          <div key={i} className={`diff-line diff-${line.type}`}>
            {line.content}
          </div>
        ))}
      </pre>
    </div>
  );
}
