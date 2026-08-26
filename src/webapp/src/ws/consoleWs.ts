import type { WsMessage } from '../types/models';
import { getToken, getApiOrigin } from '../api/client';

function wsBase(): string {
  return getApiOrigin().replace(/^http/, 'ws') + '/ws/console';
}

type MessageHandler = (msg: WsMessage) => void;

class ConsoleWebSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isOpen = false;

  connect() {
    const token = getToken();
    if (!token) return;

    this.ws = new WebSocket(`${wsBase()}?token=${token}`);

    this.ws.onopen = () => {
      this.isOpen = true;
      this.dispatch({ type: 'connection.open', channel: '', data: null, ts: Date.now() });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        this.dispatch(msg);
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      this.isOpen = false;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  send(msg: WsMessage) {
    if (this.ws && this.isOpen) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onAny(handler: MessageHandler): () => void {
    return this.on('*', handler);
  }

  private dispatch(msg: WsMessage) {
    this.handlers.get(msg.type)?.forEach(h => h(msg));
    this.handlers.get('*')?.forEach(h => h(msg));
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.isOpen = false;
  }
}

export const consoleWs = new ConsoleWebSocket();
