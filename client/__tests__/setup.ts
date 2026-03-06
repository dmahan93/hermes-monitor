import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Mock ResizeObserver for jsdom
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as any;

// Mock WebSocket
class WebSocketMock {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = WebSocketMock.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    setTimeout(() => this.onopen?.(), 0);
  }

  send(_data: string) {}
  close() {
    this.readyState = WebSocketMock.CLOSED;
    this.onclose?.();
  }
}
globalThis.WebSocket = WebSocketMock as any;
