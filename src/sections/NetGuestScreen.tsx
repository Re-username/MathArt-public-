import { useEffect, useRef, useState } from 'react';
import type { MatchSettings, Obstacle, PlayerDef, Pt } from '../game/types';
import type { LobbyPlayer } from '../net/protocol';
import { GuestSession } from '../net/session';
import { GuestLink, waitOpen, type CandidateStats } from '../net/rtc';
import { RelayGuestLink } from '../net/relay';
import { sfx } from '../game/sound';
import type { NetWorld } from './NetHostLobby';

interface Props {
  relay: boolean;
  resume?: { session: GuestSession };
  onStart: (session: GuestSession, players: PlayerDef[], world: NetWorld, settings: MatchSettings) => void;
  onBack: () => void;
}

type Stage = 'name' | 'offer' | 'lobby';

/** Что именно пошло не так на уровне ICE — по типам собранных кандидатов. */
function diagText(cs: CandidateStats | undefined): string {
  if (!cs) return '';
  const total = cs.host + cs.srflx + cs.relay;
  if (total === 0) return ' Браузер не собрал ни одного сетевого адреса — интернет недоступен или файрвол/антивирус блокирует WebRTC.';
  if (cs.srflx === 0 && cs.relay === 0) return ' Найдены только локальные адреса — STUN недоступен (сеть или антивирус режет UDP 3478).';
  if (cs.relay === 0) return ' Внешние адреса есть, но NAT не пробит (симметричный NAT). Попробуйте простой режим через LAN или укажите TURN-сервер в настройках.';
  return '';
}

export function NetGuestScreen({ relay, resume, onStart, onBack }: Props) {
  const [stage, setStage] = useState<Stage>(resume ? 'lobby' : 'name');
  const [name, setName] = useState('');
  const [roomInput, setRoomInput] = useState('');
  const [offerCode, setOfferCode] = useState('');
  const [answerInput, setAnswerInput] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [hostName, setHostName] = useState('');
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [settings, setSettings] = useState<MatchSettings | null>(null);
  const [ready, setReady] = useState(false);
  const sessionRef = useRef<GuestSession | null>(null);
  const guestLinkRef = useRef<GuestLink | null>(null);
  const handedOffRef = useRef(false); // true once the session moves into GameScreen

  useEffect(() => () => { if (!handedOffRef.current) sessionRef.current?.close(); }, []);

  /** Общий обработчик сообщений хоста (welcome/lobby/start/abort) для обоих транспортов. */
  const attachHandler = (session: GuestSession) => {
    session.handler = (msg) => {
      if (msg.t === 'welcome') {
        sfx.spawn();
        setStage('lobby');
        setNote('');
      } else if (msg.t === 'lobby') {
        session.lastLobby = msg;
        setHostName(msg.hostName);
        setPlayers(msg.players);
        setSettings(msg.settings);
        const me = msg.players.find((p) => p.id === session.myId);
        if (me) setReady(me.ready);
      } else if (msg.t === 'start') {
        sfx.win();
        const world: NetWorld = { positions: msg.positions as Pt[], obstacles: msg.obstacles as Obstacle[] };
        handedOffRef.current = true;
        onStart(session, msg.players, world, msg.settings);
      } else if (msg.t === 'abort') {
        // хост досрочно завершил матч — возвращаемся в лобби, сессия сохраняется
        sfx.turn();
        setStage('lobby');
        setNote('Хост завершил матч — все вернулись в лобби');
      }
    };
  };

  // возврат в лобби после матча: сессия жива, восстанавливаем её состояние
  useEffect(() => {
    if (!resume) return;
    const session = resume.session;
    sessionRef.current = session;
    attachHandler(session);
    const ll = session.lastLobby;
    if (ll) {
      setHostName(ll.hostName);
      setPlayers(ll.players);
      setSettings(ll.settings);
      const me = ll.players.find((p) => p.id === session.myId);
      if (me) setReady(me.ready);
    }
    session.onClosed = () => {
      sfx.error();
      setNote('Соединение с хостом потеряно');
      setStage('name');
      setRoomInput('');
    };
    // свежее состояние лобби: broadcast хоста мог прийти до того, как мы переподписались.
    // Повторы на случай, если хост ещё не переподписал свой обработчик.
    const please = () => { if (sessionRef.current === session) session.send({ t: 'lobby-please' }); };
    please();
    const t1 = setTimeout(please, 400);
    const t2 = setTimeout(please, 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Простой режим: вход в комнату на компьютере хоста по 4-значному коду
  const joinRelay = async () => {
    if (!name.trim() || roomInput.trim().length !== 4 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setNote('Подключаюсь к комнате…');
    try {
      const link = await RelayGuestLink.join(roomInput.trim());
      const session = new GuestSession(link);
      sessionRef.current = session;
      session.onClosed = () => {
        sfx.error();
        setNote('Соединение с хостом потеряно');
        setStage('name');
        setRoomInput('');
      };
      attachHandler(session);
      session.send({ t: 'hello', name: name.trim() });
    } catch (e) {
      sfx.error();
      setNote((e as Error).message);
    }
    busyRef.current = false;
    setBusy(false);
  };

  const createOffer = async () => {
    if (!name.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setNote('Генерирую код-предложение…');
    try {
      const link = await GuestLink.create();
      guestLinkRef.current = link;
      const session = new GuestSession(link);
      sessionRef.current = session;
      session.onClosed = () => {
        sfx.error();
        const everConnected = link.wasConnected() || session.myId !== null;
        const cs = link.candStats?.();
        setNote(everConnected
          ? 'Соединение с хостом потеряно'
          : `Не удалось установить P2P-соединение: сеть блокирует прямое подключение.${diagText(cs)} Отключите VPN у обоих игроков, разрешите браузеру сеть в брандмауэре. Надёжнее всего — Chrome/Edge у обоих.`);
        setStage('name');
        setOfferCode('');
        setAnswerInput('');
      };
      const code = link.offerCode();
      setOfferCode(code);
      setStage('offer');
      setNote('');
    } catch (e) {
      sfx.error();
      setNote(`Ошибка: ${(e as Error).message}`);
    }
    busyRef.current = false;
    setBusy(false);
  };

  const busyRef = useRef(false);

  const acceptAnswer = async () => {
    const session = sessionRef.current;
    const link = guestLinkRef.current;
    if (!session || !link || !answerInput.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setNote('Подключаюсь к хосту… (может занять до 20 секунд)');
    attachHandler(session);
    try {
      await link.acceptAnswer(answerInput.trim());
      await waitOpen(link, 25000);
      session.send({ t: 'hello', name: name.trim() });
    } catch (e) {
      sfx.error();
      const err = e as Error;
      // Любой провал = это предложение больше недействительно: закрываем и просим новый обмен кодами
      const iceState = link.iceState();
      const cs = link.candStats?.();
      session.close();
      sessionRef.current = null;
      setStage('name');
      setOfferCode('');
      setAnswerInput('');
      setNote(
        err.message === 'used-offer'
          ? 'Этот код-ответ уже использован. Создай новое код-предложение и обменяйтесь кодами с хостом заново.'
          : `Подключение не удалось (сеть: ${iceState === 'failed' ? 'P2P заблокирован' : 'тайм-аут'}).${diagText(cs)} Создай новое код-предложение и попробуйте снова: выключите VPN у обоих, разрешите браузеру сеть в брандмауэре.`,
      );
    }
    busyRef.current = false;
    setBusy(false);
  };

  const toggleReady = () => {
    const next = !ready;
    setReady(next);
    sessionRef.current?.send({ t: 'ready', ready: next });
    sfx.click();
  };

  return (
    <div className="min-h-screen cy-menu-bg flex flex-col items-center justify-center p-6">
      <h2 className="cy-title text-2xl tracking-[0.3em] mb-1">ПОДКЛЮЧЕНИЕ К ЛОББИ</h2>
      <div className="cy-dim text-xs tracking-widest mb-5">{relay ? 'простой режим · через компьютер хоста' : 'WebRTC · код-обмен вручную'}</div>

      <div className="cy-panel p-5 w-full max-w-md">
        {stage === 'name' && (
          <>
            <div className="cy-dim text-[0.6875rem] mb-2">Твоё имя:</div>
            <input className="cy-input w-full mb-3 px-3 py-2" value={name} maxLength={16}
              onChange={(e) => setName(e.target.value)} placeholder="Игрок" />
            {relay ? (
              <>
                <div className="cy-dim text-[0.6875rem] mb-2">Код комнаты (4 цифры на экране хоста):</div>
                <input
                  className="cy-input w-full mb-3 px-3 py-2 cy-mono text-center text-2xl tracking-[0.4em]"
                  value={roomInput}
                  maxLength={4}
                  inputMode="numeric"
                  onChange={(e) => setRoomInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="0000"
                />
                <button className="cy-btn-primary w-full py-2.5 text-sm tracking-[0.2em]" onClick={joinRelay} disabled={busy || !name.trim() || roomInput.length !== 4}>
                  ВОЙТИ В КОМНАТУ
                </button>
              </>
            ) : (
              <button className="cy-btn-primary w-full py-2.5 text-sm tracking-[0.2em]" onClick={createOffer} disabled={busy || !name.trim()}>
                СОЗДАТЬ КОД-ПРЕДЛОЖЕНИЕ
              </button>
            )}
          </>
        )}

        {stage === 'offer' && (
          <>
            <div className="cy-dim text-[0.6875rem] mb-2">1. Отправь хосту этот код-предложение:</div>
            <textarea className="cy-input w-full h-24 text-[0.625rem] cy-code resize-none mb-3" readOnly value={offerCode} onFocus={(e) => e.target.select()} />
            <div className="cy-dim text-[0.6875rem] mb-2">2. Вставь код-ответ от хоста:</div>
            <textarea className="cy-input w-full h-24 text-[0.625rem] cy-code resize-none mb-3"
              placeholder="код-ответ хоста…" value={answerInput} onChange={(e) => setAnswerInput(e.target.value)} />
            <button className="cy-btn-primary w-full py-2.5 text-sm tracking-[0.2em]" onClick={acceptAnswer} disabled={busy || !answerInput.trim()}>
              ПОДКЛЮЧИТЬСЯ
            </button>
            <div className="cy-dim text-[0.625rem] mt-2 leading-relaxed">
              Если не подключается: выключи VPN/прокси, разреши браузеру сеть в брандмауэре Windows,
              вставь код целиком без пробелов. Публичный Wi-Fi (кафе, вузы) часто запрещает P2P.
            </div>
          </>
        )}

        {stage === 'lobby' && (
          <>
            <div className="cy-title text-sm tracking-widest mb-1">ЛОББИ: {hostName || '…'}</div>
            <div className="cy-dim text-[0.6875rem] mb-3">
              {settings ? `карта ${settings.mapW}×${settings.mapH} · таймер ${settings.turnTimerSec}с · попаданий до гибели ${settings.hitsToDie}${settings.teams ? ` · режим ${settings.teams} на ${settings.teams}` : ''}${settings.shotMode === 'gw' ? ' · стрельба: GW point (старая логика)' : ''}${(settings.pierce ?? 1) > 1 ? ` · пуля поражает ${settings.pierce >= 6 ? 'всех на пути' : `до ${settings.pierce}`}` : ''}${settings.fleeOnHit ? ` · отброс (радиус ${settings.fleeRadius})` : ''}${(settings.pointsPerPlayer ?? 1) > 1 ? ` · точек у игрока: ${settings.pointsPerPlayer} (GraphWar)` : ''}${settings.destruction === 3 ? ' · пули бурят объекты' : settings.destruction === 2 ? ' · объекты разрушаются' : settings.destruction === 1 ? ' · объекты: 3 попадания' : ''}${settings.chatEnabled ? ' · чат' : ''}${settings.eqHistoryMine ? ' · мои уравнения' : ''}${settings.eqHistoryAll ? ' · все уравнения' : ''}` : ''}
            </div>
            <div className="space-y-1.5 mb-4">
              {players.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 ${p.ready ? 'bg-[var(--cy-ok)]' : 'bg-[var(--cy-warn)]'}`} />
                  <span className="flex-1 truncate">{p.name}{p.isHost ? ' (хост)' : ''}{p.id === sessionRef.current?.myId ? ' ← ты' : ''}</span>
                  {settings?.teams ? (
                    <span className="cy-mono text-[0.625rem] tracking-widest" style={{ color: 'var(--cy-dim)' }}>К{i % 2 + 1}</span>
                  ) : null}
                  <span className="cy-dim text-[0.625rem] tracking-widest">{p.ready ? 'ГОТОВ' : 'ЖДЁТ'}</span>
                </div>
              ))}
            </div>
            <button className={`w-full py-2.5 text-sm tracking-[0.2em] ${ready ? 'cy-btn' : 'cy-btn-primary'}`} onClick={toggleReady}>
              {ready ? 'Я НЕ ГОТОВ' : 'Я ГОТОВ ✓'}
            </button>
            <div className="cy-dim text-[0.6875rem] mt-2 text-center">хост начнёт матч, когда все готовы</div>
          </>
        )}

        {note && <div className="cy-dim text-[0.6875rem] mt-3">{note}</div>}
      </div>

      <button className="cy-btn px-6 py-2 text-xs tracking-widest mt-4" onClick={onBack}>← НАЗАД</button>
    </div>
  );
}
