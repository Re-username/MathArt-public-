import type { MatchSettings, Obstacle, ObstacleTypeKey, Pt } from './types';
import { hitTestObstacles } from './trajectory';

function cubicBezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, segments: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return out;
}

/** Closed smooth curve through points via Catmull-Rom → cubic segments. */
function closedSpline(pts: Pt[], segPerSpan = 10): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    const seg = cubicBezier(p1, c1, c2, p3, segPerSpan);
    out.push(...seg.slice(0, -1));
  }
  return out;
}

function makeObstacle(type: ObstacleTypeKey, cx: number, cy: number, base: number, rng: () => number): Obstacle {
  switch (type) {
    case 'circles':
      return { kind: 'circle', cx, cy, r: base * (0.4 + rng() * 0.6) };
    case 'squares': {
      const s = base * (0.8 + rng() * 0.7);
      return { kind: 'rect', cx, cy, w: s, h: s };
    }
    case 'polylines': {
      // Зигзаги разной «нервности»: от плавных дуг до резких молний
      const pts: Pt[] = [{ x: cx, y: cy }];
      let ang = rng() * Math.PI * 2;
      const segs = 3 + Math.floor(rng() * 5); // 3–7 сегментов
      const wildness = 0.9 + rng() * 1.9; // сила изломов
      for (let i = 0; i < segs; i++) {
        ang += (rng() - 0.5) * wildness;
        if (rng() < 0.18) ang += (rng() < 0.5 ? 1 : -1) * (1.4 + rng()); // редкий резкий разворот
        const last = pts[pts.length - 1];
        const len = base * (0.35 + rng() * 1.25);
        pts.push({ x: last.x + Math.cos(ang) * len, y: last.y + Math.sin(ang) * len });
      }
      return { kind: 'poly', pts };
    }
    case 'beziers': {
      // Свободная ориентация и контрольные точки в широком диапазоне:
      // дуги, S-образные, крюки, почти петли
      const rot = rng() * Math.PI * 2;
      const span = base * (0.9 + rng() * 0.9);
      const ux = Math.cos(rot);
      const uy = Math.sin(rot);
      const px = -uy; // перпендикуляр
      const py = ux;
      const spread = () => (rng() - 0.5) * base * 3.4;
      const along = () => (rng() - 0.5) * base * 1.2;
      const p0 = { x: cx - ux * span + px * spread() * 0.4, y: cy - uy * span + py * spread() * 0.4 };
      const p3 = { x: cx + ux * span + px * spread() * 0.4, y: cy + uy * span + py * spread() * 0.4 };
      const t1 = 0.15 + rng() * 0.35;
      const t2 = 0.5 + rng() * 0.35;
      const p1 = { x: cx + ux * span * (t1 * 2 - 1) + px * (spread() + along()), y: cy + uy * span * (t1 * 2 - 1) + py * (spread() + along()) };
      const p2 = { x: cx + ux * span * (t2 * 2 - 1) + px * (spread() - along()), y: cy + uy * span * (t2 * 2 - 1) + py * (spread() - along()) };
      return { kind: 'poly', pts: cubicBezier(p0, p1, p2, p3, 20 + Math.floor(rng() * 14)) };
    }
    case 'closedBeziers': {
      const roll = rng();
      const rot = rng() * Math.PI * 2;
      if (roll < 0.35) {
        // ЗВЕЗДА: чередование острых внешних вершин и глубоких внутренних
        const tips = 5 + Math.floor(rng() * 4); // 5–8 лучей
        const R = base * (0.8 + rng() * 0.6);
        const innerK = 0.28 + rng() * 0.25; // глубина впадин
        const ring: Pt[] = [];
        for (let i = 0; i < tips; i++) {
          const a = rot + (i / tips) * Math.PI * 2 + (rng() - 0.5) * 0.12;
          const rO = R * (0.85 + rng() * 0.3);
          ring.push({ x: cx + Math.cos(a) * rO, y: cy + Math.sin(a) * rO });
          const am = a + Math.PI / tips;
          const rI = R * innerK * (0.85 + rng() * 0.3);
          ring.push({ x: cx + Math.cos(am) * rI, y: cy + Math.sin(am) * rI });
        }
        return { kind: 'shape', pts: ring }; // без сглаживания — острые лучи
      }
      const n = 4 + Math.floor(rng() * 4); // 4–7 опорных точек
      const ring: Pt[] = [];
      if (roll < 0.75) {
        // РАСТЯНУТАЯ форма: разный масштаб по осям + поворот (эллипсоподобные блобы)
        const sx = 0.55 + rng() * 0.95;
        const sy = 0.55 + rng() * 0.95;
        const angJit = 0.4 * rng();
        for (let i = 0; i < n; i++) {
          const a = rot + (i / n) * Math.PI * 2 + (rng() - 0.5) * angJit;
          const r = base * (0.4 + rng() * 0.95);
          const ex = Math.cos(a) * r * sx;
          const ey = Math.sin(a) * r * sy;
          ring.push({ x: cx + ex * Math.cos(rot) - ey * Math.sin(rot), y: cy + ex * Math.sin(rot) + ey * Math.cos(rot) });
        }
      } else {
        // обычный блоб
        const angJit = 0.35 * rng();
        for (let i = 0; i < n; i++) {
          const a = rot + (i / n) * Math.PI * 2 + (rng() - 0.5) * angJit;
          const r = base * (0.4 + rng() * 0.95);
          ring.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
      }
      return { kind: 'shape', pts: closedSpline(ring, 10) };
    }
  }
}

function obstacleCenter(o: Obstacle): Pt {
  if (o.kind === 'circle' || o.kind === 'rect') return { x: o.cx, y: o.cy };
  let sx = 0;
  let sy = 0;
  for (const p of o.pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / o.pts.length, y: sy / o.pts.length };
}

/** Радиус описанной окружности препятствия — для грубой проверки наложений. */
function boundingRadius(o: Obstacle): number {
  if (o.kind === 'circle') return o.r;
  if (o.kind === 'rect') return Math.hypot(o.w, o.h) / 2;
  const c = obstacleCenter(o);
  let m = 0;
  for (const p of o.pts) m = Math.max(m, Math.hypot(p.x - c.x, p.y - c.y));
  return m;
}

export function generateObstacles(s: MatchSettings, safePoints: Pt[], rng: () => number = Math.random): Obstacle[] {
  if (!s.obstaclesEnabled) return [];
  const types = (Object.keys(s.obstacles) as ObstacleTypeKey[]).filter((k) => s.obstacles[k].count > 0);
  if (types.length === 0) return [];

  const list: Obstacle[] = [];
  const listCenters: Pt[] = [];
  const listRadii: number[] = [];
  const margin = 4;
  const GAP = 0.9; // минимальный зазор между препятствиями

  for (const type of types) {
    const cfg = s.obstacles[type];
    let placed = 0;
    let attempts = 0;
    const maxAttempts = cfg.count * 60;
    while (placed < cfg.count && attempts < maxAttempts) {
      attempts++;
      const cx = -s.mapW / 2 + margin + rng() * (s.mapW - 2 * margin);
      const cy = -s.mapH / 2 + margin + rng() * (s.mapH - 2 * margin);
      const base = cfg.size * (2 + rng() * 3);
      const obs = makeObstacle(type, cx, cy, base, rng);
      const c = obstacleCenter(obs);
      const clearance = base + 3.5;
      if (safePoints.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < clearance)) continue;
      // keep inside map loosely
      if (Math.abs(c.x) > s.mapW / 2 - 1 || Math.abs(c.y) > s.mapH / 2 - 1) continue;
      // не накладываться на уже поставленные (проверка по описанным окружностям)
      const r = boundingRadius(obs);
      let overlaps = false;
      for (let i = 0; i < list.length; i++) {
        if (Math.hypot(listCenters[i].x - c.x, listCenters[i].y - c.y) < listRadii[i] + r + GAP) { overlaps = true; break; }
      }
      if (overlaps) continue;
      list.push(obs);
      listCenters.push(c);
      listRadii.push(r);
      placed++;
    }
  }
  return list;
}

/**
 * Достижимость на грубой сетке: между каждой парой спавнов должен существовать
 * коридор шириной ~2 ед. (в него заведомо влезает траектория-график функции).
 * BFS по 8-связной сетке от первого спавна до всех остальных.
 */
function allPairsReachable(obstacles: Obstacle[], pts: Pt[], W: number, H: number): boolean {
  if (pts.length < 2 || obstacles.length === 0) return true;
  const NX = 72;
  const NY = Math.max(24, Math.round((NX * H) / W));
  const blocked = new Uint8Array(NX * NY);
  for (let gy = 0; gy < NY; gy++) {
    for (let gx = 0; gx < NX; gx++) {
      const x = -W / 2 + ((gx + 0.5) * W) / NX;
      const y = -H / 2 + ((gy + 0.5) * H) / NY;
      if (hitTestObstacles(obstacles, x, y, 1.0)) blocked[gy * NX + gx] = 1;
    }
  }
  const cellOf = (p: Pt): number => {
    const gx = Math.min(NX - 1, Math.max(0, Math.floor(((p.x + W / 2) / W) * NX)));
    const gy = Math.min(NY - 1, Math.max(0, Math.floor(((p.y + H / 2) / H) * NY)));
    return gy * NX + gx;
  };
  const start = cellOf(pts[0]);
  if (blocked[start]) return false;
  const seen = new Uint8Array(NX * NY);
  seen[start] = 1;
  const queue = [start];
  const targets = new Set(pts.slice(1).map(cellOf));
  targets.delete(start);
  while (queue.length && targets.size) {
    const cur = queue.pop()!;
    const cx = cur % NX;
    const cy = (cur / NX) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= NX || ny < 0 || ny >= NY) continue;
        const ni = ny * NX + nx;
        if (seen[ni] || blocked[ni]) continue;
        seen[ni] = 1;
        targets.delete(ni);
        queue.push(ni);
      }
    }
  }
  return targets.size === 0;
}

/**
 * Генерирует препятствия, гарантируя, что все спавны достижимы друг из друга.
 * Сначала несколько свежих попыток; если карта слишком плотная — случайно
 * убирает препятствия, пока проход не появится (в пределе — пустая карта).
 */
export function generateObstaclesSolvable(s: MatchSettings, safePoints: Pt[], rng: () => number = Math.random): Obstacle[] {
  if (!s.ensureReachable) return generateObstacles(s, safePoints, rng);
  let last: Obstacle[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    last = generateObstacles(s, safePoints, rng);
    if (last.length === 0 || allPairsReachable(last, safePoints, s.mapW, s.mapH)) return last;
  }
  // плотная карта: выкидываем препятствия, пока не появится коридор
  const list = [...last];
  while (list.length > 0 && !allPairsReachable(list, safePoints, s.mapW, s.mapH)) {
    list.splice(Math.floor(rng() * list.length), 1);
  }
  return list;
}
