/* WebRTC manual-signaling transport: offers/answers exchanged as copy-paste codes.
 * LAN-friendly: host candidates work without any server; STUN included as fallback. */

/* STUN для прямого P2P. Публичных бесплатных TURN-релеев больше не существует,
 * поэтому для сложных сетей (симметричный NAT) поддерживается свой TURN:
 * URL с ключом metered.ca (бесплатный тариф) указывается в настройках игры. */
const STUN_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

let cachedCfg: RTCConfiguration | null = null;

export async function getRtcConfig(): Promise<RTCConfiguration> {
  if (cachedCfg) return cachedCfg;
  const servers = [...STUN_SERVERS];
  try {
    const raw = localStorage.getItem('mathart:settings');
    const turnUrl = raw ? String((JSON.parse(raw) as { turnUrl?: string }).turnUrl ?? '').trim() : '';
    if (turnUrl) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(turnUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      const extra = (await res.json()) as unknown;
      if (Array.isArray(extra)) servers.push(...(extra as RTCIceServer[]));
    }
  } catch {
    /* нет ключа или сервис недоступен — играем на чистом STUN */
  }
  cachedCfg = { iceServers: servers };
  return cachedCfg;
}

export interface CandidateStats {
  host: number;
  srflx: number;
  relay: number;
}

export interface Link {
  send(obj: unknown): void;
  onMessage: ((data: unknown) => void) | null;
  onOpen: (() => void) | null;
  onClose: (() => void) | null;
  isOpen(): boolean;
  /** true, если ICE-соединение успело установиться хотя бы раз */
  wasConnected(): boolean;
  /** текущее состояние ICE (для диагностики в сообщениях об ошибках) */
  iceState(): string;
  /** типы собранных ICE-кандидатов (только WebRTC; у релея нет) */
  candStats?: () => CandidateStats;
  close(): void;
}

function waitIce(pc: RTCPeerConnection): Promise<void> {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    // TURN-аллокация может занять несколько секунд — не обрезаем её слишком рано
    const timer = setTimeout(res, 8000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        res();
      }
    });
  });
}

export function encodeDesc(d: RTCSessionDescriptionInit): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(d))));
}

export function decodeDesc(s: string): RTCSessionDescriptionInit {
  const cleaned = s.trim().replace(/\s+/g, '');
  return JSON.parse(decodeURIComponent(escape(atob(cleaned)))) as RTCSessionDescriptionInit;
}

function wireChannel(dc: RTCDataChannel, link: BaseLink): void {
  dc.onmessage = (e) => {
    try {
      const data = JSON.parse(String(e.data)) as unknown;
      link.onMessage?.(data);
    } catch {
      /* ignore malformed packet */
    }
  };
  dc.onopen = () => link.onOpen?.();
  dc.onclose = () => link.notifyClose();
}

class BaseLink implements Link {
  onMessage: ((data: unknown) => void) | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  protected pc: RTCPeerConnection;
  protected dc: RTCDataChannel | null = null;
  private connected = false;
  private closedNotified = false;
  private cand: CandidateStats = { host: 0, srflx: 0, relay: 0 };

  constructor(pc: RTCPeerConnection, dc?: RTCDataChannel) {
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const t = e.candidate.type;
      if (t === 'host') this.cand.host++;
      else if (t === 'srflx') this.cand.srflx++;
      else if (t === 'relay') this.cand.relay++;
      console.debug('[rtc] candidate:', e.candidate.type, e.candidate.protocol, e.candidate.address ?? '(mDNS)');
    };
    pc.oniceconnectionstatechange = () => {
      console.debug('[rtc] ice:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') this.connected = true;
      // 'failed' = соединение так и не установилось (или рухнуло окончательно)
      if (pc.iceConnectionState === 'failed') {
        try { this.dc?.close(); } catch { /* ignore */ }
        this.notifyClose();
      }
    };
    if (dc) this.bind(dc);
  }

  notifyClose(): void {
    if (this.closedNotified) return;
    this.closedNotified = true;
    this.onClose?.();
  }

  wasConnected(): boolean {
    return this.connected;
  }

  iceState(): string {
    return this.pc.iceConnectionState;
  }

  candStats = (): CandidateStats => ({ ...this.cand });

  protected bind(dc: RTCDataChannel): void {
    this.dc = dc;
    wireChannel(dc, this);
  }

  send(obj: unknown): void {
    if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(obj));
  }

  isOpen(): boolean {
    return this.dc?.readyState === 'open';
  }

  close(): void {
    try {
      this.dc?.close();
      this.pc.close();
    } catch {
      /* already closed */
    }
  }
}

export function waitOpen(link: Link, timeoutMs = 15000): Promise<void> {
  return new Promise((res, rej) => {
    if (link.isOpen()) return res();
    const timer = setTimeout(() => rej(new Error('timeout waiting for channel open')), timeoutMs);
    const prev = link.onOpen;
    link.onOpen = () => {
      clearTimeout(timer);
      prev?.();
      res();
    };
  });
}

/** Guest side: creates an offer code, then accepts the host's answer code. */
export class GuestLink extends BaseLink {
  private constructor(pc: RTCPeerConnection, dc: RTCDataChannel) {
    super(pc, dc);
  }

  static async create(): Promise<GuestLink> {
    const pc = new RTCPeerConnection(await getRtcConfig());
    const dc = pc.createDataChannel('game', { ordered: true });
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    return new GuestLink(pc, dc);
  }

  offerCode(): string {
    const d = this.pc.localDescription;
    if (!d) throw new Error('no local description');
    return encodeDesc(d);
  }

  async acceptAnswer(code: string): Promise<void> {
    // Повторное применение ответа к тому же предложению невозможно (state уже stable) —
    // превращаем загадочную ошибку браузера в понятную инструкцию.
    if (this.pc.signalingState !== 'have-local-offer') {
      throw new Error('used-offer');
    }
    await this.pc.setRemoteDescription(decodeDesc(code));
  }
}

/** Host side: builds an answer code from a guest's offer code. */
export class HostLink extends BaseLink {
  private constructor(pc: RTCPeerConnection) {
    super(pc);
  }

  static async fromOfferCode(code: string): Promise<HostLink> {
    const pc = new RTCPeerConnection(await getRtcConfig());
    // The guest's datachannel can only arrive AFTER the answer reaches the guest,
    // so produce the answer first and bind the channel lazily when it comes in.
    const link = new HostLink(pc);
    pc.ondatachannel = (e) => link.bind(e.channel);
    await pc.setRemoteDescription(decodeDesc(code));
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    return link;
  }

  answerCode(): string {
    const d = this.pc.localDescription;
    if (!d) throw new Error('no local description');
    return encodeDesc(d);
  }
}
