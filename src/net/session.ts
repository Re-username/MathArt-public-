import type { Link } from './rtc';
import type { NetMessage } from './protocol';

/** Host-side star topology: one link per guest, host broadcasts to everyone. */
export class HostSession {
  links = new Map<number, Link>();
  handler: ((playerId: number, msg: NetMessage) => void) | null = null;
  private nextId = 1;

  /** Register a freshly-answered link; waits for the guest's hello with their name. */
  adopt(link: Link, onNamed: (playerId: number, name: string) => void, onGone: (playerId: number) => void): void {
    let assignedId: number | null = null;
    link.onMessage = (data) => {
      const msg = data as NetMessage;
      if (assignedId === null) {
        if (msg.t === 'hello') {
          assignedId = this.nextId++;
          this.links.set(assignedId, link);
          link.send({ t: 'welcome', playerId: assignedId } satisfies NetMessage);
          onNamed(assignedId, msg.name.slice(0, 16) || `Игрок ${assignedId + 1}`);
        }
        return;
      }
      this.handler?.(assignedId, msg);
    };
    link.onClose = () => {
      if (assignedId !== null) {
        this.links.delete(assignedId);
        onGone(assignedId);
      }
    };
  }

  broadcast(msg: NetMessage): void {
    for (const link of this.links.values()) link.send(msg);
  }

  kick(playerId: number): void {
    const link = this.links.get(playerId);
    link?.close();
    this.links.delete(playerId);
  }

  closeAll(): void {
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.handler = null;
  }
}

/** Guest side: single link to the host. */
export class GuestSession {
  myId: number | null = null;
  handler: ((msg: NetMessage) => void) | null = null;
  onClosed: (() => void) | null = null;
  /** последнее состояние лобби — позволяет вернуться в лобби после матча */
  lastLobby: Extract<NetMessage, { t: 'lobby' }> | null = null;
  link: Link;

  constructor(link: Link) {
    this.link = link;
    link.onMessage = (data) => {
      const msg = data as NetMessage;
      if (msg.t === 'welcome') this.myId = msg.playerId;
      this.handler?.(msg);
    };
    link.onClose = () => this.onClosed?.();
  }

  send(msg: NetMessage): void {
    this.link.send(msg);
  }

  close(): void {
    this.link.close();
    this.handler = null;
  }
}
