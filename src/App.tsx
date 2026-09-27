import { useEffect, useState } from 'react';
import { usePersistentState } from './hooks/usePersistentState';
import { DEFAULT_MATCH, DEFAULT_SETTINGS, type GameSettings, type MatchSettings, type PlayerDef } from './game/types';
import { sfx } from './game/sound';
import { music } from './game/music';
import customTrackUrl from './assets/music/dere.mp3?url';
import tAbandoned from './assets/music/abandoned.mp3?url';
import tCendres from './assets/music/cendres.mp3?url';
import t1989 from './assets/music/y1989.mp3?url';
import tMoon from './assets/music/moon.mp3?url';
import tLullaby from './assets/music/lullaby.mp3?url';
import tFreak from './assets/music/freak.mp3?url';
import tProphecies from './assets/music/prophecies.mp3?url';
import tHourglass from './assets/music/hourglass.mp3?url';
import tBunny from './assets/music/bunny.mp3?url';
import tBirds from './assets/music/birds.mp3?url';
import tAleph from './assets/music/aleph.mp3?url';

/** Плейлист пользовательских треков — ротируется между синтезированными. */
const CUSTOM_TRACKS: string[] = [
  customTrackUrl,
  tAbandoned,
  tCendres,
  t1989,
  tMoon,
  tLullaby,
  tFreak,
  tProphecies,
  tHourglass,
  tBunny,
  tBirds,
  tAleph,
];
import MenuScreen from './sections/MenuScreen';
import SetupScreen from './sections/SetupScreen';
import GameScreen from './sections/GameScreen';
import NetHomeScreen from './sections/NetHomeScreen';
import { NetHostLobby, type HostResume, type NetWorld } from './sections/NetHostLobby';
import { NetGuestScreen } from './sections/NetGuestScreen';
import SettingsModal from './components/SettingsModal';
import HelpModal from './components/HelpModal';
import type { HostSession, GuestSession } from './net/session';
import type { RelayHost } from './net/relay';
import type { LobbyPlayer } from './net/protocol';

type NetSide =
  | { role: 'host'; session: HostSession; relay: RelayHost | null; roomCode: string }
  | { role: 'guest'; session: GuestSession; relay: boolean };

type Screen =
  | { name: 'menu' }
  | { name: 'setup'; mode: 'multi' | 'solo' }
  | { name: 'game'; mode: 'multi' | 'solo'; players: PlayerDef[]; key: number }
  | { name: 'netHome' }
  | { name: 'netHost'; relay: boolean; resume?: HostResume }
  | { name: 'netGuest'; relay: boolean; resume?: { session: GuestSession } }
  | { name: 'netGame'; key: number };

export default function App() {
  const [gameSettings, setGameSettings] = usePersistentState<GameSettings>('mathart:settings', DEFAULT_SETTINGS);
  const [match, setMatch] = usePersistentState<MatchSettings>('mathart:match', DEFAULT_MATCH);
  const [names, setNames] = usePersistentState<string[]>('mathart:names', ['Игрок 1', 'Игрок 2']);
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [net, setNet] = useState<NetSide | null>(null);
  const [netGame, setNetGame] = useState<{ players: PlayerDef[]; world: NetWorld; settings: MatchSettings } | null>(null);

  // sound effects: toggle + volume
  useEffect(() => {
    sfx.enabled = gameSettings.sound;
    sfx.setVolume(gameSettings.sfxVolume / 100);
  }, [gameSettings.sound, gameSettings.sfxVolume]);

  // background music: toggle + volume; browsers require a user gesture before audio starts
  useEffect(() => {
    music.enabled = gameSettings.music;
    music.setVolume(gameSettings.musicVolume / 100);
    music.setCustomTracks(CUSTOM_TRACKS);
    // Своя музыка: папка music/ на LAN-сервере (vite middleware /custom-music).
    // Треки с этого же сервера играют у ВСЕХ подключённых игроков; в одиночном
    // HTML (file://) запрос просто не сработает — остаётся встроенный плейлист.
    let cancelled = false;
    fetch('custom-music/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((list: { name: string; url: string }[] | null) => {
        if (cancelled || !Array.isArray(list) || list.length === 0) return;
        music.setCustomTracks([...list.map((t) => t.url), ...CUSTOM_TRACKS]);
      })
      .catch(() => {});
    if (!gameSettings.music) {
      music.stop();
      return;
    }
    const kick = () => music.start();
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
  }, [gameSettings.music, gameSettings.musicVolume]);

  // interface scale: только размер шрифта. Меняем базовый rem — растут/уменьшаются
  // все шрифты (и Tailwind-классы, и rem-значения), сами панели и раскладка не трогаются.
  useEffect(() => {
    document.documentElement.style.fontSize = { s: '14px', m: '16px', l: '18.5px' }[gameSettings.uiScale];
    return () => { document.documentElement.style.fontSize = ''; };
  }, [gameSettings.uiScale]);

  // F1 = help (suppress the browser's own help page)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        sfx.open();
        setHelpOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startGame = (mode: 'multi' | 'solo', settings: MatchSettings, players: PlayerDef[]) => {
    setMatch(settings);
    if (mode === 'multi') setNames(players.map((p) => p.name));
    setScreen({ name: 'game', mode, players, key: Date.now() });
  };

  const startNetGame = (side: NetSide, players: PlayerDef[], world: NetWorld, settings: MatchSettings) => {
    setNet(side);
    setNetGame({ players, world, settings });
    setScreen({ name: 'netGame', key: Date.now() });
  };

  // Досрочный выход из матча: матч отменяется для всех, все возвращаются в лобби.
  // Сессии остаются живы — реванш или новый матч возможны без переподключения.
  const exitNetGame = () => {
    const n = net;
    if (!n) {
      setNetGame(null);
      setScreen({ name: 'netHome' });
      return;
    }
    if (n.role === 'host') {
      n.session.broadcast({ t: 'abort' });
      const players: LobbyPlayer[] = (netGame?.players ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        ready: false,
        isHost: p.id === 0,
      }));
      setScreen({ name: 'netHost', relay: !!n.relay, resume: { session: n.session, relay: n.relay, roomCode: n.roomCode, players } });
    } else {
      // сообщаем хосту, что мы вышли из матча (но остаёмся в комнате) — иначе матч зависнет на нашем ходу
      try { n.session.send({ t: 'exit-match' }); } catch { /* канал уже мёртв — не страшно */ }
      setScreen({ name: 'netGuest', relay: n.relay, resume: { session: n.session } });
    }
    setNetGame(null);
  };

  return (
    <div className={`app-root ${gameSettings.theme === 'dark' ? 'theme-dark' : 'theme-light'} cy-scanlines`}>
      {screen.name === 'menu' && (
        <MenuScreen
          onHotSeat={() => { sfx.click(); setScreen({ name: 'setup', mode: 'multi' }); }}
          onNet={() => { sfx.click(); setScreen({ name: 'netHome' }); }}
          onSolo={() => { sfx.click(); setScreen({ name: 'setup', mode: 'solo' }); }}
          onSettings={() => { sfx.click(); setSettingsOpen(true); }}
          onHelp={() => { sfx.open(); setHelpOpen(true); }}
        />
      )}

      {screen.name === 'setup' && (
        <SetupScreen
          mode={screen.mode}
          initialSettings={match}
          initialNames={names}
          defaultName={gameSettings.playerName}
          theme={gameSettings.theme}
          onStart={(s, p) => startGame(screen.mode, s, p)}
          onBack={() => setScreen({ name: 'menu' })}
        />
      )}

      {screen.name === 'game' && (
        <GameScreen
          key={screen.key}
          mode={screen.mode}
          settings={match}
          playerDefs={screen.players}
          gameSettings={gameSettings}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => { sfx.open(); setHelpOpen(true); }}
          onExit={() => setScreen({ name: 'setup', mode: screen.mode })}
        />
      )}

      {screen.name === 'netHome' && (
        <NetHomeScreen
          onHost={(relay) => setScreen({ name: 'netHost', relay })}
          onJoin={(relay) => setScreen({ name: 'netGuest', relay })}
          onBack={() => setScreen({ name: 'menu' })}
        />
      )}

      {screen.name === 'netHost' && (
        <NetHostLobby
          hostName={gameSettings.playerName}
          settings={match}
          onSettings={setMatch}
          relay={screen.relay}
          resume={screen.resume}
          onStart={(session, players, world, ctx) =>
            startNetGame({ role: 'host', session, relay: ctx.relay, roomCode: ctx.roomCode }, players, world, match)
          }
          onBack={() => { setNet(null); setNetGame(null); setScreen({ name: 'netHome' }); }}
        />
      )}

      {screen.name === 'netGuest' && (
        <NetGuestScreen
          relay={screen.relay}
          resume={screen.resume}
          onStart={(session, players, world, settings) =>
            startNetGame({ role: 'guest', session, relay: screen.relay }, players, world, settings)
          }
          onBack={() => { setNet(null); setNetGame(null); setScreen({ name: 'netHome' }); }}
        />
      )}

      {screen.name === 'netGame' && net && netGame && (
        <GameScreen
          key={screen.key}
          mode="multi"
          settings={netGame.settings}
          playerDefs={netGame.players}
          gameSettings={gameSettings}
          net={net}
          initialWorld={netGame.world}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => { sfx.open(); setHelpOpen(true); }}
          onExit={exitNetGame}
        />
      )}

      {settingsOpen && (
        <SettingsModal settings={gameSettings} onChange={setGameSettings} onClose={() => setSettingsOpen(false)} />
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
