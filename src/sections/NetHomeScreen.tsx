import { sfx } from '../game/sound';
import { relaySupported } from '../net/relay';

interface Props {
  onHost: (relay: boolean) => void;
  onJoin: (relay: boolean) => void;
  onBack: () => void;
}

export default function NetHomeScreen({ onHost, onJoin, onBack }: Props) {
  const relay = relaySupported();
  return (
    <div className="cy-menu-bg min-h-screen flex flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <div className="cy-label mb-2">игра с друзьями</div>
        <h1 className="cy-mono text-3xl tracking-[0.2em]" style={{ color: 'var(--cy-accent)' }}>СЕТЕВАЯ ИГРА</h1>
      </div>

      <div className="flex flex-col gap-3 w-[min(460px,92vw)]">
        {relay && (
          <div className="cy-panel p-4 flex flex-col gap-2.5">
            <div className="cy-mono text-[0.6875rem] tracking-[0.25em]" style={{ color: 'var(--cy-ok)' }}>
              ▣ ПРОСТОЙ РЕЖИМ — ОДНА СЕТЬ (РЕКОМЕНДУЕТСЯ)
            </div>
            <div className="cy-dim text-[0.6875rem] leading-relaxed">
              Друзья в той же Wi-Fi сети открывают адрес этой страницы и вводят код комнаты. Без кодов WebRTC — работает всегда.
            </div>
            <button className="cy-btn-primary cy-mono px-6 py-3.5 text-base tracking-[0.25em]" onClick={() => { sfx.click(); onHost(true); }}>
              ▶ СОЗДАТЬ КОМНАТУ
            </button>
            <button className="cy-btn cy-mono px-6 py-3.5 text-base tracking-[0.25em]" onClick={() => { sfx.click(); onJoin(true); }}>
              ⇄ ВОЙТИ ПО КОДУ КОМНАТЫ
            </button>
          </div>
        )}

        <div className="cy-panel p-4 flex flex-col gap-2.5">
          <div className="cy-mono text-[0.6875rem] tracking-[0.25em]" style={{ color: 'var(--cy-accent2)' }}>
            ⌁ РЕЖИМ КОДОВ — P2P{relay ? ' (ИНТЕРНЕТ / ФАЙЛ)' : ''}
          </div>
          <div className="cy-dim text-[0.6875rem] leading-relaxed">
            Прямое P2P-соединение: обмен кодами вручную через любой мессенджер. Подходит для игры через интернет и из одиночного файла.
          </div>
          <button className={`cy-mono px-6 py-3 text-sm tracking-[0.25em] ${relay ? 'cy-btn' : 'cy-btn-primary'}`} onClick={() => { sfx.click(); onHost(false); }}>
            ▶ СОЗДАТЬ КОМНАТУ (P2P)
          </button>
          <button className="cy-btn cy-mono px-6 py-3 text-sm tracking-[0.25em]" onClick={() => { sfx.click(); onJoin(false); }}>
            ⇄ ПОДКЛЮЧИТЬСЯ К КОМНАТЕ (P2P)
          </button>
        </div>

        <button className="cy-btn px-4 py-2 text-xs self-start" onClick={() => { sfx.click(); onBack(); }}>
          ← НАЗАД
        </button>
      </div>
    </div>
  );
}
