import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';

// Mock xterm.js — Terminal, FitAddon, WebLinksAddon
const mockReset = vi.fn();
const mockWrite = vi.fn();
const mockOpen = vi.fn();
const mockDispose = vi.fn();
const mockLoadAddon = vi.fn();
const mockOnData = vi.fn(() => ({ dispose: vi.fn() }));
const mockOnResize = vi.fn(() => ({ dispose: vi.fn() }));

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: mockOpen,
    write: mockWrite,
    reset: mockReset,
    dispose: mockDispose,
    loadAddon: mockLoadAddon,
    onData: mockOnData,
    onResize: mockOnResize,
    options: { fontSize: 13 },
  })),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { TerminalView } from '../../src/components/TerminalView';

describe('TerminalView', () => {
  it('sends replay on initial mount', () => {
    const send = vi.fn();
    const subscribe = vi.fn(() => () => {});

    render(
      <TerminalView
        terminalId="t1"
        send={send}
        subscribe={subscribe}
      />
    );

    // Should send replay once on mount
    expect(send).toHaveBeenCalledWith({ type: 'replay', terminalId: 't1' });
  });

  it('resets terminal and sends replay on reconnect', () => {
    const send = vi.fn();
    const subscribe = vi.fn(() => () => {});

    const { rerender } = render(
      <TerminalView
        terminalId="t1"
        send={send}
        subscribe={subscribe}
        reconnectCount={0}
      />
    );

    // Clear mocks from initial mount
    mockReset.mockClear();
    send.mockClear();

    // Simulate a reconnect by bumping reconnectCount
    rerender(
      <TerminalView
        terminalId="t1"
        send={send}
        subscribe={subscribe}
        reconnectCount={1}
      />
    );

    // Should reset the terminal to clear pre-reconnect content
    expect(mockReset).toHaveBeenCalledTimes(1);
    // Should send replay to get fresh scrollback
    expect(send).toHaveBeenCalledWith({ type: 'replay', terminalId: 't1' });
  });

  it('does not reset or replay when reconnectCount stays at 0', () => {
    const send = vi.fn();
    const subscribe = vi.fn(() => () => {});

    const { rerender } = render(
      <TerminalView
        terminalId="t1"
        send={send}
        subscribe={subscribe}
        reconnectCount={0}
      />
    );

    mockReset.mockClear();
    send.mockClear();

    // Re-render with same reconnectCount — should not trigger replay
    rerender(
      <TerminalView
        terminalId="t1"
        send={send}
        subscribe={subscribe}
        reconnectCount={0}
      />
    );

    expect(mockReset).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('resets and replays on each reconnect increment', () => {
    const send = vi.fn();
    const subscribe = vi.fn(() => () => {});

    const { rerender } = render(
      <TerminalView
        terminalId="t1"
        send={send}
        subscribe={subscribe}
        reconnectCount={0}
      />
    );

    mockReset.mockClear();
    send.mockClear();

    // First reconnect
    rerender(
      <TerminalView
        terminalId="t1"
        send={send}
        subscribe={subscribe}
        reconnectCount={1}
      />
    );

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'replay', terminalId: 't1' });

    mockReset.mockClear();
    send.mockClear();

    // Second reconnect
    rerender(
      <TerminalView
        terminalId="t1"
        send={send}
        subscribe={subscribe}
        reconnectCount={2}
      />
    );

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'replay', terminalId: 't1' });
  });
});
