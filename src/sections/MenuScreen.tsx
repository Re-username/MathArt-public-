import { useEffect, useMemo, useState } from 'react';

const GLITCH_CHARS = 'ΞΔΨ§¤#/\\|<>≡≠∑√01';

/** Заголовок с «живыми» буквами: случайное мерцание + редкие глитчи. */
function GlitchTitle({ text }: { text: string }) {
  const letters = useMemo(
    () =>
      text.split('').map((ch, i) => ({
        ch,
        i,
        delay: `${(Math.random() * 7).toFixed(2)}s`,
        dur: `${(2.6 + Math.random() * 4.5).toFixed(2)}s`,
      })),
    [text],
  );
  const [glitch, setGlitch] = useState<{ idx: number; ch: string } | null>(null);

  useEffect(() => {
    let off: ReturnType<typeof setTimeout>;
    const tick = () => {
      // случайная буква «сбоит»: подменяется символом и дёргается
      const idx = Math.floor(Math.random() * text.length);
      setGlitch({ idx, ch: GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)] });
      off = setTimeout(() => setGlitch(null), 90 + Math.random() * 160);
    };
    let alive = true;
    const loop = () => {
      if (!alive) return;
      tick();
      setTimeout(loop, 500 + Math.random() * 1900);
    };
    const first = setTimeout(loop, 700);
    return () => {
      alive = false;
      clearTimeout(first);
      clearTimeout(off);
    };
  }, [text]);

  return (
    <h1 className="cy-title cy-mono text-5xl md:text-7xl font-bold tracking-[0.18em]" aria-label={text}>
      {letters.map((l) => (
        <span
          key={l.i}
          className={`cy-title-letter${glitch?.idx === l.i ? ' cy-glitching' : ''}`}
          style={{ animationDelay: l.delay, animationDuration: l.dur }}
        >
          {glitch?.idx === l.i ? glitch.ch : l.ch}
        </span>
      ))}
    </h1>
  );
}

interface Props {
  onHotSeat: () => void;
  onNet: () => void;
  onSolo: () => void;
  onSettings: () => void;
  onHelp: () => void;
}

export default function MenuScreen({ onHotSeat, onNet, onSolo, onSettings, onHelp }: Props) {
  return (
    <div className="cy-menu-bg relative min-h-screen flex flex-col items-center justify-center gap-10 px-4">
      <div className="text-center">
        <div className="cy-mono text-xs tracking-[0.5em] mb-3" style={{ color: 'var(--cy-dim)' }}>
          МАТЕМАТИЧЕСКАЯ АРТИЛЛЕРИЯ
        </div>
        <GlitchTitle text="MATHART" />
        <div className="cy-mono text-xs tracking-[0.35em] mt-3" style={{ color: 'var(--cy-accent2)' }}>
          // HOT-SEAT · LAN P2P · 2–6 ИГРОКОВ
        </div>
      </div>

      <div className="flex flex-col gap-3 w-[min(360px,90vw)]">
        <button className="cy-btn cy-mono px-6 py-4 text-lg tracking-[0.25em]" onClick={onHotSeat}>
          ▶ HOT-SEAT
        </button>
        <button className="cy-btn cy-mono px-6 py-4 text-lg tracking-[0.25em]" onClick={onNet}>
          ⇄ СЕТЕВАЯ ИГРА (LAN)
        </button>
        <button className="cy-btn cy-mono px-6 py-4 text-lg tracking-[0.25em]" onClick={onSolo}>
          ◎ РАЗМИНКА (СОЛО)
        </button>
        <button className="cy-btn cy-mono px-6 py-4 text-lg tracking-[0.25em]" onClick={onSettings}>
          ⚙ НАСТРОЙКИ
        </button>
        <button className="cy-btn cy-mono px-6 py-4 text-lg tracking-[0.25em]" onClick={onHelp}>
          ? СПРАВКА (F1)
        </button>
      </div>

      <div className="cy-mono text-[0.6875rem] tracking-wider text-center" style={{ color: 'var(--cy-dim)' }}>
        Введи уравнение — пуля полетит по графику функции.
        <br />
        Попади в противника раньше, чем он в тебя.
      </div>
    </div>
  );
}
