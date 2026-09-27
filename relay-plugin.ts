/* Локальный WS-релей для простого LAN-режима: гости открывают адрес хоста
 * (http://IP:5173) и подключаются по коду комнаты — без WebRTC и кодов.
 * Работает и в `vite dev`, и в `vite preview`. */
import type { Plugin } from 'vite';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, WebSocket } from 'ws';

/** Минимальный структурный тип: и http.Server, и http2-сервер превью подходят. */
interface UpgradeableServer {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

const PATH = '/__relay';
const MAX_ROOMS = 50;
const MAX_GUESTS = 8;
const MAX_MSG = 64 * 1024;

interface Room {
  code: string;
  host: WebSocket;
  guests: Map<number, WebSocket>;
  nextId: number;
}

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

export function relayPlugin(): Plugin {
  const rooms = new Map<string, Room>();

  function handleConn(ws: WebSocket): void {
    let role: 'host' | 'guest' | null = null;
    let room: Room | null = null;
    let guestId = 0;

    ws.on('message', (raw) => {
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!role) {
        if (m.t === 'host' && typeof m.room === 'string' && /^\d{4}$/.test(m.room)) {
          if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'err', msg: 'server-full' });
          if (rooms.has(m.room)) return send(ws, { t: 'err', msg: 'room-exists' });
          room = { code: m.room, host: ws, guests: new Map(), nextId: 1 };
          rooms.set(m.room, room);
          role = 'host';
          send(ws, { t: 'ok' });
        } else if (m.t === 'join') {
          const r = rooms.get(String(m.room ?? ''));
          if (!r) return send(ws, { t: 'err', msg: 'no-room' });
          if (r.guests.size >= MAX_GUESTS) return send(ws, { t: 'err', msg: 'room-full' });
          role = 'guest';
          room = r;
          guestId = r.nextId++;
          r.guests.set(guestId, ws);
          send(ws, { t: 'ok', id: guestId });
          send(r.host, { t: 'open', id: guestId });
        }
        return;
      }
      if (m.t === 'msg' && room) {
        if (role === 'guest') {
          send(room.host, { t: 'msg', from: guestId, data: m.data });
        } else if (typeof m.to === 'number') {
          const g = room.guests.get(m.to);
          if (g) send(g, { t: 'msg', data: m.data });
        }
      }
    });

    ws.on('close', () => {
      if (!room) return;
      if (role === 'host') {
        for (const g of room.guests.values()) {
          try { g.close(); } catch { /* ignore */ }
        }
        rooms.delete(room.code);
      } else if (role === 'guest') {
        room.guests.delete(guestId);
        send(room.host, { t: 'leave', id: guestId });
      }
    });
  }

  function attach(httpServer: UpgradeableServer): void {
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG });
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      let pathname = '';
      try {
        pathname = new URL(req.url ?? '', 'http://x').pathname;
      } catch {
        return; // не наш путь — отдаём vite (HMR и т.п.)
      }
      if (pathname !== PATH) return;
      wss.handleUpgrade(req, socket, head, (ws) => handleConn(ws));
    });
  }

  return {
    name: 'mathart-lan-relay',
    configureServer(server) {
      if (server.httpServer) attach(server.httpServer);
    },
    configurePreviewServer(server) {
      if (server.httpServer) attach(server.httpServer);
    },
  };
}
