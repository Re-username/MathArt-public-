import { useEffect, useRef, useState } from 'react';
import type { MatchSettings, Obstacle, PlayerDef, Pt } from '../game/types';
import { MAX_PLAYERS } from '../game/types';
import type { LobbyPlayer, NetMessage } from '../net/protocol';
import { HostSession } from '../net/session';
import { HostLink, type Link } from '../net/rtc';
import { RelayHost, makeRoomCode } from '../net/relay';
import { spawnPositions } from '../game/spawn';
import { generateObstaclesSolvable } from '../game/obstacles';
import MatchSettingsEditor from '../components/MatchSettingsEditor';
import { sfx } from '../game/sound';

export interface NetWorld {
  positions: Pt[];
  obstacles: Obstacle[];
}

/** Живой контекст матча — позволяет вернуться в лобби после досрочного выхода. */
export interface HostResume {
  session: HostSession;
  relay: RelayHost | null;
  roomCode: string;
  players: LobbyPlayer[];
}

interface Props {
  hostName: string;
  settings: MatchSettings;
  onSettings: (ms: MatchSettings) => void;
  relay: boolean;
  resume?: HostResume;
  onStart: (session: HostSession, players: PlayerDef[], world: NetWorld, ctx: { relay: RelayHost | null; roomCode: string }) => void;
  onBack: () => void;
}

export function NetHostLobby({ hostName, settings, onSettings, relay, resume, onStart, onBack }: Props) {
  const sessionRef = useRef<HostSession | null>(null);
  const handedOffRef = useRef(false); // true once the session moves into GameScreen
  const [players, setPlayers] = useState<LobbyPlayer[]>(
    resume ? resume.players : [{ id: 0, name: hostName, ready: true, isHost: true }],
  );
  const playersRef = useRef(players);
  playersRef.current = players;
  const [answerCode, setAnswerCode] = useState('');
  const [offerInput, setOfferInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const cap = settings.teams > 0 ? settings.teams * 2 : MAX_PLAYERS;
  const capRef = useRef(cap);
  capRef.current = cap;

  const attachHostHandler = (s: HostSession) => {
    s.handler = (pid, msg) => {
      if (msg.t === 'ready') {
        sfx.turn();
        setPlayers((ps) => {
          const next = ps.map((p) => (p.id === pid ? { ...p, ready: msg.ready } : p));
          queueMicrotask(() => s.broadcast({ t: 'lobby', hostName, players: next, settings: settingsRef.current }));
          return next;
        });
      } else if (msg.t === 'leave') {
        s.kick(pid);
      } else if (msg.t === 'exit-match') {
        // гость вышел из матча в лобби (хозяин ещё в игре/только вернулся) — просто сбрасываем готовность
        setPlayers((ps) => {
          const next = ps.map((p) => (p.id === pid ? { ...p, ready: false } : p));
          queueMicrotask(() => s.broadcast({ t: 'lobby', hostName, players: next, settings: settingsRef.current }));
          return next;
        });
      } else if (msg.t === 'lobby-please') {
        // гость вернулся из матча и мог пропустить свежий broadcast — шлём текущее состояние лично
        s.links.get(pid)?.send({ t: 'lobby', hostName, players: playersRef.current, settings: settingsRef.current });
      }
    };
  };

  useEffect(() => {
    if (resume) {
      // возвращаемся из матча: сессия и релей живы, игроки — из матча (кто не отвалился)
      const s = resume.session;
      sessionRef.current = s;
      const alive = resume.players
        .filter((p) => p.isHost || s.links.has(p.id))
        .map((p) => ({ ...p, ready: false }));
      setPlayers(alive);
      attachHostHandler(s);
      s.broadcast({ t: 'lobby', hostName, players: alive, settings: settingsRef.current });
      return () => {
        if (!handedOffRef.current) {
          s.closeAll();
          resume.relay?.close();
        }
        sessionRef.current = null;
      };
    }
    const s = new HostSession();
    sessionRef.current = s;
    attachHostHandler(s);
    return () => { if (!handedOffRef.current) s.closeAll(); sessionRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busyRef = useRef(false);
  const [roomCode, setRoomCode] = useState(resume?.roomCode ?? '');
  const relayRef = useRef<RelayHost | null>(null);

  /** Общая логика регистрации входящего соединения (WebRTC-канал или релей). */
  const wireLink = (s: HostSession, link: Link) => {
    s.adopt(
      link,
      (pid, name) => {
        sfx.spawn();
        setPlayers((ps) => {
          const next = [...ps, { id: pid, name, ready: false, isHost: false }];
          queueMicrotask(() => s.broadcast({ t: 'lobby', hostName, players: next, settings: settingsRef.current }));
          return next;
        });
        setAnswerCode('');
        setNote('');
      },
      (pid) => {
        sfx.error();
        setPlayers((ps) => {
          const next = ps.filter((p) => p.id !== pid);
          s.broadcast({ t: 'lobby', hostName, players: next, settings: settingsRef.current });
          return next;
        });
        setAnswerCode('');
        setNote('Игрок отключился');
      },
    );
  };

  // Релей-режим: создаём комнату на сервере хоста, гости заходят по коду
  useEffect(() => {
    if (!relay) return;
    const s = sessionRef.current;
    if (!s) return;
    if (resume?.relay) {
      // комната уже создана до матча — просто переподписываемся на новые подключения
      relayRef.current = resume.relay;
      resume.relay.onGuest = (link) => {
        if (playersRef.current.length >= capRef.current) { link.close(); return; }
        wireLink(s, link);
      };
      resume.relay.onClosed = () => setNote('Релей-сервер отключился');
      return () => { if (!handedOffRef.current) { relayRef.current?.close(); relayRef.current = null; } };
    }
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        const code = makeRoomCode();
        try {
          const rh = await RelayHost.create(code);
          if (cancelled) { rh.close(); return; }
          relayRef.current = rh;
          rh.onGuest = (link) => {
            if (playersRef.current.length >= capRef.current) { link.close(); return; }
            wireLink(s, link);
          };
          rh.onClosed = () => { setNote('Релей-сервер отключился'); };
          setRoomCode(code);
          return;
        } catch (e) {
          if ((e as Error).message !== 'room-exists') {
            setNote(`Не удалось создать комнату: ${(e as Error).message}`);
            return;
          }
        }
      }
    })();
    return () => { cancelled = true; if (!handedOffRef.current) { relayRef.current?.close(); relayRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relay]);

  const acceptOffer = async () => {
    if (!offerInput.trim() || busyRef.current) return;
    const s = sessionRef.current;
    if (!s) return;
    if (playersRef.current.length >= capRef.current) { setNote(`Лобби заполнено (${capRef.current} игроков)`); sfx.error(); return; }
    busyRef.current = true;
    setBusy(true); setNote('Устанавливаю соединение…');
    try {
      const link = await HostLink.fromOfferCode(offerInput.trim());
      const code = link.answerCode();
      setAnswerCode(code);
      setOfferInput('');
      setNote('Отправь гостю код-ответ ниже. Жду подключение…');
      wireLink(s, link);
    } catch (e) {
      sfx.error();
      setNote(`Не удалось принять код: ${(e as Error).message}`);
    }
    busyRef.current = false;
    setBusy(false);
  };

  const kick = (pid: number) => {
    sessionRef.current?.kick(pid);
    setPlayers((ps) => {
      const next = ps.filter((p) => p.id !== pid);
      sessionRef.current?.broadcast({ t: 'lobby', hostName, players: next, settings: settingsRef.current });
      return next;
    });
  };

  // broadcast settings changes to guests
  useEffect(() => {
    sessionRef.current?.broadcast({ t: 'lobby', hostName, players: playersRef.current, settings });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const guests = players.filter((p) => !p.isHost);
  const allReady = guests.length > 0 && guests.every((p) => p.ready) && players.length >= (settings.teams > 0 ? settings.teams * 2 : 2);

  const start = () => {
    const s = sessionRef.current;
    if (!allReady || !s) return;
    sfx.win();
    const ms = settingsRef.current;
    const T = ms.teams;
    const infos: PlayerDef[] = playersRef.current.map((p, i) => ({
      id: p.id,
      name: p.name,
      colorIdx: T > 0 ? i % 2 : i,
      team: T > 0 ? i % 2 : undefined,
    }));
    // мультиточки: K позиций на игрока; гости группируют их локально по настройке
    const K = Math.max(1, Math.min(3, ms.pointsPerPlayer || 1));
    const positions = spawnPositions(ms, infos.length * K);
    const obstacles = ms.obstaclesEnabled ? generateObstaclesSolvable(ms, positions) : [];
    const msg: NetMessage = { t: 'start', settings: ms, players: infos, positions, obstacles };
    s.broadcast(msg);
    handedOffRef.current = true;
    onStart(s, infos, { positions, obstacles }, { relay: relayRef.current, roomCode });
  };

  return (
    <div className="min-h-screen cy-menu-bg flex flex-col items-center p-6 overflow-y-auto">
      <h2 className="cy-title text-2xl tracking-[0.3em] mb-1">СЕТЕВОЕ ЛОББИ</h2>
      <div className="cy-dim text-xs tracking-widest mb-4">ты — хост · {relay ? 'простой режим (через твой компьютер)' : 'код-обмен вручную'}</div>

      <div className="grid gap-4 w-full max-w-5xl lg:grid-cols-[1fr_340px]">
        <div className="cy-panel p-5">
          <div className="cy-title text-sm tracking-widest mb-3">НАСТРОЙКИ МАТЧА</div>
          <MatchSettingsEditor ms={settings} onChange={onSettings} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="cy-panel p-4">
            <div className="cy-title text-sm tracking-widest mb-2">ИГРОКИ ({players.length}/{cap})</div>
            <div className="space-y-1.5">
              {players.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 ${p.ready ? 'bg-[var(--cy-ok)]' : 'bg-[var(--cy-warn)]'}`} />
                  <span className="flex-1 truncate">{p.name}{p.isHost ? ' (хост)' : ''}</span>
                  {settings.teams > 0 && (
                    <span className="cy-mono text-[0.625rem] tracking-widest" style={{ color: 'var(--cy-dim)' }}>К{i % 2 + 1}</span>
                  )}
                  <span className="cy-dim text-[0.625rem] tracking-widest">{p.ready ? 'ГОТОВ' : 'ЖДЁТ'}</span>
                  {!p.isHost && (
                    <button className="cy-btn px-2 py-0.5 text-[0.625rem]" onClick={() => kick(p.id)}>✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="cy-panel p-4">
            <div className="cy-title text-sm tracking-widest mb-2">ПОДКЛЮЧИТЬ ИГРОКА</div>
            {relay ? (
              <>
                <div className="cy-dim text-[0.6875rem] mb-2">Друзья в твоей сети открывают адрес этой страницы и жмут «Войти по коду комнаты»:</div>
                <div className="cy-mono text-4xl tracking-[0.4em] text-center py-3" style={{ color: 'var(--cy-ok)' }}>
                  {roomCode || '····'}
                </div>
                <div className="cy-dim text-[0.6875rem] leading-relaxed">
                  Адрес для друзей: <b>{location.host}</b>
                  {['localhost', '127.0.0.1'].includes(location.hostname) && (
                    <> — ты открыл игру локально, друзьям нужен твой IP из строки <b>Network</b> в окне батника</>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="cy-dim text-[0.6875rem] mb-2">1. Вставь код-предложение от гостя:</div>
                <textarea
                  className="cy-input w-full h-20 text-[0.625rem] cy-code mb-2 resize-none"
                  placeholder="код-предложение гостя…"
                  value={offerInput}
                  onChange={(e) => setOfferInput(e.target.value)}
                />
                <button className="cy-btn w-full py-1.5 text-xs tracking-widest" onClick={acceptOffer} disabled={busy || !offerInput.trim()}>
                  ПРИНЯТЬ → СОЗДАТЬ ОТВЕТ
                </button>
                {answerCode && (
                  <>
                    <div className="cy-dim text-[0.6875rem] mt-3 mb-1">2. Отправь гостю этот код-ответ:</div>
                    <textarea className="cy-input w-full h-20 text-[0.625rem] cy-code resize-none" readOnly value={answerCode} onFocus={(e) => e.target.select()} />
                  </>
                )}
              </>
            )}
            {note && <div className="cy-dim text-[0.6875rem] mt-2">{note}</div>}
          </div>

          <button className="cy-btn-primary py-3 text-sm tracking-[0.2em]" onClick={start} disabled={!allReady}>
            {guests.length === 0 ? 'ЖДУ ИГРОКОВ…' : !allReady ? (players.length < (settings.teams > 0 ? settings.teams * 2 : 2) ? `НУЖНО ${settings.teams > 0 ? settings.teams * 2 : 2} ИГРОКА` : 'НЕ ВСЕ ГОТОВЫ') : 'НАЧАТЬ МАТЧ ▶'}
          </button>
          <button className="cy-btn py-2 text-xs tracking-widest" onClick={onBack}>← НАЗАД</button>
        </div>
      </div>
    </div>
  );
}
