export type ObstacleTypeKey = 'circles' | 'squares' | 'polylines' | 'beziers' | 'closedBeziers';

export interface ObstacleTypeCfg {
  count: number; // 0 = disabled
  size: number; // 0.5..3 multiplier
}

export type ObstacleConfig = Record<ObstacleTypeKey, ObstacleTypeCfg>;

export interface MatchSettings {
  mapW: number;
  mapH: number;
  turnTimerSec: number; // 0 = off
  obstaclesEnabled: boolean;
  obstacles: ObstacleConfig;
  spawnSpread: number; // 10..90 (%)
  previewEnabled: boolean;
  predictFinish: boolean; // show predicted impact marker
  oscillationLimit: number; // 0 = unlimited (oscillations per unit of length)
  hitsToDie: number; // 1..5
  allowClosedLoops: boolean; // ВКЛ = looped routes allowed, ВЫКЛ = rejected
  /** 0 — каждый сам за себя; 2 — 2×2 (4 игрока); 3 — 3×3 (6 игроков) */
  teams: 0 | 2 | 3;
  /** генератор гарантирует, что между любыми спавнами есть проход для выстрела */
  ensureReachable: boolean;
  /** разрушаемость препятствий: 0 — отключена, 1 — частичная (3 попадания), 2 — полная (1 попадание), 3 — прогрызание (пуля бурит отверстия) */
  destruction: 0 | 1 | 2 | 3;
  /**
   * Логика стрельбы: 'zero' (Zero point, по умолчанию) — нулевая точка в танке,
   * координаты x относительны стрелку; 'gw' (GW point) — старый вариант:
   * x абсолютный (координаты мира), кривая вертикально смещена через игрока.
   */
  shotMode: ShotMode;
  /** чат в матче (сетевой режим) */
  chatEnabled: boolean;
  /** список предыдущих уравнений игрока */
  eqHistoryMine: boolean;
  /** список предыдущих уравнений всех игроков */
  eqHistoryAll: boolean;
  /** отброс при попадании: жертва отлетает на 1..fleeRadius клеток в случайную сторону (только при hitsToDie > 1) */
  fleeOnHit: boolean;
  /** радиус побега при отбросе, клеток (1..10) */
  fleeRadius: number;
  /** сколько игроков поражает одна пуля: 1 — взрыв при первом попадании, 2..6 — проходит сквозь (6 = всех). В любом режиме взрыв о препятствие/стену */
  pierce: number;
  /**
   * Режим «мультиточки» (в духе GraphWar): у каждого игрока N случайно
   * расставленных точек-танков; каждый ход стрельба идёт от случайной ДРУГОЙ
   * точки (выбор детерминирован — одинаков у хоста и гостей). Жизни — у
   * каждой точки: подбитая точка исчезает, игрок стреляет с оставшихся;
   * умирает игрок, когда подбиты все его точки.
   */
  pointsPerPlayer: number; // 1..3
}

export type ShotMode = 'zero' | 'gw';

export interface PlayerDef {
  id: number;
  name: string;
  colorIdx: number;
  /** команда (0/1) в командных режимах; в FFA не используется */
  team?: number;
}

/** Точка-танк игрока (режим «мультиточки») со своими жизнями. */
export interface PlayerPoint extends Pt {
  hp: number;
}

export interface GamePlayer extends PlayerDef {
  x: number;
  y: number;
  /** суммарные оставшиеся жизни (= сумма hp точек); для HUD и синка */
  hp: number;
  alive: boolean;
  /** все живые точки игрока; подбитая точка исчезает из списка */
  points: PlayerPoint[];
  /** индекс активной (стреляющей в этом ходу) точки в points; x/y = points[activeIdx].
   *  −1 — активная точка только что подбита, новую выберет afterTurn */
  activeIdx: number;
}

/**
 * Пробуренное пулей отверстие: кратер входа в (x, y) радиуса r + туннель
 * направления (dx, dy) длиной depth. Пуля проходит, когда туннель достиг
 * противоположной стенки объекта.
 */
export interface DrillHole {
  x: number;
  y: number;
  r: number;
  dx: number;
  dy: number;
  depth: number;
}

export type Obstacle =
  | { kind: 'circle'; cx: number; cy: number; r: number; hp?: number; holes?: DrillHole[] }
  | { kind: 'rect'; cx: number; cy: number; w: number; h: number; hp?: number; holes?: DrillHole[] }
  | { kind: 'poly'; pts: Pt[]; hp?: number; gaps?: DrillHole[] }
  | { kind: 'shape'; pts: Pt[]; hp?: number; holes?: DrillHole[] };

/** Прочность препятствий по настройке разрушаемости (0 = неразрушаемы / прогрызание). */
export function obstacleMaxHp(destruction: 0 | 1 | 2 | 3): number {
  return destruction === 2 ? 1 : destruction === 1 ? 3 : 0;
}

export interface Pt {
  x: number;
  y: number;
}

export type PanelPosition = 'bottom' | 'top' | 'left' | 'right';
export type MinimapCorner = 'tl' | 'tr' | 'bl' | 'br';
export type MinimapSize = 's' | 'm' | 'l';
export type ThemeName = 'dark' | 'light';
export type UiScale = 's' | 'm' | 'l';

export interface GameSettings {
  sound: boolean;
  sfxVolume: number; // 0..100
  music: boolean;
  musicVolume: number; // 0..100
  uiScale: UiScale;
  panelPosition: PanelPosition;
  minimapCorner: MinimapCorner;
  minimapSize: MinimapSize;
  minimap: boolean;
  playerName: string;
  theme: ThemeName;
  /** URL TURN-креденшелов metered.ca (для игры через интернет в сложных сетях) */
  turnUrl: string;
}

export const DEFAULT_OBSTACLES: ObstacleConfig = {
  circles: { count: 4, size: 1 },
  squares: { count: 4, size: 1 },
  polylines: { count: 0, size: 1 },
  beziers: { count: 0, size: 1 },
  closedBeziers: { count: 0, size: 1 },
};

export const DEFAULT_MATCH: MatchSettings = {
  mapW: 70,
  mapH: 44,
  turnTimerSec: 30,
  obstaclesEnabled: true,
  obstacles: DEFAULT_OBSTACLES,
  spawnSpread: 50,
  previewEnabled: true,
  predictFinish: true,
  oscillationLimit: 0,
  hitsToDie: 1,
  allowClosedLoops: true,
  teams: 0,
  ensureReachable: true,
  destruction: 0,
  shotMode: 'zero',
  chatEnabled: true,
  eqHistoryMine: true,
  eqHistoryAll: true,
  fleeOnHit: false,
  fleeRadius: 3,
  pierce: 1,
  pointsPerPlayer: 1,
};

export const DEFAULT_SETTINGS: GameSettings = {
  sound: true,
  sfxVolume: 80,
  music: true,
  musicVolume: 55,
  uiScale: 'm',
  panelPosition: 'bottom',
  minimapCorner: 'tr',
  minimapSize: 'm',
  minimap: true,
  playerName: 'Игрок 1',
  theme: 'dark',
  turnUrl: '',
};

export const MAX_PLAYERS = 6;
export const MAP_MIN_W = 30;
export const MAP_MAX_W = 140;
export const MAP_MIN_H = 20;
export const MAP_MAX_H = 100;

export const PLAYER_COLORS: Record<ThemeName, string[]> = {
  dark: ['#2cc9ff', '#ff2bd6', '#a2db3c', '#ff9f1c', '#9d6bff', '#ffe93c'],
  light: ['#0e7fae', '#c217a3', '#5c8a1e', '#c26a00', '#6f3fd1', '#a08700'],
};

export function playerColor(colorIdx: number, theme: ThemeName): string {
  const arr = PLAYER_COLORS[theme];
  return arr[colorIdx % arr.length];
}
