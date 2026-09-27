interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  width?: string;
}

function clampRound(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v * 100) / 100));
}

/** Number field with external cyberpunk steppers (native spinners hidden). */
export default function NumField({ value, min, max, step = 1, onChange, width = 'w-20' }: Props) {
  return (
    <div className="flex items-stretch gap-1">
      <button
        type="button"
        className="cy-step cy-chamfer"
        onClick={() => onChange(clampRound(value - step, min, max))}
        tabIndex={-1}
      >
        −
      </button>
      <input
        type="number"
        className={`cy-input cy-mono ${width} px-2 py-1.5 text-sm text-center`}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(clampRound(n, min, max));
        }}
      />
      <button
        type="button"
        className="cy-step cy-chamfer"
        onClick={() => onChange(clampRound(value + step, min, max))}
        tabIndex={-1}
      >
        +
      </button>
    </div>
  );
}
