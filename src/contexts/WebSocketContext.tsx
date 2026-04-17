import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { IS_PLATFORM } from '../constants/config';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
};

const normalizeCodexChatEvent = (data: any): any | null => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const type = typeof data.type === 'string' ? data.type : '';
  if (!type.startsWith('chat-')) {
    return data;
  }

  const scope = data.scope && typeof data.scope === 'object' ? data.scope : null;
  const provider = scope?.provider ?? data.provider;
  if (provider && provider !== 'codex') {
    console.warn('[ws] Ignored non-codex chat event:', type, provider);
    return null;
  }

  return {
    ...data,
    provider: 'codex',
    projectName: scope?.projectName ?? data.projectName ?? null,
    sessionId: scope?.sessionId ?? data.sessionId ?? null,
  };
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = (token: string | null) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (IS_PLATFORM) {
    return `${protocol}//${window.location.host}/ws`;
  }

  if (!token) {
    return null;
  }

  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const lastSentAtByTypeRef = useRef<Map<string, number>>(new Map());
  const seenUnifiedSessionKeysRef = useRef<Set<string>>(new Set());
  const { token } = useAuth();

  // Message queue: ensures every WebSocket message is delivered to consumers
  // even when multiple arrive before React can re-render.
  const messageQueueRef = useRef<any[]>([]);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drainQueue = useCallback(() => {
    drainTimerRef.current = null;
    if (messageQueueRef.current.length === 0) return;
    const next = messageQueueRef.current.shift()!;
    setLatestMessage(next);
    if (messageQueueRef.current.length > 0) {
      drainTimerRef.current = setTimeout(drainQueue, 0);
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    
    return () => {
      unmountedRef.current = true;
      retryCountRef.current = 0;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (drainTimerRef.current) {
        clearTimeout(drainTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    try {
      const wsUrl = buildWebSocketUrl(token);

      if (!wsUrl) return console.warn('No authentication token found for WebSocket connection');
      
      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        retryCountRef.current = 0;
        setIsConnected(true);
        wsRef.current = websocket;
        // Reset migration dedup windows on reconnect.
        seenUnifiedSessionKeysRef.current.clear();
        lastSentAtByTypeRef.current.clear();
      };

      websocket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const parsedType = typeof parsed?.type === 'string' ? parsed.type : '';

          // Codex-only hard guard for incoming messages.
          const parsedProvider =
            typeof parsed?.provider === 'string'
              ? parsed.provider
              : typeof parsed?.scope?.provider === 'string'
                ? parsed.scope.provider
                : null;
          if (parsedProvider && parsedProvider !== 'codex') {
            console.warn('[ws] Ignored non-codex websocket event:', parsedType, parsedProvider);
            return;
          }

          // Ignore server ack-like responses for outbound commands blocked on client.
          if (parsedType === 'command-ignored' && parsed?.reason === 'unsupported-provider') {
            return;
          }
          if (parsedType === 'permission-response-ignored') {
            return;
          }

          // Ignore periodic check responses when they clearly don't correspond to a
          // locally initiated status check.
          if (parsedType === 'session-status' && parsed?.ignored === true && parsed?.reason === 'unsupported-provider') {
            const lastCheckAt = lastSentAtByTypeRef.current.get('check-session-status') || 0;
            if (Date.now() - lastCheckAt > 8000) {
              return;
            }
          }

          if (parsedType === 'chat-session-created') {
            const scope = parsed?.scope || {};
            const key = `${scope.projectName || ''}::${scope.sessionId || ''}`;
            if (key !== '::') {
              seenUnifiedSessionKeysRef.current.add(key);
            }
          }

          // During dual-send migration, ignore legacy codex events once unified
          // session-created has been observed for the same scope.
          if (parsedType.startsWith('codex-')) {
            const projectName =
              parsed?.projectName ||
              parsed?.data?.projectName ||
              null;
            const sessionId =
              parsed?.actualSessionId ||
              parsed?.sessionId ||
              null;
            if (projectName && sessionId) {
              const key = `${projectName}::${sessionId}`;
              if (seenUnifiedSessionKeysRef.current.has(key)) {
                return;
              }
            }
          }

          const normalized = normalizeCodexChatEvent(parsed);
          if (!normalized) {
            return;
          }
          messageQueueRef.current.push(normalized);
          if (!drainTimerRef.current) {
            drainTimerRef.current = setTimeout(drainQueue, 0);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;

        const delay = Math.min(3000 * Math.pow(2, retryCountRef.current), 30000);
        retryCountRef.current++;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return;
          connect();
        }, delay);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  }, [token, drainQueue]);

  const sendMessage = useCallback((message: any) => {
    const type = typeof message?.type === 'string' ? message.type : '';
    if (type.endsWith('-command') && type !== 'codex-command') {
      console.warn('[ws] Blocked non-codex outbound command:', type);
      return;
    }
    if (
      (type === 'abort-session' || type === 'check-session-status')
      && message?.provider
      && message.provider !== 'codex'
    ) {
      console.warn('[ws] Blocked non-codex outbound control message:', type, message.provider);
      return;
    }

    if (type) {
      lastSentAtByTypeRef.current.set(type, Date.now());
    }

    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected
  }), [sendMessage, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();
  
  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
