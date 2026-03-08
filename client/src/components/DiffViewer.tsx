import { useEffect, useMemo, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import './DiffViewer.css';

/** Stable ref with null current — avoids creating a new object each render
 *  when passing an inactive ref to useFocusTrap (inline mode). */
const NULL_REF: React.RefObject<HTMLElement | null> = { current: null };

interface DiffViewerProps {
  diff: string;
  sha?: string;
  file?: string;
  loading?: boolean;
  onClose?: () => void;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header' | 'meta';
  content: string;
  lineNum?: { old?: number; new?: number };
}

export function parseDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  const rawLines = raw.split('\n');
  // Remove trailing empty string from split (avoids phantom context line)
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  for (const line of rawLines) {
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      lines.push({ type: 'meta', content: line });
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (match) {
        oldLine = parseInt(match[1]);
        newLine = parseInt(match[2]);
        lines.push({ type: 'header', content: line });
      }
      continue;
    }

    if (line.startsWith('\\')) {
      // "\ No newline at end of file" — render as meta annotation
      lines.push({ type: 'meta', content: line });
    } else if (line.startsWith('+')) {
      lines.push({
        type: 'add',
        content: line.slice(1),
        lineNum: { new: newLine },
      });
      newLine++;
    } else if (line.startsWith('-')) {
      lines.push({
        type: 'remove',
        content: line.slice(1),
        lineNum: { old: oldLine },
      });
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      lines.push({
        type: 'context',
        content: line.slice(1) || '',
        lineNum: { old: oldLine, new: newLine },
      });
      oldLine++;
      newLine++;
    }
  }

  return lines;
}

function DiffTable({ diff, loading }: { diff: string; loading?: boolean }) {
  const parsed = useMemo(() => parseDiff(diff), [diff]);

  if (loading) {
    return <div className="diff-loading">loading diff...</div>;
  }

  if (!diff || parsed.length === 0) {
    return <div className="diff-viewer-empty">No changes detected.</div>;
  }

  return (
    <table className="diff-table">
      <tbody>
        {parsed.map((line, i) => (
          <tr key={i} className={`diff-line diff-line-${line.type}`}>
            <td className="diff-gutter diff-gutter-old">
              {line.lineNum?.old ?? ''}
            </td>
            <td className="diff-gutter diff-gutter-new">
              {line.lineNum?.new ?? ''}
            </td>
            <td className="diff-content">
              {line.type === 'add' && <span className="diff-sign">+</span>}
              {line.type === 'remove' && <span className="diff-sign">−</span>}
              {line.type === 'header' && <span className="diff-sign">@@</span>}
              <span className="diff-text">{line.content}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DiffViewer({ diff, sha, file, loading, onClose }: DiffViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  // Only trap focus when in overlay mode (onClose is provided).
  // Uses a module-level NULL_REF to avoid object allocation churn every render.
  useFocusTrap(onClose ? viewerRef : NULL_REF);

  // Close on Escape key (overlay mode only)
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Inline mode (used by PRDetail): no overlay, just render the table
  if (!onClose) {
    return (
      <div className="diff-body diff-inline">
        <DiffTable diff={diff} loading={loading} />
      </div>
    );
  }

  // Overlay mode (used by GitGraph): full modal with header
  const fileName = file ? (file.split('/').pop() || file) : '';
  const dirPath = file && file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';

  return (
    <div className="diff-overlay" onClick={onClose}>
      <div className="diff-viewer" ref={viewerRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="diff-viewer-title">
        <div className="diff-header">
          <div className="diff-header-info">
            <span id="diff-viewer-title" className="diff-header-path">
              {dirPath && <span className="diff-header-dir">{dirPath}</span>}
              {fileName}
            </span>
            {sha && <span className="diff-header-sha">{sha.slice(0, 8)}</span>}
          </div>
          <button className="diff-header-close" onClick={onClose}>✕</button>
        </div>
        <div className="diff-body">
          <DiffTable diff={diff} loading={loading} />
        </div>
      </div>
    </div>
  );
}
