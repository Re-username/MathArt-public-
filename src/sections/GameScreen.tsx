import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GamePlayer, GameSettings, MatchSettings, PlayerDef } from '../game/types';
import { obstacleMaxHp, playerColor } from '../game/types';
import { parseEquation, type Axis } from '../game/parser';
import { latexToEquation } from '../game/latex';
import { buildFlight, drillObstacle, hitTestObstacles, pickActiveIdx, type HitType, type VictimHit } from '../game/trajectory';
import { generateObstaclesSolvable } from '../game/obstacles';
import { spawnPositions, spawnTargets } from '../game/spawn';
import { clampViewCenter, computeView, drawScene, fitScale, zoomView, type Scene } from '../game/render';
import { THEMES } from '../game/theme';
import { sfx } from '../game/sound';
import EquationPanel, { type EqStatus } from '../components/EquationPanel';
import type { HostSession, GuestSession } from '../net/session';
import type { NetWorld } from './NetHostLobby';

type NetSide = { role: 'host'; session: HostSession } | { role: 'guest'; session: GuestSession };

interface Props {
  mode: 'multi' | 'solo';
  settings: MatchSettings;
  playerDefs: PlayerDef[];
  gameSettings: GameSettings;
  net?: NetSide;
  initialWorld?: NetWorld;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onExit: () => void;
}

interface GameScene extends Scene {
  phase: 'aim' | 'flying' | 'over';
  turnId: number | null;
  timeLeft: number | null;
  score: number;
  winner: GamePlayer | null;
  pendingHit: { hit: HitType; hitPlayerId?: number; victims?: VictimHit[] } | null;
  bannerText: string;
  bannerKey: number;
  bloodKey: number;
  stepWorld: number;
}

interface Hud {
  phase: GameScene['phase'];
  turnId: number | null;
  timeLeft: number | null;
  score: number;
  winner: GamePlayer | null;
  players: GamePlayer[];
  targetsLeft: number;
  bannerText: string;
  bannerKey: number;
  bloodKey: number;
  zoom: number;
}

function nextAliveId(players: GamePlayer[], fromId: number | null): number | null {
  const alive = players.filter((p) => p.alive);
  if (alive.length === 0) return null;
  if (fromId === null) return alive[0].id;
  const idx = players.findIndex((p) => p.id === fromId);
  for (let k = 1; k <= players.length; k++) {
    const p = players[(idx + k) % players.length];
    if (p.alive) return p.id;
  }
  return null;
}

const HIT_LABEL: Record<HitType, string> = {
  wall: 'стена карты',
  obstacle: 'препятствие',
  player: 'ЦЕЛЬ!',
  void: 'обрыв функции',
};

export default function GameScreen({ mode, settings, playerDefs, gameSettings, net, initialWorld, onOpenSettings, onOpenHelp, onExit }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const gsRef = useRef(gameSettings);
  gsRef.current = gameSettings;
  const netRef = useRef(net);
  netRef.current = net;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  // camera: zoom 1 = whole map; cx/cy = world coords of the viewport center
  const viewRef = useRef({ zoom: 1, cx: 0, cy: 0 });

  const myId: number | null = net ? (net.role === 'host' ? 0 : net.session.myId) : null;

  const sceneRef = useRef<GameScene | null>(null);
  if (!sceneRef.current) {
    sceneRef.current = { bannerText: '', bannerKey: 0, bloodKey: 0 } as GameScene;
  }
  // отладочный доступ для E2E-тестов
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__scene = sceneRef;
  }

  const syncRef = useRef<() => void>(() => {});
  const [hud, setHud] = useState<Hud>({
    phase: 'aim',
    turnId: null,
    timeLeft: null,
    score: 0,
    winner: null,
    players: [],
    targetsLeft: 0,
    bannerText: '',
    bannerKey: 0,
    bloodKey: 0,
    zoom: 1,
  });

  const [eqText, setEqText] = useState('');
  const [dir, setDir] = useState<1 | -1>(1);
  const [eqAxis, setEqAxis] = useState<Axis | null>(null);
  const [eqStatus, setEqStatus] = useState<EqStatus>({ kind: 'idle', text: '' });
  const [latexMode, setLatexMode] = useState(false);

  // чат и истории уравнений (настройки лобби: chatEnabled / eqHistoryMine / eqHistoryAll)
  const [sideOpen, setSideOpen] = useState(false);
  const [sideTab, setSideTab] = useState<'chat' | 'mine' | 'all'>('chat');
  const [chatLog, setChatLog] = useState<{ from: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [myEqs, setMyEqs] = useState<{ pid: number; eq: string }[]>([]);
  const [allEqs, setAllEqs] = useState<{ name: string; eq: string }[]>([]);

  const appendChat = useCallback((from: string, text: string) => {
    setChatLog((prev) => [...prev.slice(-49), { from, text }]);
  }, []);

  const applyWorld = useCallback((world?: NetWorld) => {
    viewRef.current = { zoom: 1, cx: 0, cy: 0 }; // camera resets with each new world
    const scene = sceneRef.current!;
    // мультиточки (GraphWar): K случайных точек на игрока; позиции плоским
    // списком (игроки × K) — протокол сети не меняется, группируем локально.
    // В соло тоже работает: игрок стреляет с разных случайных точек по мишеням.
    const K = Math.max(1, Math.min(3, settings.pointsPerPlayer || 1));
    const positions = world?.positions ?? spawnPositions(settings, mode === 'solo' ? K : playerDefs.length * K);
    const players: GamePlayer[] = playerDefs.map((d, i) => {
      const pts = (mode === 'solo'
        ? positions.slice(0, K)
        : positions.slice(i * K, i * K + K)
      ).map((p) => ({ ...p, hp: settings.hitsToDie }));
      const activeIdx = pickActiveIdx(pts.length, 0, 0, d.id);
      return {
        ...d,
        points: pts,
        activeIdx,
        x: pts[activeIdx].x,
        y: pts[activeIdx].y,
        hp: settings.hitsToDie * pts.length,
        alive: true,
      };
    });
    const maxHp = obstacleMaxHp(settings.destruction);
    const rawObstacles = world?.obstacles ?? generateObstaclesSolvable(settings, players.flatMap((p) => p.points));
    const obstacles = rawObstacles.map((o) => (maxHp > 0 ? { ...o, hp: maxHp } : o));
    const targets = mode === 'solo' ? spawnTargets(settings, 10, [], obstacles, players[0].points) : [];

    scene.W = settings.mapW;
    scene.H = settings.mapH;
    scene.players = players;
    scene.obstacles = obstacles;
    scene.obstacleMaxHp = maxHp;
    scene.trails = [];
    scene.preview = null;
    scene.previewColor = '#fff';
    scene.bullet = null;
    scene.explosions = [];
    scene.targets = targets;
    scene.pendingHit = null;
    scene.shotNumber = 0;
    scene.score = 0;
    scene.winner = null;
    scene.phase = 'aim';
    scene.stepWorld = Math.min(settings.mapW, settings.mapH) / 700;
    scene.timeLeft = mode === 'multi' && settings.turnTimerSec > 0 ? settings.turnTimerSec : null;

    // net games start from player[0] on every client (deterministic); hot-seat picks randomly
    const first = net
      ? players[0].id
      : mode === 'multi'
        ? players[Math.floor(Math.random() * players.length)].id
        : players[0].id;
    scene.turnId = first;
    const firstPlayer = players.find((p) => p.id === first)!;
    scene.bannerText = mode === 'multi' ? `ХОД: ${firstPlayer.name}` : 'РАЗМИНКА: ПОРАЗИ ВСЕ ЦЕЛИ';
    scene.bannerKey += 1;
    scene.activeId = first;
    scene.time = 0;
    syncRef.current();
  }, [mode, settings, playerDefs, net]);

  const broadcastSync = useCallback(() => {
    const n = netRef.current;
    if (n?.role !== 'host') return;
    const scene = sceneRef.current!;
    n.session.broadcast({
      t: 'sync',
      players: scene.players.map((p) => [p.id, p.hp, p.alive] as [number, number, boolean]),
      turnId: scene.turnId,
      phase: scene.phase,
      winnerId: scene.winner?.id ?? null,
      timeLeft: scene.timeLeft === null ? null : Math.max(0, scene.timeLeft),
      bloodKey: scene.bloodKey,
      obstacles: scene.obstacles,
    });
  }, []);

  const afterTurn = useCallback(() => {
    const scene = sceneRef.current!;
    if (scene.phase === 'over') return;
    const alive = scene.players.filter((p) => p.alive);
    // командный режим: побеждает последняя выжившая КОМАНДА
    const aliveTeams = new Set(alive.map((p) => p.team ?? p.colorIdx));
    const over = settings.teams > 0 ? aliveTeams.size <= 1 : alive.length <= 1;
    if (over) {
      scene.phase = 'over';
      scene.winner = alive[0] ?? null;
      scene.turnId = null;
      scene.activeId = null;
      sfx.win();
    } else {
      const nid = nextAliveId(scene.players, scene.turnId);
      scene.turnId = nid;
      scene.activeId = nid;
      scene.trails = [];
      scene.preview = null;
      scene.phase = 'aim';
      scene.timeLeft = settings.turnTimerSec > 0 ? settings.turnTimerSec : null;
      const pl = scene.players.find((p) => p.id === nid);
      // мультиточки: в новом ходу стреляет ДРУГАЯ случайная точка (детерминированно —
      // сид от числа завершённых выстрелов, одинаков у хоста и гостей).
      // activeIdx −1 — прежняя активная точка подбита: выберем любую из выживших
      if (pl && pl.alive) {
        pl.activeIdx = pickActiveIdx(pl.points.length, pl.activeIdx, scene.shotNumber, pl.id);
        pl.x = pl.points[pl.activeIdx].x;
        pl.y = pl.points[pl.activeIdx].y;
      }
      scene.bannerText = `ХОД: ${pl?.name ?? '?'}`;
      scene.bannerKey += 1;
      sfx.turn();
    }
    broadcastSync();
    syncRef.current();
  }, [settings.turnTimerSec, settings.teams, broadcastSync]);

  const doPass = useCallback(() => {
    const scene = sceneRef.current!;
    if (scene.phase !== 'aim') return;
    const pl = scene.players.find((p) => p.id === scene.turnId);
    scene.bannerText = `${pl?.name ?? ''} пасует`;
    scene.bannerKey += 1;
    afterTurn();
  }, [afterTurn]);

  const endFlight = useCallback(() => {
    const scene = sceneRef.current!;
    const b = scene.bullet;
    if (!b || scene.phase !== 'flying') return;
    const last = b.pts[b.pts.length - 1];
    const hit = scene.pendingHit;
    // Жертвы: список (пуля насквозь) или одиночное попадание.
    // id >= 0 — игрок, id < 0 — цель соло-разминки (-индекс-1).
    const victims: VictimHit[] = hit?.victims?.length
      ? hit.victims
      : hit?.hit === 'player' && hit.hitPlayerId !== undefined
        ? [{ id: hit.hitPlayerId, x: last.x, y: last.y }]
        : [];
    const isPlayerHit = victims.length > 0;
    scene.explosions.push({ x: last.x, y: last.y, age: 0, color: b.color, big: !!isPlayerHit });

    // Урон препятствию (разрушаемость из настроек матча) или прогрызание отверстия
    if (hit?.hit === 'obstacle') {
      const oi = scene.obstacles.findIndex((o) => hitTestObstacles([o], last.x, last.y, 0.9));
      if (oi >= 0) {
        const o = scene.obstacles[oi];
        if (settings.destruction === 3) {
          const prev = b.pts.length > 1 ? b.pts[b.pts.length - 2] : { x: last.x - 1, y: last.y };
          const dl = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
          scene.obstacles[oi] = drillObstacle(o, last.x, last.y, (last.x - prev.x) / dl, (last.y - prev.y) / dl);
          scene.bannerText = 'прогрызано отверстие';
          scene.bannerKey += 1;
        } else if (scene.obstacleMaxHp > 0) {
          const hp = (o.hp ?? scene.obstacleMaxHp) - 1;
          if (hp <= 0) {
            scene.obstacles.splice(oi, 1);
            scene.bannerText = 'препятствие разрушено';
            scene.bannerKey += 1;
          } else {
            scene.obstacles[oi] = { ...o, hp };
          }
        }
      }
    }
    sfx.explosion();
    scene.bullet = null;
    const trail = scene.trails[scene.trails.length - 1];
    if (trail) trail.upto = undefined;

    if (mode === 'solo') {
      // цели (id < 0) — по убыванию индекса: splice старшего не сдвигает младшие
      const tVictims = victims.filter((x) => x.id < 0).sort((a, z) => a.id - z.id);
      for (const v of tVictims) {
        const ti = -v.id - 1;
        if (ti < 0 || ti >= scene.targets.length) continue;
        scene.targets.splice(ti, 1);
        scene.score += 1;
        sfx.hit();
        if (scene.targets.length <= 2) {
          scene.targets.push(...spawnTargets(settings, 10 - scene.targets.length, scene.targets, scene.obstacles, scene.players[0]?.points ?? []));
          sfx.spawn();
        }
      }
      if (trail) trail.fade = true;
      // соло: мультиточки — следующий выстрел с другой случайной точки
      const me = scene.players[0];
      if (me && me.alive && me.points.length > 1) {
        me.activeIdx = pickActiveIdx(me.points.length, me.activeIdx, scene.shotNumber, me.id);
        me.x = me.points[me.activeIdx].x;
        me.y = me.points[me.activeIdx].y;
      }
      scene.phase = 'aim';
      syncRef.current();
    } else {
      for (const v of victims) {
        if (v.id < 0) continue;
        const pl = scene.players.find((p) => p.id === v.id);
        if (!pl || !pl.alive) continue;
        // урон получает точка, ближайшая к месту попадания (у каждой точки свои жизни)
        let bi = 0;
        let bd = Infinity;
        pl.points.forEach((pt, i) => {
          const d = Math.hypot(pt.x - v.x, pt.y - v.y);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        });
        const hitPt = pl.points[bi];
        hitPt.hp -= 1;
        sfx.hit();
        // blood floods the victim's own screen (hot-seat: shared screen → any hit)
        const victimIsMe = !netRef.current || v.id === myId;
        if (victimIsMe) scene.bloodKey += 1;
        if (hitPt.hp <= 0) {
          // точка подбита — исчезает; игрок жив, пока жива хоть одна точка
          const wasActive = bi === pl.activeIdx;
          pl.points.splice(bi, 1);
          sfx.death();
          if (pl.points.length === 0) {
            pl.alive = false;
          } else {
            if (bi < pl.activeIdx) pl.activeIdx -= 1;
            else if (wasActive) pl.activeIdx = -1; // новую выберет afterTurn
          }
        } else if (v.flee) {
          // отброс выжившей точки: она телепортируется на 1..fleeRadius клеток
          pl.points[bi] = { ...hitPt, x: v.flee.x, y: v.flee.y };
        }
        pl.hp = pl.points.reduce((s, q) => s + q.hp, 0);
        // x/y зеркалят активную точку, пока она жива
        if (pl.alive && pl.activeIdx >= 0 && pl.activeIdx < pl.points.length) {
          pl.x = pl.points[pl.activeIdx].x;
          pl.y = pl.points[pl.activeIdx].y;
        }
      }
      window.setTimeout(afterTurn, 900); // afterTurn broadcasts the post-turn sync
      syncRef.current();
    }
  }, [mode, settings, afterTurn, broadcastSync, myId]);

  /** Validate + launch a shot for any player. Returns error string when rejected. */
  const executeShot = useCallback((shooterId: number, text: string, shotDir: 1 | -1): string | null => {
    const scene = sceneRef.current!;
    if (scene.phase !== 'aim') return 'сейчас не фаза прицеливания';
    const parsed = parseEquation(text);
    if (!parsed.ok) return parsed.error;
    const shooter = scene.players.find((p) => p.id === shooterId);
    if (!shooter || !shooter.alive) return 'стрелок недоступен';
    scene.shotNumber = (scene.shotNumber ?? 0) + 1; // зерно отброса — синхронно на всех клиентах
    const flight = buildFlight(parsed.eq, shooter.x, shooter.y, shotDir, {
      settings,
      obstacles: scene.obstacles,
      players: scene.players,
      shooterId: shooter.id,
      soloTargets: mode === 'solo' ? scene.targets : undefined,
      shotNumber: scene.shotNumber,
    });
    if (!flight.ok) return flight.error ?? 'Траектория недопустима';

    // история уравнений: allEqs — каждый успешный выстрел (executeShot детерминированно
    // запускается на всех клиентах, включая гостей, повторяющих 'shot'); myEqs — только свои.
    setAllEqs((prev) => [{ name: shooter.name, eq: text }, ...prev].slice(0, 30));
    // «мои» — всегда с меткой игрока: в hot-seat список показывается для ТЕКУЩЕГО
    // игрока за этим экраном, в сети/соло — только для себя
    setMyEqs((prev) =>
      [{ pid: shooterId, eq: text }, ...prev.filter((e) => !(e.pid === shooterId && e.eq === text))].slice(0, 60),
    );

    // host relays the validated shot to every guest; all clients run the same deterministic flight
    const n = netRef.current;
    if (n?.role === 'host') n.session.broadcast({ t: 'shot', shooterId, eq: text, dir: shotDir });

    const color = playerColor(shooter.colorIdx, gsRef.current.theme);
    sfx.shot();
    scene.trails.push({ pts: flight.points, color, alpha: 1, upto: 0 });
    scene.bullet = { pts: flight.points, idx: 0, color };
    scene.pendingHit = { hit: flight.hit, hitPlayerId: flight.hitPlayerId, victims: flight.victims };
    scene.preview = null;
    scene.phase = 'flying';
    setEqStatus({ kind: 'idle', text: '' });
    syncRef.current();
    return null;
  }, [mode, settings, myId]);

  /**
   * Приводит ввод к канонической формуле: в LaTeX-режиме конвертирует LaTeX → формула
   * парсера (в сети отправляется уже сконвертированный текст — все клиенты воспроизводят
   * одну и ту же запись). В обычном режиме — простая валидация парсером.
   */
  const prepareEq = useCallback((raw: string): { ok: boolean; eq: string; error?: string } => {
    if (!latexMode) {
      const p = parseEquation(raw);
      return p.ok ? { ok: true, eq: raw } : { ok: false, eq: raw, error: p.error };
    }
    const r = latexToEquation(raw);
    if (!r.ok || !r.eq) return { ok: false, eq: raw, error: r.error };
    return { ok: true, eq: r.eq };
  }, [latexMode]);

  /** Local fire button / Enter. Guests forward the request to the host. */
  const fire = useCallback(() => {
    const scene = sceneRef.current!;
    if (scene.phase !== 'aim') return;
    const n = netRef.current;
    if (n && scene.turnId !== myId) return;
    const prep = prepareEq(eqText);
    if (!prep.ok) {
      setEqStatus({ kind: 'error', text: prep.error ?? 'некорректное выражение' });
      sfx.error();
      return;
    }
    if (n?.role === 'guest') {
      n.session.send({ t: 'fire', eq: prep.eq, dir });
      setEqStatus({ kind: 'ok', text: 'выстрел отправлен хосту…' });
      return;
    }
    const err = executeShot(scene.turnId!, prep.eq, dir);
    if (err) {
      setEqStatus({ kind: 'error', text: err });
      sfx.error();
    }
  }, [eqText, dir, myId, executeShot, prepareEq]);

  const fireRef = useRef(fire);
  fireRef.current = fire;

  /** Отправка сообщения чата. Хост ретранслирует всем (включая отправителя-гостя — тот
   *  дописывает сообщение только по получении, без дублей). */
  const sendChat = useCallback(() => {
    const text = chatInput.trim().slice(0, 200);
    if (!text) return;
    const n = netRef.current;
    const scene = sceneRef.current!;
    const meId = n?.role === 'guest' ? n.session.myId : 0;
    const me = scene.players.find((p) => p.id === meId);
    const from = me?.name ?? 'я';
    if (n?.role === 'guest') {
      n.session.send({ t: 'chat', text });
    } else {
      appendChat(from, text);
      if (n?.role === 'host') n.session.broadcast({ t: 'chat', from, text });
    }
    setChatInput('');
  }, [chatInput, appendChat]);

  // init + cleanup
  useEffect(() => {
    applyWorld(initialWorld);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // network message handling — GameScreen takes over the session handlers while mounted
  useEffect(() => {
    const n = netRef.current;
    if (!n) return;
    if (n.role === 'host') {
      const s = n.session;
      s.handler = (pid, msg) => {
        const scene = sceneRef.current!;
        if (msg.t === 'fire') {
          if (scene.phase !== 'aim' || scene.turnId !== pid) return;
          const err = executeShot(pid, msg.eq, msg.dir);
          if (err) s.links.get(pid)?.send({ t: 'reject', reason: err });
        } else if (msg.t === 'pass') {
          if (scene.phase === 'aim' && scene.turnId === pid) doPass();
        } else if (msg.t === 'chat') {
          const text = String(msg.text ?? '').trim().slice(0, 200);
          if (!text || !settings.chatEnabled) return;
          const pl = scene.players.find((p) => p.id === pid);
          const from = pl?.name ?? `игрок ${pid}`;
          appendChat(from, text); // хост пишет у себя…
          s.broadcast({ t: 'chat', from, text }); // …и ретранслирует всем, включая отправителя
        } else if (msg.t === 'leave' || msg.t === 'exit-match') {
          const pl = scene.players.find((p) => p.id === pid);
          if (pl && pl.alive) {
            pl.alive = false;
            pl.hp = 0;
            scene.bannerText = msg.t === 'exit-match' ? `${pl.name} вышел в лобби` : `${pl.name} отключился`;
            scene.bannerKey += 1;
            broadcastSync();
            syncRef.current();
          }
        }
      };
      return () => { s.handler = null; };
    }
    const s = n.session;
    s.handler = (msg) => {
      const scene = sceneRef.current!;
      if (msg.t === 'shot') {
        executeShot(msg.shooterId, msg.eq, msg.dir);
      } else if (msg.t === 'pass') {
        doPass();
      } else if (msg.t === 'reject') {
        setEqStatus({ kind: 'error', text: msg.reason });
        sfx.error();
      } else if (msg.t === 'chat') {
        // запись только по получении (хост эхом возвращает сообщение и отправителю)
        const text = String(msg.text ?? '').trim().slice(0, 200);
        if (text) appendChat(msg.from ?? '?', text);
      } else if (msg.t === 'sync') {
        // авторитетное состояние препятствий (урон/разрушение считается детерминированно и у гостя, но подстраховываемся)
        if (msg.obstacles) scene.obstacles = msg.obstacles;
        for (const [id, hp, alive] of msg.players) {
          const pl = scene.players.find((p) => p.id === id);
          if (pl) { pl.hp = hp; pl.alive = alive; }
        }
        if (msg.winnerId !== null) scene.winner = scene.players.find((p) => p.id === msg.winnerId) ?? null;
        // turn/phase corrections only when idle — a locally flying bullet finishes first,
        // and its deterministic endFlight/afterTurn converges to the same state.
        // A 'flying' phase from sync is always stale for an idle client — never apply it,
        // otherwise the client would deadlock waiting for a bullet that isn't there.
        if (scene.phase === 'aim' && msg.phase !== 'flying') {
          scene.phase = msg.phase;
          if (msg.phase === 'aim') {
            scene.turnId = msg.turnId;
            scene.activeId = msg.turnId;
            scene.timeLeft = msg.timeLeft;
          } else if (msg.phase === 'over') {
            scene.turnId = null;
            scene.activeId = null;
          }
        }
        syncRef.current();
      } else if (msg.t === 'start') {
        // host initiated a rematch with a fresh world
        applyWorld({ positions: msg.positions, obstacles: msg.obstacles });
      } else if (msg.t === 'abort') {
        // хост досрочно завершил матч — возвращаемся в лобби (сессия сохраняется)
        onExitRef.current();
      }
    };
    return () => { s.handler = null; };
  }, [executeShot, doPass, applyWorld, broadcastSync, appendChat, settings.chatEnabled]);

  // HUD sync — pushes scene snapshot into React state when something changed
  useEffect(() => {
    let lastSig = '';
    syncRef.current = () => {
      const scene = sceneRef.current!;
      const sig = [
        scene.phase,
        scene.turnId,
        scene.timeLeft === null ? '-' : Math.ceil(scene.timeLeft),
        scene.score,
        scene.winner?.id ?? '-',
        scene.targets.length,
        scene.bannerKey,
        scene.bloodKey,
        Math.round(viewRef.current.zoom * 100),
        scene.players.map((p) => `${p.hp}${p.alive ? 1 : 0}`).join(','),
      ].join('|');
      if (sig === lastSig) return;
      lastSig = sig;
      setHud({
        phase: scene.phase,
        turnId: scene.turnId,
        timeLeft: scene.timeLeft,
        score: scene.score,
        winner: scene.winner,
        players: [...scene.players],
        targetsLeft: scene.targets.length,
        bannerText: scene.bannerText,
        bannerKey: scene.bannerKey,
        bloodKey: scene.bloodKey,
        zoom: viewRef.current.zoom,
      });
    };
    syncRef.current();
  }, []);

  // Main loop: animation + canvas render + turn timer. Camera is locked to the map (no zoom/pan).
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const scene = sceneRef.current!;
      scene.time += dt;

      // turn timer: ticks locally everywhere for display; only the host (or local game) acts on timeout
      const n = netRef.current;
      if (mode === 'multi' && scene.phase === 'aim' && scene.timeLeft !== null) {
        const before = Math.ceil(scene.timeLeft);
        scene.timeLeft -= dt;
        const after = Math.ceil(scene.timeLeft);
        if (after < before && after <= 5 && after > 0) sfx.tick(); // countdown rattle
        if (scene.timeLeft <= 0 && (!n || n.role === 'host')) {
          scene.timeLeft = null;
          const pl = scene.players.find((p) => p.id === scene.turnId);
          scene.bannerText = `ВРЕМЯ ВЫШЛО: ${pl?.name ?? ''} пасует`;
          scene.bannerKey += 1;
          afterTurn();
        } else if (scene.timeLeft < 0) {
          scene.timeLeft = 0; // guest: wait for the host's sync
        }
      }

      // bullet flight
      if (scene.bullet) {
        scene.bullet.idx += (42 / scene.stepWorld) * dt;
        const trail = scene.trails[scene.trails.length - 1];
        if (trail) trail.upto = scene.bullet.idx;
        if (scene.bullet.idx >= scene.bullet.pts.length - 1) endFlight();
      }

      // explosions aging
      for (const e of scene.explosions) e.age += dt;
      scene.explosions = scene.explosions.filter((e) => e.age < (e.big ? 0.8 : 0.5));

      // trail fade-out after the shot
      for (const tr of scene.trails) {
        if (tr.fade) tr.alpha -= dt / 1.1;
      }
      scene.trails = scene.trails.filter((tr) => tr.alpha > 0);

      syncRef.current();

      // draw main canvas (zoomed camera around viewRef center)
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (canvas && wrap) {
        const cw = wrap.clientWidth;
        const ch = wrap.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
          canvas.width = cw * dpr;
          canvas.height = ch * dpr;
        }
        const g = canvas.getContext('2d');
        if (g) {
          const vv = viewRef.current;
          const cc = clampViewCenter(scene.W, scene.H, cw, ch, 24, vv.zoom, vv.cx, vv.cy);
          vv.cx = cc.x;
          vv.cy = cc.y;
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          const gs = gsRef.current;
          const theme = THEMES[gs.theme];
          const view = zoomView(scene.W, scene.H, cw, ch, 24, vv.zoom, vv.cx, vv.cy);
          drawScene(g, scene, view, theme, gs.theme, cw, ch, true, { finishMarker: settings.predictFinish });
        }
      }

      // draw minimap with the real viewport rectangle of the main canvas
      const mm = minimapRef.current;
      if (mm) {
        const mw = mm.clientWidth;
        const mh = mm.clientHeight;
        const dpr = window.devicePixelRatio || 1;
        if (mm.width !== mw * dpr || mm.height !== mh * dpr) {
          mm.width = mw * dpr;
          mm.height = mh * dpr;
        }
        const g = mm.getContext('2d');
        if (g && mw > 0 && mh > 0) {
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          const gs = gsRef.current;
          const theme = THEMES[gs.theme];
          const view = computeView(scene.W, scene.H, mw, mh, 6);
          const vv = viewRef.current;
          let rect: { x: number; y: number; w: number; h: number } | undefined;
          if (wrap) {
            const sMain = fitScale(scene.W, scene.H, wrap.clientWidth, wrap.clientHeight, 24) * vv.zoom;
            const vw = wrap.clientWidth / sMain;
            const vh = wrap.clientHeight / sMain;
            // мир центрирован на нуле: отсекаем видимую область по границам карты
            const left = Math.max(-scene.W / 2, vv.cx - vw / 2);
            const right = Math.min(scene.W / 2, vv.cx + vw / 2);
            const bottom = Math.max(-scene.H / 2, vv.cy - vh / 2);
            const top = Math.min(scene.H / 2, vv.cy + vh / 2);
            if (right > left && top > bottom) rect = { x: left, y: bottom, w: right - left, h: top - bottom };
          }
          drawScene(g, scene, view, theme, gs.theme, mw, mh, false, { viewRect: rect });
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, afterTurn, endFlight, settings.predictFinish]);

  // Enter = fire
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        fireRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Camera: wheel zoom to cursor (1x..6x), left-drag pan while zoomed, double-click resets
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scene = sceneRef.current!;
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      const v = viewRef.current;
      const oldZoom = v.zoom;
      const newZoom = Math.max(1, Math.min(6, oldZoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (newZoom === oldZoom) return;
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const s0 = fitScale(scene.W, scene.H, cw, ch, 24) * oldZoom;
      const wx = (mx - cw / 2) / s0 + v.cx; // world point under the cursor
      const wy = (ch / 2 - my) / s0 + v.cy;
      const s1 = fitScale(scene.W, scene.H, cw, ch, 24) * newZoom;
      const c = clampViewCenter(scene.W, scene.H, cw, ch, 24, newZoom, wx - (mx - cw / 2) / s1, wy - (ch / 2 - my) / s1);
      v.zoom = newZoom;
      v.cx = c.x;
      v.cy = c.y;
    };

    let drag: { px: number; py: number; cx: number; cy: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const v = viewRef.current;
      drag = { px: e.clientX, py: e.clientY, cx: v.cx, cy: v.cy };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('panning');
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const scene = sceneRef.current!;
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      const v = viewRef.current;
      const scale = fitScale(scene.W, scene.H, cw, ch, 24) * v.zoom;
      const c = clampViewCenter(scene.W, scene.H, cw, ch, 24, v.zoom, drag.cx - (e.clientX - drag.px) / scale, drag.cy + (e.clientY - drag.py) / scale);
      v.cx = c.x;
      v.cy = c.y;
    };
    const onUp = () => {
      drag = null;
      canvas.classList.remove('panning');
    };
    const onDbl = () => {
      viewRef.current = { zoom: 1, cx: 0, cy: 0 };
    };

    wrap.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('dblclick', onDbl);
    return () => {
      wrap.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('dblclick', onDbl);
    };
  }, []);

  // Clear the equation input when the turn passes to another player
  useEffect(() => {
    setEqText('');
    setEqStatus({ kind: 'idle', text: '' });
  }, [hud.turnId]);

  // Live equation validation + trajectory preview (only for the locally controlled player)
  useEffect(() => {
    const scene = sceneRef.current!;
    const mine = !netRef.current || scene.turnId === myId;
    if (!eqText.trim() || !mine) {
      scene.preview = null;
      setEqAxis(null);
      if (!eqText.trim()) setEqStatus({ kind: 'idle', text: '' });
      return;
    }
    const handle = window.setTimeout(() => {
      if (scene.phase !== 'aim') return;
      const prep = prepareEq(eqText);
      if (!prep.ok) {
        scene.preview = null;
        setEqAxis(null);
        setEqStatus({ kind: 'error', text: prep.error ?? 'некорректное выражение' });
        return;
      }
      const parsed = parseEquation(prep.eq);
      if (!parsed.ok) {
        scene.preview = null;
        setEqAxis(null);
        setEqStatus({ kind: 'error', text: parsed.error });
        return;
      }
      setEqAxis(parsed.eq.axis);
      const shooter = scene.players.find((p) => p.id === scene.turnId);
      if (!shooter) return;
      const flight = buildFlight(parsed.eq, shooter.x, shooter.y, dir, {
        settings,
        obstacles: scene.obstacles,
        players: scene.players,
        shooterId: shooter.id,
        soloTargets: mode === 'solo' ? scene.targets : undefined,
      });
      scene.preview = settings.previewEnabled ? flight.points : null;
      scene.previewColor = playerColor(shooter.colorIdx, gsRef.current.theme);
      const converted = latexMode && prep.eq !== eqText.trim() ? `≡ ${prep.eq} · ` : '';
      if (!flight.ok) {
        setEqStatus({ kind: 'error', text: converted + (flight.error ?? '') });
        return;
      }
      setEqStatus({
        kind: 'ok',
        text: `${converted}Длина ≈ ${flight.length.toFixed(1)} ед. → финиш: ${HIT_LABEL[flight.hit]}`,
      });
    }, 140);
    return () => window.clearTimeout(handle);
  }, [eqText, dir, hud.turnId, hud.phase, mode, settings, myId, latexMode, prepareEq]);

  const mmSize = gameSettings.minimapSize === 's' ? 120 : gameSettings.minimapSize === 'm' ? 176 : 240;
  const cornerClass = {
    tl: 'top-16 left-3',
    tr: 'top-16 right-3',
    bl: 'bottom-3 left-3',
    br: 'bottom-3 right-3',
  }[gameSettings.minimapCorner];

  const panelPos = gameSettings.panelPosition;
  const activePlayer = hud.players.find((p) => p.id === hud.turnId) ?? null;
  const myTurn = !net || hud.turnId === myId;
  const canFire = hud.phase === 'aim' && myTurn;

  // боковая панель: чат — только в сети при включённом чате; истории — по настройкам лобби.
  // Панель встаёт напротив панели уравнения, а если та сверху/снизу — напротив миникарты,
  // чтобы не перекрывать её.
  const sideAvailChat = !!net && settings.chatEnabled;
  const sideAvail = sideAvailChat || settings.eqHistoryMine || settings.eqHistoryAll;
  const mmRight = gameSettings.minimapCorner === 'tr' || gameSettings.minimapCorner === 'br';
  const sideRight = panelPos === 'left' ? true : panelPos === 'right' ? false : !mmRight;
  const sideClass = sideRight ? 'right-3 items-end' : 'left-3 items-start';
  // «мои уравнения»: в сети/соло — свои; в hot-seat — список текущего игрока за этим экраном
  const myEqsShown = myEqs.filter((e) => (net ? e.pid === myId : e.pid === hud.turnId));
  const effTab: 'chat' | 'mine' | 'all' =
    sideTab === 'chat' && sideAvailChat ? 'chat'
      : sideTab === 'mine' && settings.eqHistoryMine ? 'mine'
        : sideTab === 'all' && settings.eqHistoryAll ? 'all'
          : sideAvailChat ? 'chat' : settings.eqHistoryMine ? 'mine' : 'all';

  return (
    <div ref={wrapRef} className="relative w-screen h-screen overflow-hidden" style={{ background: 'var(--cy-bg)' }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cy-canvas-pan" />

      {/* Blood overlay — re-keyed on every hit taken by the local player */}
      {hud.bloodKey > 0 && <div key={hud.bloodKey} className="cy-blood-overlay active" />}

      {/* Top HUD bar */}
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between gap-3 p-3 pointer-events-none">
        <div className="cy-panel px-3 py-2 flex items-center gap-3 pointer-events-auto max-w-[60vw] overflow-x-auto">
          {mode === 'multi' ? (
            hud.players.map((p) => {
              const color = playerColor(p.colorIdx, gameSettings.theme);
              const active = p.id === hud.turnId && hud.phase !== 'over';
              return (
                <div
                  key={p.id}
                  className={'cy-chip flex items-center gap-1.5 whitespace-nowrap' + (net && active ? ' cy-chip-on' : '')}
                  style={{ opacity: p.alive ? 1 : 0.35, '--chip-color': color } as CSSProperties}
                >
                  <span
                    className="cy-chip-dot inline-block w-3 h-3 rounded-full"
                    style={{ background: color }}
                  />
                  <span
                    className="cy-chip-name cy-mono text-xs"
                    style={{ textDecoration: p.alive ? 'none' : 'line-through' }}
                  >
                    {p.name}
                    {net && p.id === myId ? ' ← ты' : ''}
                  </span>
                  {(settings.hitsToDie > 1 || (settings.pointsPerPlayer ?? 1) > 1) && (
                    <span className="cy-mono text-[0.625rem]" style={{ color: 'var(--cy-danger)' }}>
                      {'♥'.repeat(Math.max(p.hp, 0))}
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <>
              <span className="cy-label">Поражено целей</span>
              <span className="cy-mono text-base" style={{ color: 'var(--cy-accent2)' }}>{hud.score}</span>
              <span className="cy-label">· на поле: {hud.targetsLeft}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {mode === 'multi' && settings.turnTimerSec > 0 && hud.phase === 'aim' && hud.timeLeft !== null && (
            <div
              className="cy-panel cy-mono px-3 py-2 text-sm"
              style={{ color: hud.timeLeft <= 5 ? 'var(--cy-danger)' : 'var(--cy-accent)' }}
            >
              {Math.max(0, Math.ceil(hud.timeLeft))}с
            </div>
          )}
          {hud.zoom > 1.01 && (
            <button
              className="cy-panel cy-btn px-3 py-2 text-xs cy-mono"
              onClick={() => { sfx.click(); viewRef.current = { zoom: 1, cx: 0, cy: 0 }; }}
              title="Сброс вида (двойной клик по карте)"
            >
              ⤢ {Math.round(hud.zoom * 100)}%
            </button>
          )}
          <button className="cy-panel cy-btn px-3 py-2 text-sm" onClick={() => { sfx.click(); onOpenHelp(); }} title="Справка (F1)">
            ?
          </button>
          <button className="cy-panel cy-btn px-3 py-2 text-sm" onClick={() => { sfx.click(); onOpenSettings(); }} title="Настройки">
            ⚙
          </button>
          <button className="cy-panel cy-btn px-3 py-2 text-xs" onClick={() => { sfx.click(); onExit(); }}>
            ✕ Выйти{mode === 'multi' ? ' в лобби' : ''}
          </button>
        </div>
      </div>

      {/* Minimap — outer wrapper is absolutely positioned; cy-panel keeps its own positioning context */}
      {gameSettings.minimap !== false && (
        <div className={`absolute ${cornerClass} z-10`}>
          <div className="cy-panel p-1">
            <canvas ref={minimapRef} style={{ width: mmSize, height: Math.round((mmSize * settings.mapH) / settings.mapW) }} />
            <div className="cy-label text-center mt-0.5">миникарта</div>
            {mode === 'multi' && hud.players.length > 0 && (
              <div className="mt-1 px-1 max-h-32 overflow-y-auto">
                {hud.players.map((p) => {
                  const color = playerColor(p.colorIdx, gameSettings.theme);
                  return (
                    <div key={p.id} className="flex items-center gap-1.5 text-[0.625rem] cy-mono leading-4" style={{ opacity: p.alive ? 1 : 0.35 }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                      <span
                        className="truncate"
                        style={{ color: p.alive ? color : 'var(--cy-dim)', textDecoration: p.alive ? 'none' : 'line-through' }}
                      >
                        {p.name}{net && p.id === myId ? ' ← ты' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Turn banner */}
      {hud.bannerKey > 0 && hud.phase !== 'over' && (
        <div key={hud.bannerKey} className="absolute inset-x-0 top-[18%] flex justify-center pointer-events-none">
          <div className="cy-banner cy-mono text-2xl tracking-[0.3em] px-6 py-2" style={{ color: activePlayer ? playerColor(activePlayer.colorIdx, gameSettings.theme) : 'var(--cy-accent)' }}>
            {hud.bannerText}
          </div>
        </div>
      )}

      {/* Equation panel */}
      {hud.phase !== 'over' && (
        <div
          className={`absolute z-20 ${
            panelPos === 'bottom'
              ? 'bottom-4 left-1/2 -translate-x-1/2 w-[min(760px,94vw)]'
              : panelPos === 'top'
                ? 'top-16 left-1/2 -translate-x-1/2 w-[min(760px,94vw)]'
                : panelPos === 'left'
                  ? 'left-3 top-1/2 -translate-y-1/2'
                  : 'right-3 top-1/2 -translate-y-1/2'
          }`}
        >
          {net && !myTurn ? (
            <div className="cy-panel px-4 py-3 text-center cy-mono text-sm cy-dim tracking-widest">
              ход игрока {activePlayer?.name ?? '…'} — жди своей очереди
            </div>
          ) : (
            <EquationPanel
              value={eqText}
              onChange={setEqText}
              onFire={fire}
              disabled={!canFire}
              axis={eqAxis}
              dir={dir}
              onDir={setDir}
              status={eqStatus}
              vertical={panelPos === 'left' || panelPos === 'right'}
              latex={latexMode}
              onLatex={setLatexMode}
            />
          )}
        </div>
      )}

      {/* Чат и истории уравнений — сворачиваемая панель у края (настройки лобби) */}
      {sideAvail && hud.phase !== 'over' && (
        <div className={`absolute z-20 ${sideClass} top-16 flex flex-col gap-2 max-h-[calc(100vh-9rem)]`}>
          {!sideOpen ? (
            <button
              className="cy-panel cy-btn px-2 py-3 text-xs cy-mono tracking-widest"
              style={{ writingMode: 'vertical-rl' }}
              onClick={() => { sfx.click(); setSideOpen(true); }}
              title="Чат и история уравнений"
            >
              {sideAvailChat ? '✉ ЧАТ · ' : ''}ИСТОРИЯ ≡
            </button>
          ) : (
            <div className="cy-panel flex flex-col w-64 max-w-[72vw] overflow-hidden">
              <div className="flex items-center gap-1 px-2 pt-2">
                {sideAvailChat && (
                  <button
                    className={`cy-btn cy-mono text-[0.625rem] px-2 py-1 tracking-widest ${effTab === 'chat' ? 'cy-btn-primary' : ''}`}
                    onClick={() => { sfx.click(); setSideTab('chat'); }}
                  >
                    ✉ ЧАТ
                  </button>
                )}
                {settings.eqHistoryMine && (
                  <button
                    className={`cy-btn cy-mono text-[0.625rem] px-2 py-1 tracking-widest ${effTab === 'mine' ? 'cy-btn-primary' : ''}`}
                    onClick={() => { sfx.click(); setSideTab('mine'); }}
                  >
                    МОИ
                  </button>
                )}
                {settings.eqHistoryAll && (
                  <button
                    className={`cy-btn cy-mono text-[0.625rem] px-2 py-1 tracking-widest ${effTab === 'all' ? 'cy-btn-primary' : ''}`}
                    onClick={() => { sfx.click(); setSideTab('all'); }}
                  >
                    ВСЕ
                  </button>
                )}
                <button
                  className="cy-btn cy-mono text-xs px-2 py-1 ml-auto"
                  onClick={() => { sfx.click(); setSideOpen(false); }}
                  title="Свернуть"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-1">
                {effTab === 'chat' && (
                  <>
                    {chatLog.length === 0 && <div className="cy-dim text-[0.625rem] cy-mono">чат пуст — напиши первым</div>}
                    {chatLog.map((m, i) => (
                      <div key={i} className="text-xs leading-4 break-words">
                        <span className="cy-mono text-[0.625rem]" style={{ color: 'var(--cy-accent2)' }}>{m.from}: </span>
                        <span style={{ color: 'var(--cy-text)' }}>{m.text}</span>
                      </div>
                    ))}
                  </>
                )}
                {effTab === 'mine' && (
                  <>
                    {myEqsShown.length === 0 && <div className="cy-dim text-[0.625rem] cy-mono">пусто — твои выстрелы появятся здесь</div>}
                    {myEqsShown.map((e, i) => (
                      <button
                        key={i}
                        className="cy-btn cy-mono text-xs text-left px-2 py-1 truncate"
                        onClick={() => { sfx.click(); setEqText(e.eq); }}
                        title="Вставить в поле ввода"
                      >
                        {e.eq}
                      </button>
                    ))}
                  </>
                )}
                {effTab === 'all' && (
                  <>
                    {allEqs.length === 0 && <div className="cy-dim text-[0.625rem] cy-mono">пусто — здесь будут уравнения всех игроков</div>}
                    {allEqs.map((m, i) => (
                      <button
                        key={i}
                        className="cy-btn cy-mono text-xs text-left px-2 py-1 truncate"
                        onClick={() => { sfx.click(); setEqText(m.eq); }}
                        title={`${m.name} — вставить в поле ввода`}
                      >
                        <span style={{ color: 'var(--cy-accent2)' }}>{m.name}</span>
                        <span className="cy-dim">: </span>
                        {m.eq}
                      </button>
                    ))}
                  </>
                )}
              </div>
              {effTab === 'chat' && sideAvailChat && (
                <div className="flex gap-1 px-2 pb-2">
                  <input
                    className="cy-input cy-mono text-xs flex-1 min-w-0 px-2 py-1"
                    placeholder="сообщение…"
                    value={chatInput}
                    maxLength={200}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } }}
                  />
                  <button className="cy-btn cy-mono text-xs px-2 py-1" onClick={() => { sfx.click(); sendChat(); }}>
                    ➤
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Victory overlay */}
      {hud.phase === 'over' && hud.winner && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70">
          <div className="cy-panel p-8 flex flex-col items-center gap-4 cy-win">
            <div className="cy-label">матч окончен</div>
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center cy-mono text-3xl font-bold"
              style={{
                background: playerColor(hud.winner.colorIdx, gameSettings.theme),
                boxShadow: `0 0 40px ${playerColor(hud.winner.colorIdx, gameSettings.theme)}`,
                color: '#000',
              }}
            >
              {hud.winner.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="cy-mono text-2xl tracking-[0.25em]" style={{ color: 'var(--cy-accent2)', textShadow: '0 0 20px var(--cy-accent2)' }}>
              {settings.teams > 0 ? `КОМАНДА ${(hud.winner.team ?? 0) + 1} ПОБЕЖДАЕТ` : `${hud.winner.name} ПОБЕЖДАЕТ`}
            </div>
            {settings.teams > 0 && (
              <div className="cy-dim text-xs tracking-widest -mt-2">выжил: {hud.winner.name}</div>
            )}
            <div className="flex gap-3 mt-2">
              {(!net || net.role === 'host') && (
                <button
                  className="cy-btn-primary cy-mono px-6 py-2 tracking-widest"
                  onClick={() => {
                    sfx.click();
                    if (net?.role === 'host') {
                      // rematch: fresh world broadcast to every guest
                      const K2 = Math.max(1, Math.min(3, settings.pointsPerPlayer || 1));
                      const positions = spawnPositions(settings, playerDefs.length * K2);
                      const obstacles = settings.obstaclesEnabled ? generateObstaclesSolvable(settings, positions) : [];
                      net.session.broadcast({ t: 'start', settings, players: playerDefs, positions, obstacles });
                      applyWorld({ positions, obstacles });
                    } else {
                      applyWorld();
                    }
                  }}
                >
                  РЕВАНШ
                </button>
              )}
              <button className="cy-btn cy-mono px-6 py-2 tracking-widest" onClick={() => { sfx.click(); onExit(); }}>
                В ЛОББИ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
