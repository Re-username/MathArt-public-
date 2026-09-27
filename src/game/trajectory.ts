import type { DrillHole, GamePlayer, MatchSettings, Obstacle, Pt } from './types';
import type { ParsedEquation } from './parser';

export type HitType = 'wall' | 'obstacle' | 'player' | 'void';

export interface FlightResult {
  ok: boolean;
  error?: string;
  points: Pt[];
  length: number;
  hit: HitType;
  hitPlayerId?: number;
  /** все жертвы на пути (пуля насквозь): id >= 0 — игрок, id < 0 — цель соло-разминки (-idx-1) */
  victims?: VictimHit[];
}

export interface VictimHit {
  id: number;
  x: number;
  y: number;
  /** отброс: куда смещается жертва после попадания (только игроки, только при hitsToDie > 1) */
  flee?: Pt;
}

const BULLET_R = 0.35;
export const PLAYER_R = 0.9;

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Detect a near-closed loop (circle-like route) while letting simple self-crossings pass. */
function hasClosedLoop(pts: Pt[], mapMin: number): boolean {
  const eps = mapMin * 0.015;
  const minGap = Math.max(40, Math.floor(pts.length * 0.02));
  const areaThresh = Math.pow(mapMin * 0.06, 2);
  const cell = eps * 2;
  const bins = new Map<string, number[]>();
  const key = (p: Pt) => `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;

  for (let j = 0; j < pts.length; j++) {
    const p = pts[j];
    const bx = Math.floor(p.x / cell);
    const by = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = bins.get(`${bx + dx},${by + dy}`);
        if (!arr) continue;
        for (const i of arr) {
          if (j - i < minGap) continue;
          if (dist(p, pts[i]) < eps) {
            const area = Math.abs(polygonArea(pts.slice(i, j + 1)));
            if (area > areaThresh) return true;
          }
        }
      }
    }
    const k = key(p);
    const arr = bins.get(k);
    if (arr) arr.push(j);
    else bins.set(k, [j]);
  }
  return false;
}

/** Count full oscillations of the dependent variable along the curve. */
function countOscillations(vals: number[]): number {
  let sign = 0;
  let changes = 0;
  for (let i = 1; i < vals.length; i++) {
    const d = vals[i] - vals[i - 1];
    if (Math.abs(d) < 1e-12) continue;
    const s = d > 0 ? 1 : -1;
    if (sign !== 0 && s !== sign) changes++;
    sign = s;
  }
  return changes / 2;
}

export interface BuildOptions {
  settings: MatchSettings;
  obstacles: Obstacle[];
  players: GamePlayer[];
  shooterId: number;
  soloTargets?: Pt[];
  /** порядковый номер выстрела — детерминированное зерно для отброса (одинаково на всех клиентах) */
  shotNumber?: number;
}

/** Детерминированный PRNG — отброс при попадании считается в buildFlight, чтобы
 *  хост и гости получили одну и ту же точку без ретрансляции позиций. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Точки игрока для коллизий/проверок: в мультиточках — все, иначе одна позиция. */
export function playerPoints(pl: { x: number; y: number; points?: Pt[] }): Pt[] {
  return pl.points && pl.points.length ? pl.points : [{ x: pl.x, y: pl.y }];
}

/**
 * Детерминированный выбор активной точки для хода (режим «мультиточки»,
 * в духе GraphWar): случайная из точек игрока, но НЕ та же, что в прошлый раз.
 * Сид от (номер завершённых выстрелов, id игрока) — хост и гости считают
 * одинаково, протокол менять не нужно.
 */
export function pickActiveIdx(pointCount: number, prevIdx: number, shotNumber: number, playerId: number): number {
  if (pointCount <= 1) return 0;
  const rng = mulberry32(((shotNumber + 1) * 2654435761 + (playerId + 11) * 747796405) >>> 0);
  // прежняя активная точка подбита (или индекс протух) — выбор без ограничений
  if (prevIdx < 0 || prevIdx >= pointCount) return Math.floor(rng() * pointCount);
  // равномерный выбор из всех индексов, кроме prevIdx
  let idx = Math.floor(rng() * (pointCount - 1));
  if (idx >= prevIdx) idx += 1;
  return idx;
}

/** Случайная свободная клетка в радиусе R от жертвы: сетка, без препятствий
 *  и не вплотную к другим игрокам. null — если место не нашлось (жертва стоит). */
function fleeSpot(vx: number, vy: number, victimId: number, opts: BuildOptions): Pt | null {
  const { settings, obstacles, players, shooterId, shotNumber } = opts;
  const rng = mulberry32(
    ((shotNumber ?? 0) * 2654435761 + (shooterId + 3) * 1597334677 + (victimId + 7) * 3812015801) >>> 0,
  );
  const R = Math.max(1, Math.min(10, settings.fleeRadius || 1));
  for (let i = 0; i < 40; i++) {
    const ang = rng() * Math.PI * 2;
    const d = 1 + Math.floor(rng() * R); // 1..R клеток
    const nx = Math.round(vx + Math.cos(ang) * d);
    const ny = Math.round(vy + Math.sin(ang) * d);
    if (Math.abs(nx) > settings.mapW / 2 - 2 || Math.abs(ny) > settings.mapH / 2 - 2) continue;
    if (hitTestObstacles(obstacles, nx, ny, 1.3)) continue;
    if (Math.hypot(nx - vx, ny - vy) < 1) continue;
    let crowded = false;
    for (const pl of players) {
      if (pl.id === victimId || !pl.alive) continue;
      for (const pt of playerPoints(pl)) {
        if (Math.hypot(pt.x - nx, pt.y - ny) < 2.5) {
          crowded = true;
          break;
        }
      }
      if (crowded) break;
    }
    if (!crowded) return { x: nx, y: ny };
  }
  return null;
}

/**
 * Samples the equation curve starting from the shooter's position,
 * validates it (oscillation limit / closed loops) and clips it at the
 * first collision (wall / obstacle / player / target).
 */
export function buildFlight(
  eq: ParsedEquation,
  sx: number,
  sy: number,
  dir: 1 | -1,
  opts: BuildOptions,
): FlightResult {
  const { settings, obstacles, players, shooterId, soloTargets } = opts;
  const shooter = players.find((p) => p.id === shooterId);
  const friendlyFireOff = settings.teams > 0 && shooter?.team !== undefined;
  const W = settings.mapW;
  const H = settings.mapH;
  const mapMin = Math.min(W, H);
  const step = mapMin / 700;
  const maxLen = 3 * (W + H);
  const maxJump = H * 0.8;
  const maxSteps = Math.ceil(maxLen / step);

  const pts: Pt[] = [{ x: sx, y: sy }];
  const vals: number[] = [];
  let length = 0;
  let hit: HitType = 'void';
  let hitPlayerId: number | undefined;
  let prevVal: number | null = null;

  // Пуля насквозь (настройка «игроков поражает пуля»): регистрируем каждую
  // жертву один раз и летим дальше — взрыв только о препятствие/стену/конец.
  const pierce = Math.max(1, Math.min(settings.pierce || 1, players.length || 1));
  const victims: VictimHit[] = [];
  const victimSeen = new Set<number>();

  // Два режима отсчёта (настройка лобби «Логика стрельбы»):
  //  · 'zero' (Zero point, по умолчанию) — нулевая точка в танке: координаты
  //    относительны стрелку, параметр t = 0 в точке танка, кривая
  //    y = f(x − sx) + (sy − f(0)) всегда проходит через стрелка, вершина
  //    параболы/центр формы — в игроке, а не в начале координат карты.
  //  · 'gw' (GW point) — старый вариант: x — абсолютная координата игрового
  //    мира, кривая вертикально смещается так, чтобы проходить через игрока
  //    (startVal = f(sx), смещение = sy − f(sx)).
  const gw = settings.shotMode === 'gw';
  const startV = eq.axis === 'y' ? sx : sy;
  const startVal = eq.evaluate(gw ? startV : 0);
  if (startVal === null) {
    return {
      ok: false,
      error: gw
        ? 'Функция не определена в точке игрока (f(x₀)) — смести аргумент, напр. y=1/(x−5)'
        : 'Функция не определена в точке игрока (f(0)) — смести аргумент, напр. y=1/(x−5)',
      points: pts,
      length: 0,
      hit,
    };
  }
  const offset = (eq.axis === 'y' ? sy : sx) - startVal;

  for (let i = 1; i <= maxSteps; i++) {
    const v = startV + dir * step * i;
    const raw = eq.evaluate(gw ? v : dir * step * i);
    if (raw === null) break; // undefined domain
    if (prevVal !== null && Math.abs(raw - prevVal) > maxJump) break; // asymptote jump
    const val = raw + offset;
    const p: Pt = eq.axis === 'y' ? { x: v, y: val } : { x: val, y: v };

    // Wall collision (world is -W/2..W/2 / -H/2..H/2)
    const hw = W / 2 - BULLET_R;
    const hh = H / 2 - BULLET_R;
    if (p.x < -hw || p.x > hw || p.y < -hh || p.y > hh) {
      hit = 'wall';
      break;
    }

    pts.push(p);
    vals.push(val);
    length += step;
    prevVal = raw;

    // На крутых участках (tan, 1/x, exp…) соседние точки далеко друг от друга,
    // и проверка только в точках «проскакивает» тонкие препятствия и игроков.
    // Разбиваем сегмент на подотрезки и проверяем столкновения вдоль всего пути.
    const q = pts[pts.length - 2];
    const segLen = Math.hypot(p.x - q.x, p.y - q.y);
    const sub = Math.min(96, Math.max(1, Math.ceil(segLen / 0.2)));

    for (let k = 1; k <= sub && hit === 'void'; k++) {
      const cx = q.x + ((p.x - q.x) * k) / sub;
      const cy = q.y + ((p.y - q.y) * k) / sub;

      // Player collision (never the shooter; в командном режиме — не по своим).
      // В мультиточках проверяем КАЖДУЮ точку игрока — подбить можно любую.
      for (const pl of players) {
        if (!pl.alive || pl.id === shooterId) continue;
        if (friendlyFireOff && pl.team === shooter!.team) continue;
        let touched = false;
        for (const pt of playerPoints(pl)) {
          if (Math.hypot(pt.x - cx, pt.y - cy) < PLAYER_R + BULLET_R) {
            touched = true;
            break;
          }
        }
        if (touched) {
          if (!victimSeen.has(pl.id)) {
            victimSeen.add(pl.id);
            victims.push({ id: pl.id, x: cx, y: cy });
          }
          if (pierce > 1) continue; // пробили игрока — летим дальше по тому же подотрезку
          hit = 'player';
          hitPlayerId = pl.id;
          break;
        }
      }
      if (hit !== 'void') break;

      // Solo targets
      if (soloTargets) {
        const ti = soloTargets.findIndex((t) => Math.hypot(t.x - cx, t.y - cy) < 0.9 + BULLET_R);
        if (ti >= 0) {
          const vid = -ti - 1;
          if (!victimSeen.has(vid)) {
            victimSeen.add(vid);
            victims.push({ id: vid, x: cx, y: cy });
          }
          if (pierce > 1) continue;
          hit = 'player';
          hitPlayerId = vid; // encode target index as negative
          break;
        }
      }

      // Obstacle collision
      if (obstacles.length && hitTestObstacles(obstacles, cx, cy, BULLET_R)) {
        hit = 'obstacle';
        break;
      }
    }
    if (hit !== 'void') break;
  }

  if (pts.length < 2) {
    return { ok: false, error: 'Кривая сразу уходит в неопределённость или за карту', points: pts, length: 0, hit };
  }

  // Отброс при попадании: только игроки (не цели), только когда жизней > 1.
  // Считается здесь, в детерминированном buildFlight — хост и гости получат
  // одну и ту же точку побега без пересылки позиций.
  if (victims.length && settings.fleeOnHit && settings.hitsToDie > 1) {
    for (const v of victims) {
      if (v.id < 0) continue;
      const f = fleeSpot(v.x, v.y, v.id, opts);
      if (f) v.flee = f;
    }
  }
  if (victims.length && hitPlayerId === undefined) hitPlayerId = victims[0].id;

  // Oscillation limit (per unit of travelled length)
  if (settings.oscillationLimit > 0) {
    const osc = countOscillations(vals);
    const density = osc / Math.max(length, 1e-6);
    if (density > settings.oscillationLimit) {
      return {
        ok: false,
        error: `Слишком колебательная кривая: ${density.toFixed(2)} колеб./ед. при лимите ${settings.oscillationLimit}`,
        points: pts,
        length,
        hit,
      };
    }
  }

  // Closed-loop check (when loops are forbidden by lobby settings)
  if (!settings.allowClosedLoops && hasClosedLoop(pts, mapMin)) {
    return {
      ok: false,
      error: 'Зацикленные маршруты (петли) запрещены настройками лобби',
      points: pts,
      length,
      hit,
    };
  }

  return { ok: true, points: pts, length, hit, hitPlayerId, victims: victims.length ? victims : undefined };
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

function pointInPolygon(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Точка свободна внутри отверстия: кратер входа или туннель (капсула). */
function freeInHole(h: DrillHole, px: number, py: number, r: number): boolean {
  const rad = h.r - r;
  if (rad <= 0) return false;
  if (Math.hypot(px - h.x, py - h.y) < rad) return true;
  if (h.depth > 0) {
    const ex = h.x + h.dx * h.depth;
    const ey = h.y + h.dy * h.depth;
    if (Math.hypot(px - ex, py - ey) < rad) return true;
    const t = (px - h.x) * h.dx + (py - h.y) * h.dy;
    if (t > 0 && t < h.depth) {
      const cx = h.x + h.dx * t;
      const cy = h.y + h.dy * t;
      if (Math.hypot(px - cx, py - cy) < rad) return true;
    }
  }
  return false;
}

function freeInHoles(holes: DrillHole[] | undefined, x: number, y: number, r: number): boolean {
  if (!holes) return false;
  for (const h of holes) {
    if (freeInHole(h, x, y, r)) return true;
  }
  return false;
}

/**
 * Съеденные отверстиями интервалы на отрезке [a, b] — параметры t ∈ [0, 1].
 * Используется и для проверки попаданий, и для отрисовки остатков ломаной.
 */
export function eatenIntervals(holes: DrillHole[] | undefined, ax: number, ay: number, bx: number, by: number): [number, number][] {
  const out: [number, number][] = [];
  if (!holes) return out;
  const abx = bx - ax;
  const aby = by - ay;
  const len = Math.hypot(abx, aby);
  if (len < 1e-9) return out;
  const lenSq = len * len;
  for (const h of holes) {
    // учитываем и кратер, и дальний конец туннеля
    for (const [hx, hy] of [[h.x, h.y], [h.x + h.dx * h.depth, h.y + h.dy * h.depth]] as const) {
      let t = ((hx - ax) * abx + (hy - ay) * aby) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + abx * t;
      const cy = ay + aby * t;
      const d = Math.hypot(hx - cx, hy - cy);
      if (d < h.r) {
        const half = Math.sqrt(Math.max(0, h.r * h.r - d * d)) / len;
        out.push([t - half, t + half]);
      }
    }
  }
  return out;
}

/** Точка (в параметре t на отрезке) съедена каким-либо интервалом. */
function inIntervals(iv: [number, number][], t: number): boolean {
  for (const [a, b] of iv) {
    if (t >= a && t <= b) return true;
  }
  return false;
}

/** Ближайшая точка отрезка в параметре t. */
function closestT(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-12) return 0;
  const t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  return Math.max(0, Math.min(1, t));
}

export function hitTestObstacles(obstacles: Obstacle[], x: number, y: number, r: number): boolean {
  for (const o of obstacles) {
    if (o.kind === 'circle') {
      if (Math.hypot(x - o.cx, y - o.cy) < o.r + r && !freeInHoles(o.holes, x, y, r)) return true;
    } else if (o.kind === 'rect') {
      if (Math.abs(x - o.cx) < o.w / 2 + r && Math.abs(y - o.cy) < o.h / 2 + r && !freeInHoles(o.holes, x, y, r)) return true;
    } else if (o.kind === 'poly') {
      for (let i = 0; i < o.pts.length - 1; i++) {
        const a = o.pts[i];
        const b = o.pts[i + 1];
        if (segDist(x, y, a.x, a.y, b.x, b.y) < r + 0.18) {
          // съеденный участок линии пулю не останавливает
          if (!inIntervals(eatenIntervals(o.gaps, a.x, a.y, b.x, b.y), closestT(x, y, a.x, a.y, b.x, b.y))) return true;
        }
      }
    } else {
      // closed bezier shape: inside or near boundary
      if (pointInPolygon(o.pts, x, y) && !freeInHoles(o.holes, x, y, r)) return true;
      for (let i = 0; i < o.pts.length; i++) {
        const a = o.pts[i];
        const b = o.pts[(i + 1) % o.pts.length];
        if (segDist(x, y, a.x, a.y, b.x, b.y) < r + 0.18) {
          if (!inIntervals(eatenIntervals(o.holes, a.x, a.y, b.x, b.y), closestT(x, y, a.x, a.y, b.x, b.y))) return true;
        }
      }
    }
  }
  return false;
}

// Прогрызание: радиус кратера нового отверстия, прирост глубины туннеля и радиуса за попадание.
export const GNAW_R = 0.5;
export const GNAW_STEP = 1.6;
export const GNAW_MAX = 1.4;
// туннель с радиусом ≥ GNAW_PASS свободно пропускает пулю (r пули 0.35)
export const GNAW_PASS = 0.9;

/**
 * Пробурить препятствие в точке попадания (x, y) в направлении полёта пули (dx, dy).
 * Попадание рядом с существующим отверстием углубляет его туннель на GNAW_STEP
 * и немного расширяет; иначе пробивается новый кратер.
 */
export function drillObstacle(o: Obstacle, x: number, y: number, dx: number, dy: number): Obstacle {
  const list: DrillHole[] = [...(o.kind === 'poly' ? (o.gaps ?? []) : (o.holes ?? []))];
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const h = list[i];
    const ex = h.x + h.dx * h.depth;
    const ey = h.y + h.dy * h.depth;
    const d = Math.min(Math.hypot(h.x - x, h.y - y), Math.hypot(ex - x, ey - y));
    if (d < h.r + 0.6 && d < bestD) {
      best = i;
      bestD = d;
    }
  }
  if (best >= 0) {
    const h = list[best];
    list[best] = { ...h, depth: h.depth + GNAW_STEP, r: Math.min(GNAW_MAX, h.r + 0.25) };
  } else {
    list.push({ x, y, r: GNAW_R, dx, dy, depth: 0 });
  }
  return o.kind === 'poly' ? { ...o, gaps: list } : { ...o, holes: list };
}
