import { useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { TerminalPane } from './TerminalPane';
import type { TerminalInfo, GridItem, ServerMessage } from '../types';

const ResponsiveGrid = WidthProvider(Responsive);

interface TerminalGridProps {
  terminals: TerminalInfo[];
  layout: GridItem[];
  onLayoutChange: (layout: GridItem[]) => void;
  send: (msg: any) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;
  onClose: (id: string) => void;
}

export function TerminalGrid({
  terminals,
  layout,
  onLayoutChange,
  send,
  subscribe,
  onClose,
}: TerminalGridProps) {
  const terminalMap = useMemo(() => {
    const map = new Map<string, TerminalInfo>();
    for (const t of terminals) map.set(t.id, t);
    return map;
  }, [terminals]);

  if (terminals.length === 0) {
    return (
      <div className="terminal-grid-empty">
        <div className="terminal-grid-empty-text">
          No terminals running.<br />
          Click <span className="accent">[+ ADD TERMINAL]</span> to spawn one.
        </div>
      </div>
    );
  }

  return (
    <ResponsiveGrid
      className="terminal-grid"
      layouts={{ lg: layout }}
      breakpoints={{ lg: 0 }}
      cols={{ lg: 12 }}
      rowHeight={80}
      margin={[2, 2]}
      containerPadding={[2, 2]}
      draggableHandle=".terminal-pane-drag-handle"
      onLayoutChange={(newLayout) => {
        onLayoutChange(
          newLayout.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))
        );
      }}
      isResizable={true}
      isDraggable={true}
      compactType="vertical"
    >
      {layout.map((item) => {
        const terminal = terminalMap.get(item.i);
        if (!terminal) return null;
        return (
          <div key={item.i}>
            <TerminalPane
              terminal={terminal}
              send={send}
              subscribe={subscribe}
              onClose={onClose}
            />
          </div>
        );
      })}
    </ResponsiveGrid>
  );
}
