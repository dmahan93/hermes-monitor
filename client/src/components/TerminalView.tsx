import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ServerMessage } from '../types';
import '@xterm/xterm/css/xterm.css';
import './TerminalView.css';

interface TerminalViewProps {
  terminalId: string;
  send: (msg: any) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;
  onResize?: (cols: number, rows: number) => void;
  /** Incremented by useWebSocket on each reconnect; triggers scrollback replay */
  reconnectCount?: number;
}

// Match the CSS clamp: clamp(12px, calc(8px + 0.278vw), 18px)
// Returns a scaled font size (base 13px at 1440w, ~19px at 4K)
function getTerminalFontSize(base = 13): number {
  const vw = window.innerWidth;
  const scale = Math.min(Math.max(8 + 0.278 * vw / 100, 12), 18) / 12;
  return Math.round(base * scale);
}

export function TerminalView({ terminalId, send, subscribe, onResize, reconnectCount = 0 }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Use refs for callbacks so the effect doesn't re-run when they change
  const sendRef = useRef(send);
  const subscribeRef = useRef(subscribe);
  const onResizeRef = useRef(onResize);
  // Track previous reconnectCount to distinguish mount from actual reconnects
  const prevReconnectRef = useRef(reconnectCount);

  sendRef.current = send;
  subscribeRef.current = subscribe;
  onResizeRef.current = onResize;

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'IBM Plex Mono', 'Fira Code', monospace",
      fontSize: getTerminalFontSize(),
      lineHeight: 1.2,
      theme: {
        background: '#0a0b12',
        foreground: '#d8e0d8',
        cursor: '#33dd77',
        cursorAccent: '#0a0b12',
        selectionBackground: '#33dd7740',
        black: '#0a0b12',
        red: '#dd4444',
        green: '#33dd77',
        yellow: '#ddaa22',
        blue: '#4488dd',
        magenta: '#aa44dd',
        cyan: '#44bbdd',
        white: '#d8e0d8',
        brightBlack: '#808094',
        brightRed: '#ff6666',
        brightGreen: '#55ff99',
        brightYellow: '#ffcc44',
        brightBlue: '#66aaff',
        brightMagenta: '#cc66ff',
        brightCyan: '#66ddff',
        brightWhite: '#e0e8e0',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;

    // Delayed initial fit — container may not have dimensions yet
    const fitTimer = setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 50);

    // Send keystrokes to server
    term.onData((data) => {
      sendRef.current({ type: 'stdin', terminalId, data });
    });

    // Notify server of resize
    term.onResize(({ cols, rows }) => {
      sendRef.current({ type: 'resize', terminalId, cols, rows });
      onResizeRef.current?.(cols, rows);
    });

    // Subscribe to server messages for this terminal
    const unsub = subscribeRef.current((msg) => {
      if (!('terminalId' in msg) || msg.terminalId !== terminalId) return;
      if (msg.type === 'stdout') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
      }
    });

    // Request scrollback replay ONCE — catches any output that happened
    // before this component mounted (e.g. terminal spawned by kanban)
    sendRef.current({ type: 'replay', terminalId });

    // ResizeObserver to refit on container size change
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch {}
      });
    });
    ro.observe(containerRef.current);

    // Update terminal font size on window resize (for 4K scaling)
    const handleWindowResize = () => {
      const newSize = getTerminalFontSize();
      if (term.options.fontSize !== newSize) {
        term.options.fontSize = newSize;
        try { fitAddon.fit(); } catch {}
      }
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      clearTimeout(fitTimer);
      unsub();
      ro.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      term.dispose();
    };
  }, [terminalId]); // Only re-run if terminalId changes

  // Re-request scrollback replay after WS reconnects.
  // The subscription handlers persist across reconnects (stored in a ref set
  // inside useWebSocket), so only the replay needs to be re-sent.
  // Uses prevReconnectRef to avoid firing on mount when reconnectCount is
  // already > 0 (e.g. component mounts after a reconnect has already occurred).
  useEffect(() => {
    if (reconnectCount !== prevReconnectRef.current) {
      prevReconnectRef.current = reconnectCount;
      termRef.current?.reset();
      sendRef.current({ type: 'replay', terminalId });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectCount]); // terminalId omitted — mount effect handles terminalId changes

  return (
    <div
      ref={containerRef}
      className="terminal-view"
    />
  );
}
