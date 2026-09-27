import type { GameSettings, MinimapCorner, MinimapSize, PanelPosition, UiScale } from '../game/types';

interface Props {
  settings: GameSettings;
  onChange: (s: GameSettings) => void;
  onClose: () => void;
}

function SegGroup<T extends string>({ label, value, options, onPick }: {
  label: string;
  value: T;
  options: { v: T; text: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div>
      <div className="cy-label mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button key={o.v} className="cy-seg" data-active={value === o.v} onClick={() => onPick(o.v)}>
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsModal({ settings, onChange, onClose }: Props) {
  const set = <K extends keyof GameSettings>(k: K, v: GameSettings[K]) => onChange({ ...settings, [k]: v });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="cy-panel w-[min(480px,92vw)] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="min-h-0 overflow-y-auto p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="cy-mono text-sm tracking-[0.25em]" style={{ color: 'var(--cy-accent)' }}>НАСТРОЙКИ</div>
          <button className="cy-btn px-3 py-1 text-xs" onClick={onClose}>✕ Закрыть</button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="cy-label">Звуки игры</div>
          <button className="cy-check" data-on={settings.sound} onClick={() => set('sound', !settings.sound)}>
            {settings.sound ? 'ВКЛ' : 'ВЫКЛ'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="cy-label">Громкость эффектов: {settings.sfxVolume}%</div>
          <input
            type="range" min={0} max={100} step={5}
            className="cy-range w-32"
            value={settings.sfxVolume}
            onChange={(e) => set('sfxVolume', Number(e.target.value))}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="cy-label">Фоновая музыка</div>
          <button className="cy-check" data-on={settings.music} onClick={() => set('music', !settings.music)}>
            {settings.music ? 'ВКЛ' : 'ВЫКЛ'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="cy-label">Громкость музыки: {settings.musicVolume}%</div>
          <input
            type="range" min={0} max={100} step={5}
            className="cy-range w-32"
            value={settings.musicVolume}
            onChange={(e) => set('musicVolume', Number(e.target.value))}
          />
        </div>

        <SegGroup<UiScale>
          label="Размер интерфейса"
          value={settings.uiScale}
          options={[
            { v: 's', text: 'Компактный' },
            { v: 'm', text: 'Средний' },
            { v: 'l', text: 'Крупный' },
          ]}
          onPick={(v) => set('uiScale', v)}
        />

        <div className="flex items-center justify-between gap-4">
          <div className="cy-label">Тема оформления</div>
          <button className="cy-check" data-on={settings.theme === 'dark'} onClick={() => set('theme', settings.theme === 'dark' ? 'light' : 'dark')}>
            {settings.theme === 'dark' ? 'ТЁМНАЯ' : 'СВЕТЛАЯ'}
          </button>
        </div>

        <div>
          <div className="cy-label mb-1.5">Имя игрока по умолчанию</div>
          <input
            className="cy-input w-full px-3 py-2 text-sm"
            value={settings.playerName}
            maxLength={16}
            onChange={(e) => set('playerName', e.target.value)}
          />
        </div>

        <div>
          <div className="cy-label mb-1.5">TURN-сервер для игры через интернет (необязательно)</div>
          <input
            className="cy-input w-full px-3 py-2 text-sm cy-code"
            value={settings.turnUrl}
            placeholder="https://xxx.metered.live/api/v1/turn/credentials?apiKey=…"
            onChange={(e) => set('turnUrl', e.target.value)}
          />
          <div className="cy-dim text-[0.625rem] mt-1 leading-relaxed">
            Нужен только если P2P не пробивает сеть (симметричный NAT, мобильный интернет у обоих).
            Бесплатный ключ: metered.ca → sign up → TURN credentials URL. Для LAN и обычного домашнего интернета не требуется.
          </div>
        </div>

        <SegGroup<PanelPosition>
          label="Панель уравнения"
          value={settings.panelPosition}
          options={[
            { v: 'bottom', text: 'Снизу' },
            { v: 'top', text: 'Сверху' },
            { v: 'left', text: 'Слева' },
            { v: 'right', text: 'Справа' },
          ]}
          onPick={(v) => set('panelPosition', v)}
        />

        <div className="flex items-center justify-between gap-4">
          <div className="cy-label">Миникарта</div>
          <button className="cy-check" data-on={settings.minimap !== false} onClick={() => set('minimap', settings.minimap === false)}>
            {settings.minimap !== false ? 'ВКЛ' : 'ВЫКЛ'}
          </button>
        </div>

        <SegGroup<MinimapCorner>
          label="Угол миникарты"
          value={settings.minimapCorner}
          options={[
            { v: 'tl', text: '↖ Лево-верх' },
            { v: 'tr', text: '↗ Право-верх' },
            { v: 'bl', text: '↙ Лево-низ' },
            { v: 'br', text: '↘ Право-низ' },
          ]}
          onPick={(v) => set('minimapCorner', v)}
        />

        <SegGroup<MinimapSize>
          label="Размер миникарты"
          value={settings.minimapSize}
          options={[
            { v: 's', text: 'Маленькая' },
            { v: 'm', text: 'Средняя' },
            { v: 'l', text: 'Большая' },
          ]}
          onPick={(v) => set('minimapSize', v)}
        />
        </div>
      </div>
    </div>
  );
}
