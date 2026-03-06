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

    // Fit to container
    try { fitAddon.fit(); } catch {}

    termRef.current = term;
    fitRef.current = fitAddon;

    // Send keystrokes to server
    term.onData((data) => {
      send({ type: 'stdin', terminalId, data });
    });

    // Notify server of resize
    term.onResize(({ cols, rows }) => {
      send({ type: 'resize', terminalId, cols, rows });
      onResize?.(cols, rows);
    });

    // Subscribe to server messages for this terminal
    const unsub = subscribe((msg) => {
      if (msg.terminalId !== terminalId) return;
      if (msg.type === 'stdout') {
        term.write(msg.data);
      } else if (msg.type === 'exit') {
        term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
      }
    });

    // ResizeObserver to refit on container size change
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    ro.observe(containerRef.current);

    return () => {
      unsub();
      ro.disconnect();
      term.dispose();
    };
  }, [terminalId, send, subscribe, onResize]);

  return (
    <div
      ref={containerRef}
      className="terminal-view"
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  );
}
