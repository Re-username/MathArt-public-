import { useEffect, useState } from 'react';
import type { MatchSettings, PlayerDef } from '../game/types';
import { PLAYER_COLORS } from '../game/types';
import { sfx } from '../game/sound';
import MatchSettingsEditor from '../components/MatchSettingsEditor';

interface Props {
  mode: 'multi' | 'solo';
  initialSettings: MatchSettings;
  initialNames: string[];
  defaultName: string;
  theme: 'dark' | 'light';
  onStart: (settings: MatchSettings, players: PlayerDef[]) => void;
  onBack: () => void;
}

export default function SetupScreen({ mode, initialSettings, initialNames, defaultName, theme, onStart, onBack }: Props) {
  const [ms, setMs] = useState<MatchSettings>(initialSettings);
  const [names, setNames] = useState<string[]>(() => {
    const base = initialNames.length >= 2 ? initialNames : [defaultName || 'Игрок 1', 'Игрок 2'];
    return base.slice(0, 6);
  });

  // в командных режимах состав строго фиксирован: 2×2 = 4, 3×3 = 6
  const requiredCount = mode === 'multi' && ms.teams > 0 ? ms.teams * 2 : null;
  useEffect(() => {
    if (!requiredCount) return;
    setNames((p) => {
      if (p.length === requiredCount) return p;
      const next = p.slice(0, requiredCount);
      while (next.length < requiredCount) next.push(`Игрок ${next.length + 1}`);
      return next;
    });
  }, [requiredCount]);

  const validNames = names.map((n) => n.trim()).filter((n) => n.length > 0);
  const canStart = mode === 'solo' || (requiredCount ? validNames.length === requiredCount : validNames.length >= 2);

  const start = () => {
    if (!canStart) return;
    sfx.click();
    const defs: PlayerDef[] =
      mode === 'solo'
        ? [{ id: 0, name: defaultName || 'Игрок 1', colorIdx: 0 }]
        : validNames.map((name, i) => ({
            id: i,
            name,
            colorIdx: ms.teams > 0 ? i % 2 : i,
            team: ms.teams > 0 ? i % 2 : undefined,
          }));
    onStart(ms, defs);
  };

  return (
    <div className="min-h-screen overflow-y-auto p-4 md:p-8" style={{ background: 'var(--cy-bg)' }}>
      <div className="max-w-5xl mx-auto flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="cy-label">{mode === 'multi' ? 'создание лобби · hot-seat' : 'разминка · соло'}</div>
            <h1 className="cy-mono text-2xl tracking-[0.2em] mt-1" style={{ color: 'var(--cy-accent)' }}>
              {mode === 'multi' ? 'HOT-SEAT · НАСТРОЙКА МАТЧА' : 'РАЗМИНКА'}
            </h1>
          </div>
          <button className="cy-btn px-4 py-2 text-xs" onClick={() => { sfx.click(); onBack(); }}>
            ← Назад
          </button>
        </div>

        <div className={`grid gap-5 ${mode === 'multi' ? 'md:grid-cols-[1fr_320px]' : ''}`}>
          <div className="cy-panel p-5">
            <MatchSettingsEditor ms={ms} onChange={setMs} />
          </div>

          {mode === 'multi' && (
            <div className="cy-panel p-5 flex flex-col gap-2">
              <div className="cy-label mb-1" style={{ color: 'var(--cy-accent)' }}>— Игроки ({validNames.length}/6)</div>
              {names.map((name, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className="w-4 h-4 rounded-full shrink-0"
                    style={{ background: PLAYER_COLORS[theme][ms.teams > 0 ? i % 2 : i % 6], boxShadow: `0 0 8px ${PLAYER_COLORS[theme][ms.teams > 0 ? i % 2 : i % 6]}` }}
                  />
                  <input
                    className="cy-input flex-1 px-2 py-1.5 text-sm"
                    value={name}
                    maxLength={16}
                    placeholder={`Игрок ${i + 1}`}
                    disabled={!!requiredCount}
                    onChange={(e) => setNames((p) => p.map((n, j) => (j === i ? e.target.value : n)))}
                  />
                  <span className="cy-mono text-[0.625rem] w-10 text-right" style={{ color: 'var(--cy-dim)' }}>
                    {ms.teams > 0 ? `К${i % 2 + 1}` : ''}
                  </span>
                  <button
                    className="cy-btn px-2 py-1 text-xs"
                    disabled={!!requiredCount || names.length <= 2}
                    onClick={() => setNames((p) => p.filter((_, j) => j !== i))}
                    title="Убрать игрока"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                className="cy-btn cy-mono text-xs tracking-widest py-2 mt-1"
                disabled={!!requiredCount || names.length >= 6}
                onClick={() => { sfx.click(); setNames((p) => [...p, `Игрок ${p.length + 1}`]); }}
              >
                + ДОБАВИТЬ ИГРОКА
              </button>
              <div className="cy-mono text-[0.6875rem] mt-2 leading-4" style={{ color: 'var(--cy-dim)' }}>
                {ms.teams > 0
                  ? `Командный режим ${ms.teams} на ${ms.teams}: ровно ${ms.teams * 2} игрока, чётные — команда 1, нечётные — команда 2.`
                  : 'Игроки ходят по очереди за одним экраном. Минимум 2 игрока.'}
              </div>
            </div>
          )}
        </div>

        <button
          className="cy-btn-primary cy-mono w-full py-4 text-xl tracking-[0.3em] disabled:opacity-40"
          disabled={!canStart}
          onClick={start}
        >
          {mode === 'multi' ? 'НАЧАТЬ МАТЧ' : 'НАЧАТЬ РАЗМИНКУ'}
        </button>
      </div>
    </div>
  );
}
