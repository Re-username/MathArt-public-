import type { DrillHole, GamePlayer, Obstacle, Pt, ThemeName } from './types';
import { playerColor } from './types';
import { PLAYER_R, eatenIntervals } from './trajectory';
import type { Theme } from './theme';

// масштаб шрифта интерфейса: базовый rem (16px = x1). Следует за настройкой
// «масштаб интерфейса», чтобы канвасные подписи росли вместе с UI-шрифтами.
function uiFontScale(): number {
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(fs) && fs > 0 ? fs / 16 : 1;
}

export interface Trail {
  pts: Pt[];
  color: string;
  alpha: number;
  upto?: number; // draw only pts[0..upto] (progressive bullet trail)
  fade?: boolean;
}

export interface Bullet {
  pts: Pt[];
  idx: number; // float index along pts
  color: string;
}

export interface Explosion {
  x: number;
  y: number;
  age: number; // seconds
  color: string;
  big: boolean;
}

export interface Scene {
  W: number;
  H: number;
  players: GamePlayer[];
  obstacles: Obstacle[];
  /** максимальная прочность препятствий (0 — неразрушаемы) */
  obstacleMaxHp: number;
  trails: Trail[];
  preview: Pt[] | null;
  previewColor: string;
  bullet: Bullet | null;
  explosions: Explosion[];
  targets: Pt[];
  activeId: number | null;
  time: number; // global clock for pulsing
  /** порядковый номер выстрела — зерно детерминированных эффектов (отброс при попадании) */
  shotNumber: number;
}

export interface View {
  scale: number;
  ox: number;
  oy: number;
}

export function computeView(W: number, H: number, cw: number, ch: number, pad: number): View {
  const scale = Math.min((cw - 2 * pad) / W, (ch - 2 * pad) / H);
  return { scale, ox: cw / 2, oy: ch / 2 };
}

/** Fit-scale of the map into the viewport (zoom = 1). */
export function fitScale(W: number, H: number, cw: number, ch: number, pad: number): number {
  return Math.min((cw - 2 * pad) / W, (ch - 2 * pad) / H);
}

/** View zoomed around the world-space center (cx, cy). */
export function zoomView(W: number, H: number, cw: number, ch: number, pad: number, zoom: number, cx: number, cy: number): View {
  const scale = fitScale(W, H, cw, ch, pad) * zoom;
  return { scale, ox: cw / 2 - cx * scale, oy: ch / 2 + cy * scale };
}

/** Clamp the zoom center so the viewport never leaves the map. */
export function clampViewCenter(W: number, H: number, cw: number, ch: number, pad: number, zoom: number, cx: number, cy: number): Pt {
  const scale = fitScale(W, H, cw, ch, pad) * zoom;
  const vw = cw / scale;
  const vh = ch / scale;
  const x = vw >= W ? 0 : Math.max(-(W - vw) / 2, Math.min((W - vw) / 2, cx));
  const y = vh >= H ? 0 : Math.max(-(H - vh) / 2, Math.min((H - vh) / 2, cy));
  return { x, y };
}

export function toScreen(v: View, p: Pt): Pt {
  return { x: v.ox + p.x * v.scale, y: v.oy - p.y * v.scale };
}

const MONO = 'Menlo, Monaco, Consolas, "Droid Sans Mono", monospace';

function drawGrid(g: CanvasRenderingContext2D, scene: Scene, v: View, t: Theme, cw: number, ch: number): void {
  g.fillStyle = t.bg;
  g.fillRect(0, 0, cw, ch);

  // Moving light wave drifting under the grid
  const wx = Math.sin(scene.time * 0.35) * scene.W * 0.28;
  const wy = Math.cos(scene.time * 0.23) * scene.H * 0.28;
  const wc = toScreen(v, { x: wx, y: wy });
  const wr = Math.max(scene.W, scene.H) * v.scale * 0.75;
  const grad = g.createRadialGradient(wc.x, wc.y, 0, wc.x, wc.y, wr);
  grad.addColorStop(0, t.waveCore);
  grad.addColorStop(0.5, t.waveMid);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, cw, ch);

  const step = 5;
  const x0 = -scene.W / 2;
  const x1 = scene.W / 2;
  const y0 = -scene.H / 2;
  const y1 = scene.H / 2;

  g.lineWidth = 1;
  g.strokeStyle = t.grid;
  g.beginPath();
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    const sx = v.ox + x * v.scale;
    g.moveTo(sx, v.oy - y0 * v.scale);
    g.lineTo(sx, v.oy - y1 * v.scale);
  }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    const sy = v.oy - y * v.scale;
    g.moveTo(v.ox + x0 * v.scale, sy);
    g.lineTo(v.ox + x1 * v.scale, sy);
  }
  g.stroke();

  // Axes through origin
  g.strokeStyle = t.axis;
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(v.ox + x0 * v.scale, v.oy);
  g.lineTo(v.ox + x1 * v.scale, v.oy);
  g.moveTo(v.ox, v.oy - y0 * v.scale);
  g.lineTo(v.ox, v.oy - y1 * v.scale);
  g.stroke();

  // Map border
  g.strokeStyle = t.axis;
  g.lineWidth = 1.6;
  g.shadowColor = t.accent;
  g.shadowBlur = 10;
  const tl = toScreen(v, { x: x0, y: y1 });
  g.strokeRect(tl.x, tl.y, scene.W * v.scale, scene.H * v.scale);
  g.shadowBlur = 0;

  // Coordinate labels along axes
  g.fillStyle = t.axisLabel;
  g.font = `${10 * uiFontScale()}px ${MONO}`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    if (x === 0) continue;
    g.fillText(String(x), v.ox + x * v.scale, v.oy + 14);
  }
  g.textAlign = 'right';
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    if (y === 0) continue;
    g.fillText(String(y), v.ox - 6, v.oy - y * v.scale + 3);
  }
}

// Слои для пробитых препятствий — ОТДЕЛЬНЫЙ слой на каждый целевой canvas
// (главный и миникарта): если держать один слой на оба, его размер пересоздаётся
// каждый кадр при чередовании контекстов → шторм аллокаций и зависание рендера.
const punchLayers = new WeakMap<HTMLCanvasElement, { layer: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>();

function drawObstacles(g: CanvasRenderingContext2D, scene: Scene, v: View, t: Theme): void {
  g.fillStyle = t.obstacleFill;
  g.lineWidth = 1.5;
  const maxHp = scene.obstacleMaxHp || 0;
  // Пробуренные отверстия вырезаются из заливки И обводки на отдельном слое.
  // evenodd-подход не подходит: при нескольких пересекающихся отверстиях их
  // пересечение по чётности закрашивалось обратно («остаётся внутренняя
  // закрашенная часть»). destination-out прямо на сцене тоже нельзя — стирал
  // бы сетку под дырой. Поэтому: слой с заливкой+контуром, капсулы отверстий
  // стираются из слоя (в пересечениях остаётся прозрачно — Union как в физике,
  // где freeInHole работает по «или»), слой накладывается на сцену: сквозь
  // дыру просвечивает сетка, а граница объекта прерывается у пробоин сама
  // собой. Слой в device-пикселях: трансформа dpr копируется, наложение —
  // под единичной (клип рамки карты при этом сохраняется).
  // Форма проёма — капсула: кратер входа + туннель.
  const capsulePath = (path: Path2D, h: DrillHole) => {
    const c0 = toScreen(v, h);
    const c1 = toScreen(v, { x: h.x + h.dx * h.depth, y: h.y + h.dy * h.depth });
    const rpx = h.r * v.scale;
    path.moveTo(c0.x + rpx, c0.y);
    path.arc(c0.x, c0.y, rpx, 0, Math.PI * 2);
    if (h.depth > 0) {
      path.moveTo(c1.x + rpx, c1.y);
      path.arc(c1.x, c1.y, rpx, 0, Math.PI * 2);
      const nx = -h.dy;
      const ny = h.dx;
      path.moveTo(c0.x + nx * rpx, c0.y + ny * rpx);
      path.lineTo(c1.x + nx * rpx, c1.y + ny * rpx);
      path.lineTo(c1.x - nx * rpx, c1.y - ny * rpx);
      path.lineTo(c0.x - nx * rpx, c0.y - ny * rpx);
      path.closePath();
    }
  };
  const drawPunched = (outer: Path2D, holes: DrillHole[] | undefined) => {
    const hs = holes ?? [];
    if (hs.length === 0) {
      g.fill(outer);
      g.stroke(outer);
      return;
    }
    const cv = g.canvas;
    let entry = punchLayers.get(cv);
    if (!entry || entry.layer.width !== cv.width || entry.layer.height !== cv.height) {
      const layer = document.createElement('canvas');
      layer.width = cv.width;
      layer.height = cv.height;
      entry = { layer, ctx: layer.getContext('2d')! };
      punchLayers.set(cv, entry);
    }
    const og = entry.ctx;
    og.setTransform(1, 0, 0, 1, 0, 0);
    og.clearRect(0, 0, entry.layer.width, entry.layer.height);
    og.setTransform(g.getTransform());
    og.fillStyle = g.fillStyle;
    og.fill(outer);
    og.lineWidth = g.lineWidth;
    og.strokeStyle = g.strokeStyle;
    og.stroke(outer);
    // капсулы отверстий: минус из слоя (пересечения стираются полностью)
    og.globalCompositeOperation = 'destination-out';
    og.fillStyle = '#000';
    const hp = new Path2D();
    for (const h of hs) capsulePath(hp, h);
    og.fill(hp);
    og.globalCompositeOperation = 'source-over';
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(entry.layer, 0, 0);
    g.restore();
  };
  for (const o of scene.obstacles) {
    // повреждённое (но ещё живое) препятствие подсвечиваем акцентным цветом
    g.strokeStyle = maxHp > 0 && (o.hp ?? maxHp) < maxHp ? t.accent : t.obstacle;
    if (o.kind === 'circle') {
      const c = toScreen(v, { x: o.cx, y: o.cy });
      const path = new Path2D();
      path.arc(c.x, c.y, o.r * v.scale, 0, Math.PI * 2);
      drawPunched(path, o.holes);
    } else if (o.kind === 'rect') {
      const c = toScreen(v, { x: o.cx - o.w / 2, y: o.cy + o.h / 2 });
      const path = new Path2D();
      path.rect(c.x, c.y, o.w * v.scale, o.h * v.scale);
      drawPunched(path, o.holes);
    } else if (o.kind === 'poly') {
      // съеденные отверстиями участки линии не рисуем — рисуем видимые интервалы
      g.beginPath();
      for (let i = 0; i < o.pts.length - 1; i++) {
        const a = o.pts[i];
        const b = o.pts[i + 1];
        const ivs = eatenIntervals(o.gaps, a.x, a.y, b.x, b.y).sort((p, q) => p[0] - q[0]);
        let t = 0;
        const parts: [number, number][] = [];
        for (const [s, e] of ivs) {
          if (s > t) parts.push([t, s]);
          t = Math.max(t, e);
        }
        if (t < 1) parts.push([t, 1]);
        for (const [t0, t1] of parts) {
          const p0 = toScreen(v, { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 });
          const p1 = toScreen(v, { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 });
          g.moveTo(p0.x, p0.y);
          g.lineTo(p1.x, p1.y);
        }
      }
      g.stroke();
    } else {
      const path = new Path2D();
      o.pts.forEach((p, i) => {
        const s = toScreen(v, p);
        if (i === 0) path.moveTo(s.x, s.y);
        else path.lineTo(s.x, s.y);
      });
      path.closePath();
      drawPunched(path, o.holes);
    }
  }
}

function strokeCurve(g: CanvasRenderingContext2D, v: View, pts: Pt[], color: string, alpha: number, width: number, dashed = false, upto?: number): void {
  const n = upto === undefined ? pts.length : Math.min(pts.length, Math.max(0, Math.floor(upto) + 1));
  if (n < 2) return;
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.shadowColor = color;
  g.shadowBlur = 8;
  g.lineJoin = 'round';
  if (dashed) g.setLineDash([6, 5]);
  g.beginPath();
  const s0 = toScreen(v, pts[0]);
  g.moveTo(s0.x, s0.y);
  for (let i = 1; i < n; i++) {
    const s = toScreen(v, pts[i]);
    g.lineTo(s.x, s.y);
  }
  g.stroke();
  g.restore();
}

function drawPlayers(g: CanvasRenderingContext2D, scene: Scene, v: View, themeName: ThemeName): void {
  for (const p of scene.players) {
    const s = toScreen(v, p);
    const r = Math.max(PLAYER_R * v.scale, 7);
    const color = playerColor(p.colorIdx, themeName);
    if (p.alive) {
      // мультиточки: неактивные точки — приглушённые спутники без пульсации.
      // activeIdx −1 — активная точка только что подбита: все точки приглушены
      const ai = p.activeIdx >= 0 && p.activeIdx < p.points.length ? p.activeIdx : -1;
      if (p.points.length > 1) {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        p.points.forEach((pt, i) => {
          if (i === ai) return;
          const ps = toScreen(v, pt);
          const pr = Math.max(PLAYER_R * v.scale * 0.72, 5);
          g.save();
          g.globalAlpha = 0.5;
          g.fillStyle = color;
          g.beginPath();
          g.arc(ps.x, ps.y, pr, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(0,0,0,0.6)';
          g.font = `bold ${Math.max(pr, 8) * uiFontScale()}px ${MONO}`;
          g.fillText(p.name.slice(0, 1).toUpperCase() || '?', ps.x, ps.y + 1);
          g.restore();
        });
      }
      // активная точка — полный танк; если подбита (ai=−1) — рисуются только приглушённые
      if (ai >= 0) {
        g.save();
        g.shadowColor = color;
        g.shadowBlur = 14;
        g.fillStyle = color;
        g.beginPath();
        g.arc(s.x, s.y, r, 0, Math.PI * 2);
        g.fill();
        g.restore();
        // active player pulsing ring
        if (scene.activeId === p.id) {
          const pulse = 1 + 0.25 * Math.sin(scene.time * 5);
          g.strokeStyle = color;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(s.x, s.y, r * 1.7 * pulse, 0, Math.PI * 2);
          g.stroke();
        }
        // initial letter
        g.fillStyle = '#000';
        g.font = `bold ${Math.max(r, 10) * uiFontScale()}px ${MONO}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(p.name.slice(0, 1).toUpperCase() || '?', s.x, s.y + 1);
        // hp pips
        if (p.hp > 1) {
          g.fillStyle = color;
          for (let i = 0; i < p.hp; i++) {
            g.fillRect(s.x - p.hp * 4 + i * 8, s.y + r + 5, 6, 3);
          }
        }
      }
    } else {
      // dead: hollow crossed marker
      g.strokeStyle = 'rgba(128,128,140,0.6)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(s.x, s.y, r * 0.8, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(s.x - r * 0.6, s.y - r * 0.6);
      g.lineTo(s.x + r * 0.6, s.y + r * 0.6);
      g.moveTo(s.x + r * 0.6, s.y - r * 0.6);
      g.lineTo(s.x - r * 0.6, s.y + r * 0.6);
      g.stroke();
    }
  }
}

function drawTargets(g: CanvasRenderingContext2D, scene: Scene, v: View, t: Theme): void {
  const pulse = 1 + 0.15 * Math.sin(scene.time * 4);
  for (const tg of scene.targets) {
    const s = toScreen(v, tg);
    const r = Math.max(0.9 * v.scale, 6) * pulse;
    g.save();
    g.strokeStyle = t.target;
    g.shadowColor = t.target;
    g.shadowBlur = 10;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.x, s.y - r);
    g.lineTo(s.x + r, s.y);
    g.lineTo(s.x, s.y + r);
    g.lineTo(s.x - r, s.y);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(s.x, s.y, r * 0.35, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
}

function drawExplosions(g: CanvasRenderingContext2D, scene: Scene, v: View, t: Theme): void {
  for (const e of scene.explosions) {
    const s = toScreen(v, e);
    const life = e.big ? 0.8 : 0.5;
    const k = e.age / life;
    if (k >= 1) continue;
    const r = (e.big ? 3.2 : 1.8) * v.scale * k;
    const alpha = 1 - k;
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = e.color;
    g.shadowColor = e.color;
    g.shadowBlur = 16;
    g.lineWidth = 3 * (1 - k) + 0.5;
    g.beginPath();
    g.arc(s.x, s.y, Math.max(r, 1), 0, Math.PI * 2);
    g.stroke();
    // sparks
    g.fillStyle = t.bullet;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + e.age * 3;
      const d = r * 1.3;
      g.fillRect(s.x + Math.cos(a) * d - 1, s.y + Math.sin(a) * d - 1, 2, 2);
    }
    g.restore();
  }
}

function drawBullet(g: CanvasRenderingContext2D, scene: Scene, v: View, t: Theme): void {
  const b = scene.bullet;
  if (!b) return;
  const i = Math.min(Math.floor(b.idx), b.pts.length - 1);
  const p = toScreen(v, b.pts[i]);
  g.save();
  g.shadowColor = b.color;
  g.shadowBlur = 18;
  g.fillStyle = b.color;
  g.beginPath();
  g.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = t.bullet;
  g.beginPath();
  g.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export interface DrawOpts {
  viewRect?: { x: number; y: number; w: number; h: number }; // world-space rect of the current main view (minimap)
  finishMarker?: boolean; // draw predicted impact marker at preview end
}

export function drawScene(
  g: CanvasRenderingContext2D,
  scene: Scene,
  v: View,
  t: Theme,
  themeName: ThemeName,
  cw: number,
  ch: number,
  withGrid = true,
  opts: DrawOpts = {},
): void {
  g.clearRect(0, 0, cw, ch);
  if (withGrid) {
    drawGrid(g, scene, v, t, cw, ch);
  } else {
    g.fillStyle = t.bg;
    g.fillRect(0, 0, cw, ch);
  }
  // Объекты мира обрезаются рамкой карты: части препятствий/траекторий за её
  // пределами не рисуются (генератор держит внутри только центры фигур).
  if (withGrid) {
    const mtl = toScreen(v, { x: -scene.W / 2, y: scene.H / 2 });
    g.save();
    g.beginPath();
    g.rect(mtl.x, mtl.y, scene.W * v.scale, scene.H * v.scale);
    g.clip();
  }
  drawObstacles(g, scene, v, t);
  for (const trail of scene.trails) {
    strokeCurve(g, v, trail.pts, trail.color, trail.alpha * 0.85, 2.2, false, trail.upto);
  }
  if (scene.preview && scene.preview.length > 1) {
    strokeCurve(g, v, scene.preview, scene.previewColor, 0.45, 1.6, true);
    if (opts.finishMarker) {
      const end = toScreen(v, scene.preview[scene.preview.length - 1]);
      g.save();
      g.strokeStyle = t.accent2;
      g.shadowColor = t.accent2;
      g.shadowBlur = 8;
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(end.x, end.y, 7, 0, Math.PI * 2);
      g.moveTo(end.x - 11, end.y);
      g.lineTo(end.x + 11, end.y);
      g.moveTo(end.x, end.y - 11);
      g.lineTo(end.x, end.y + 11);
      g.stroke();
      g.restore();
    }
  }
  drawTargets(g, scene, v, t);
  drawPlayers(g, scene, v, themeName);
  drawBullet(g, scene, v, t);
  drawExplosions(g, scene, v, t);
  if (withGrid) g.restore(); // конец клипа рамки карты

  if (opts.viewRect) {
    const r = opts.viewRect;
    const tl = toScreen(v, { x: r.x, y: r.y + r.h });
    g.save();
    g.strokeStyle = t.accent2;
    g.lineWidth = 1.5;
    g.setLineDash([4, 3]);
    g.strokeRect(tl.x, tl.y, r.w * v.scale, r.h * v.scale);
    g.restore();
  }
}
