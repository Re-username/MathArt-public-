import type { MatchSettings, Obstacle, PlayerDef, Pt } from '../game/types';

export interface LobbyPlayer {
  id: number;
  name: string;
  ready: boolean;
  isHost: boolean;
}

export type NetMessage =
  // guest → host
  | { t: 'hello'; name: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'fire'; eq: string; dir: 1 | -1 }
  | { t: 'leave' }
  | { t: 'exit-match' } // гость сам вышел из матча в лобби (соединение сохраняется)
  | { t: 'lobby-please' } // гость просит актуальное состояние лобби (после возврата из матча)
  // host → guest(s)
  | { t: 'welcome'; playerId: number }
  | { t: 'lobby'; hostName: string; players: LobbyPlayer[]; settings: MatchSettings }
  | { t: 'start'; settings: MatchSettings; players: PlayerDef[]; positions: Pt[]; obstacles: Obstacle[] }
  | { t: 'shot'; shooterId: number; eq: string; dir: 1 | -1 }
  | { t: 'abort' } // хост досрочно завершил матч — все возвращаются в лобби
  | { t: 'pass' }
  | { t: 'reject'; reason: string }
  | { t: 'chat'; from?: string; text: string } // гость шлёт без from; хост подставляет имя и ретранслирует всем (включая отправителя — запись только по получении)
  | {
      t: 'sync';
      players: [id: number, hp: number, alive: boolean][];
      turnId: number | null;
      phase: 'aim' | 'flying' | 'over';
      winnerId: number | null;
      timeLeft: number | null;
      bloodKey: number;
      obstacles?: Obstacle[]; // авторитетное состояние препятствий (hp/разрушенные)
    };
