import type { MatchSettings, Obstacle, Pt } from './types';
import { hitTestObstacles } from './trajectory';

export function spawnPositions(s: MatchSettings, n: number): Pt[] {
  const pts: Pt[] = [];
  const base = (s.spawnSpread / 100) * Math.min(s.mapW, s.mapH) * 0.9;
  for (let i = 0; i < n; i++) {
    let minDist = base;
    let placed = false;
    for (let attempt = 0; attempt < 3000 && !placed; attempt++) {
      if (attempt > 0 && attempt % 300 === 0) minDist *= 0.85;
      const p: Pt = {
        x: (Math.random() - 0.5) * (s.mapW - 8),
        y: (Math.random() - 0.5) * (s.mapH - 8),
      };
      if (pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= minDist)) {
        pts.push(p);
        placed = true;
      }
    }
    if (!placed) {
      pts.push({ x: (Math.random() - 0.5) * (s.mapW - 8), y: (Math.random() - 0.5) * (s.mapH - 8) });
    }
  }
  return pts;
}

export function spawnTargets(s: MatchSettings, count: number, existing: Pt[], obstacles: Obstacle[] = [], avoid: Pt[] = []): Pt[] {
  const out: Pt[] = [];
  let attempts = 0;
  while (out.length < count && attempts < count * 100) {
    attempts++;
    const p: Pt = {
      x: (Math.random() - 0.5) * (s.mapW - 10),
      y: (Math.random() - 0.5) * (s.mapH - 10),
    };
    if (Math.hypot(p.x, p.y) < 7) continue; // keep clear of the player at center
    if (avoid.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 7)) continue; // и от точек игрока (мультиточки)
    if ([...existing, ...out].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 3.5)) continue;
    // не спавнить внутри препятствий и вплотную к ним (радиус цели + зазор)
    if (hitTestObstacles(obstacles, p.x, p.y, 1.7)) continue;
    out.push(p);
  }
  return out;
}
