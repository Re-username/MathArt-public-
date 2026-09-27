/* Простой LAN-режим: соединение через компьютер хоста (WS-релей в dev/preview-сервере).
 * Без WebRTC, NAT и кодов-кандидатов — только 4-значный код комнаты. */
import type { Link } from './rtc';

/** Релей доступен, только если игра открыта по http(s) с машины хоста. */
export function relaySupported(): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:';
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/__relay`;
}

export function makeRoomCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/** Виртуальный канал хоста к одному гостю через релей. */
class VirtualGuestLink implements Link {
  onMessage: ((data: unknown) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  private open = true;
  private closedNotified = false;
  private host: RelayHost;
  readonly id: number;

  constructor(host: RelayHost, id: number) {
    this.host = host;
    this.id = id;
  }

  send(obj: unknown): void {
    this.host.sendTo(this.id, obj);
  }

  isOpen(): boolean {
    return this.open;
  }

  wasConnected(): boolean {
    return true; // соединение через релей уже установлено
  }

  iceState(): string {
    return 'relay';
  }

  feedMessage(data: unknown): void {
    this.onMessage?.(data);
  }

  notifyClose(): void {
    if (this.closedNotified) return;
    this.closedNotified = true;
    this.open = false;
    this.onClose?.();
  }

  close(): void {
    this.notifyClose();
  }
}

/** Хост-сторона релея: регистрирует комнату и выдаёт Link на каждого гостя. */
export class RelayHost {
  private ws: WebSocket | null = null;
  private links = new Map<number, VirtualGuestLink>();
  /** Вызывается, когда зашёл новый гость — хост передаёт link в session.adopt. */
  onGuest: ((link: Link) => void) | null = null;
  onClosed: (() => void) | null = null;
  readonly room: string;

  private constructor(room: string) {
    this.room = room;
  }

  static async create(room: string, timeoutMs = 10000): Promise<RelayHost> {
    const host = new RelayHost(room);
    await host.connect(timeoutMs);
    return host;
  }

  private connect(timeoutMs: number): Promise<void> {
    return new Promise((res, rej) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; rej(new Error('релей не отвечает')); }
      }, timeoutMs);
      const ws = new WebSocket(wsUrl());
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'host', room: this.room }));
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); rej(new Error('релей недоступен (игра открыта не через сервер хоста?)')); }
      };
      ws.onclose = () => {
        for (const l of this.links.values()) l.notifyClose();
        this.onClosed?.();
      };
      ws.onmessage = (e) => {
        let m: { t?: string; msg?: string; id?: number; from?: number; data?: unknown };
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.t === 'ok' && !settled) {
          settled = true; clearTimeout(timer); res();
        } else if (m.t === 'err') {
          if (!settled) { settled = true; clearTimeout(timer); rej(new Error(m.msg === 'room-exists' ? 'room-exists' : 'Сервер переполнен')); }
        } else if (m.t === 'open' && typeof m.id === 'number') {
          const link = new VirtualGuestLink(this, m.id);
          this.links.set(m.id, link);
          this.onGuest?.(link);
        } else if (m.t === 'msg' && typeof m.from === 'number') {
          this.links.get(m.from)?.feedMessage(m.data);
        } else if (m.t === 'leave' && typeof m.id === 'number') {
          const l = this.links.get(m.id);
          this.links.delete(m.id);
          l?.notifyClose();
        }
      };
    });
  }

  sendTo(guestId: number, obj: unknown): void {
    this.ws?.send(JSON.stringify({ t: 'msg', to: guestId, data: obj }));
  }

  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

/** Гость-сторона релея: один канал к хосту. */
export class RelayGuestLink implements Link {
  onMessage: ((data: unknown) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private open = false;
  private closedNotified = false;

  static async join(room: string, timeoutMs = 10000): Promise<RelayGuestLink> {
    const link = new RelayGuestLink();
    await link.connect(room, timeoutMs);
    return link;
  }

  private connect(room: string, timeoutMs: number): Promise<void> {
    return new Promise((res, rej) => {
      let settled = false;
      const fail = (msg: string) => { if (!settled) { settled = true; clearTimeout(timer); rej(new Error(msg)); } };
      const timer = setTimeout(() => fail('релей не отвечает'), timeoutMs);
      const ws = new WebSocket(wsUrl());
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room }));
      ws.onerror = () => fail('Не удалось достучаться до компьютера хоста');
      ws.onclose = () => {
        if (!settled) { fail('Соединение закрыто'); return; }
        if (!this.closedNotified) { this.closedNotified = true; this.open = false; this.onClose?.(); }
      };
      ws.onmessage = (e) => {
        let m: { t?: string; msg?: string; data?: unknown };
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.t === 'ok' && !settled) {
          settled = true; clearTimeout(timer);
          this.open = true;
          this.onOpen?.();
          res();
        } else if (m.t === 'err') {
          fail(m.msg === 'no-room' ? 'Комната не найдена — проверь код' : m.msg === 'room-full' ? 'Комната заполнена' : 'Ошибка релея');
        } else if (m.t === 'msg') {
          this.onMessage?.(m.data);
        }
      };
    });
  }

  send(obj: unknown): void {
    if (this.open && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'msg', data: obj }));
  }

  isOpen(): boolean {
    return this.open;
  }

  wasConnected(): boolean {
    return this.open;
  }

  iceState(): string {
    return 'relay';
  }

  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    if (!this.closedNotified) { this.closedNotified = true; this.open = false; this.onClose?.(); }
  }
}
