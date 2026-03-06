import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ServerMessage } from '../types';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  terminalId: string;
  send: (msg: any) => void;
  subscribe: (handler: (msg: ServerMessage) => void) => () => void;
  onResize?: (cols: number, rows: number) => void;
}

export function TerminalView({ terminalId, send, subscribe, onResize }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Use refs for callbacks so the effect doesn't re-run when they change
  const sendRef = useRef(send);
  const subscribeRef = useRef(subscribe);
  const onResizeRef = useRef(onResize);

  sendRef.current = send;
  subscribeRef.current = subscribe;
  onResizeRef.current = onResize;

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'IBM Plex Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#0a0b12',
        foreground: '#c0c8c0',
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
        white: '#c0c8c0',
        brightBlack: '#555566',
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
    // Re-subscribe when subscribe ref changes (WS reconnect)
    let unsub: (() => void) | null = null;

    const doSubscribe = () => {
      unsub?.();
      unsub = subscribeRef.current((msg) => {
        if (msg.terminalId !== terminalId) return;
        if (msg.type === 'stdout') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
        }
      });
    };
    doSubscribe();

    // Re-subscribe periodically to handle WS reconnects
    const subInterval = setInterval(() => {
      doSubscribe();
    }, 5000);

    // ResizeObserver to refit on container size change
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch {}
      });
    });
    ro.observe(containerRef.current);

    return () => {
      clearTimeout(fitTimer);
      clearInterval(subInterval);
      unsub?.();
      ro.disconnect();
      term.dispose();
    };
  }, [terminalId]); // Only re-run if terminalId changes

  return (
    <div
      ref={containerRef}
      className="terminal-view"
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
