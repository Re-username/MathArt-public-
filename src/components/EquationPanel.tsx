import type { Axis } from '../game/parser';

export interface EqStatus {
  kind: 'idle' | 'ok' | 'error';
  text: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onFire: () => void;
  disabled: boolean;
  axis: Axis | null;
  dir: 1 | -1;
  onDir: (d: 1 | -1) => void;
  status: EqStatus;
  vertical: boolean;
  /** LaTeX-режим ввода: \frac, \sqrt, \sin… */
  latex?: boolean;
  onLatex?: (v: boolean) => void;
}

export default function EquationPanel({ value, onChange, onFire, disabled, axis, dir, onDir, status, vertical, latex, onLatex }: Props) {
  const dirLabels: [string, string] = axis === 'x' ? ['▼ ВНИЗ', '▲ ВВЕРХ'] : ['◀ ВЛЕВО', 'ВПРАВО ▶'];

  return (
    <div className={`cy-panel p-3 flex ${vertical ? 'flex-col w-[300px]' : 'flex-row flex-wrap items-end'} gap-3`}>
      <div className={`${vertical ? 'w-full' : 'flex-1 min-w-[220px]'}`}>
        <div className="flex items-center justify-between mb-1 gap-2">
          <div className="cy-label">Уравнение выстрела</div>
          {onLatex && (
            <button
              className="cy-seg cy-mono text-[0.625rem] px-2 py-0.5"
              data-active={!!latex}
              disabled={disabled}
              onClick={() => onLatex(!latex)}
              title="LaTeX-ввод: \frac{a}{b}, \sqrt{x}, \sin x, x^{2}…"
            >
              ∑ LaTeX
            </button>
          )}
        </div>
        <input
          className="cy-input cy-mono w-full text-sm px-3 py-2"
          placeholder={latex ? 'y=\\frac{1}{2}x^{2}+3  ·  LaTeX' : 'y = 0.5*x^2  ·  x отсчитывается от твоего танка'}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <div
          className="cy-mono mt-1 text-[0.6875rem] leading-4 min-h-[16px]"
          style={{
            color:
              status.kind === 'error'
                ? 'var(--cy-danger)'
                : status.kind === 'ok'
                  ? 'var(--cy-accent2)'
                  : 'var(--cy-dim)',
          }}
        >
          {status.kind === 'idle'
            ? latex
              ? 'LaTeX: \\frac \\sqrt \\sin \\cos \\pi \\cdot ^{ } _{ } — превью покажет ≡ канонический вид'
              : 'Переменные: x или y. Функции: sin cos tan sqrt abs log exp pow…'
            : status.text}
        </div>
      </div>

      <div className={vertical ? 'w-full' : ''}>
        <div className="cy-label mb-1">Направление</div>
        <div className="flex gap-1">
          <button
            className="cy-seg"
            data-active={dir === -1}
            disabled={disabled}
            onClick={() => onDir(-1)}
          >
            {dirLabels[0]}
          </button>
          <button
            className="cy-seg"
            data-active={dir === 1}
            disabled={disabled}
            onClick={() => onDir(1)}
          >
            {dirLabels[1]}
          </button>
        </div>
      </div>

      <button className={`cy-btn-primary cy-mono ${vertical ? 'w-full' : ''} px-8 py-2.5 text-base tracking-widest`} disabled={disabled} onClick={onFire}>
        ОГОНЬ
      </button>
    </div>
  );
}
