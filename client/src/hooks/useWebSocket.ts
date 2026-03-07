import { useRef, useEffect, useCallback, useState } from 'react';
import type { ClientMessage, ServerMessage } from '../types';

type MessageHandler = (msg: ServerMessage) => void;

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [connected, setConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const hasConnectedRef = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (hasConnectedRef.current) {
        // This is a reconnect, not the initial connection
        setReconnectCount((c) => c + 1);
      }
      hasConnectedRef.current = true;
      setConnected(true);
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 1s
      reconnectTimer.current = setTimeout(connect, 1000);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        for (const handler of handlersRef.current) {
          handler(msg);
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const subscribe = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return { connected, reconnectCount, send, subscribe };
}
