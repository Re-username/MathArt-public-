import { compile, parse } from 'mathjs';

export type Axis = 'x' | 'y';

export interface ParsedEquation {
  axis: Axis; // dependent variable: 'y' means y = f(x), 'x' means x = f(y)
  label: string;
  evaluate: (v: number) => number | null;
}

export type ParseResult = { ok: true; eq: ParsedEquation } | { ok: false; error: string };

const KNOWN_SYMBOLS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'sqrt', 'cbrt', 'abs', 'sign', 'floor', 'ceil', 'round', 'exp', 'log', 'log2',
  'log10', 'ln', 'min', 'max', 'pow', 'mod', 'pi', 'e', 'tau', 'Infinity',
]);

const COMMA_DECIMAL_ERROR = 'Дробные числа — только через точку (0.5, а не 0,5)';

export function parseEquation(raw: string): ParseResult {
  const s = raw
    .trim()
    .replace(/[хХ]/g, 'x')
    .replace(/[уУ]/g, 'y')
    .replace(/\bln\(/g, 'log(') // mathjs natural log is log()
    .replace(/\s+/g, '');

  if (!s) return { ok: false, error: 'Введите уравнение' }

  let axis: Axis = 'y';
  let expr = s;
  const eqIdx = s.indexOf('=');
  if (eqIdx >= 0) {
    const left = s.slice(0, eqIdx).toLowerCase();
    expr = s.slice(eqIdx + 1);
    if (left === 'y') axis = 'y';
    else if (left === 'x') axis = 'x';
    else return { ok: false, error: 'Слева от «=» должно быть x или y' };
  }
  if (!expr) return { ok: false, error: 'Пустое выражение' };

  const freeVar: Axis = axis === 'y' ? 'x' : 'y';

  // Static symbol check for friendly errors
  try {
    const node = parse(expr);
    const symbols = new Set<string>();
    node.traverse((n) => {
      if (n.type === 'SymbolNode') {
        const name = (n as unknown as { name: string }).name;
        const parent = (n as unknown as { parent?: { type?: string } }).parent;
        if (parent && parent.type === 'FunctionNode') return; // function name, not variable
        symbols.add(name);
      }
    });
    for (const sym of symbols) {
      if (sym === freeVar) continue;
      if (sym === axis) {
        return { ok: false, error: `Нельзя использовать «${axis}» в правой части — только «${freeVar}»` };
      }
      if (!KNOWN_SYMBOLS.has(sym)) {
        return { ok: false, error: `Неизвестный символ «${sym}»` };
      }
    }
  } catch {
    // parse failed — if a digit-comma-digit fragment is present, it was almost
    // certainly meant as a decimal separator (valid arg commas parse fine)
    if (/\d,\d/.test(s)) return { ok: false, error: COMMA_DECIMAL_ERROR };
    return { ok: false, error: 'Синтаксическая ошибка в выражении' };
  }

  let compiled: { evaluate: (scope: Record<string, number>) => unknown };
  try {
    compiled = compile(expr);
  } catch {
    if (/\d,\d/.test(s)) return { ok: false, error: COMMA_DECIMAL_ERROR };
    return { ok: false, error: 'Синтаксическая ошибка в выражении' };
  }

  const evaluate = (v: number): number | null => {
    try {
      const r = compiled.evaluate({ [freeVar]: v });
      if (typeof r === 'number') return Number.isFinite(r) ? r : null;
      if (r && typeof r === 'object' && 're' in (r as object)) return null; // complex
      const n = Number(r);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  };

  // Probe evaluation to surface undefined-symbol errors early
  if (evaluate(0.5) === null && evaluate(1.5) === null && evaluate(-0.5) === null) {
    // Could still be legitimately undefined in these points; probe wider
    if (evaluate(3.7) === null && evaluate(-2.3) === null) {
      return { ok: false, error: 'Выражение нигде не вычисляется — проверьте формулу' };
    }
  }

  return { ok: true, eq: { axis, label: `${axis} = ${expr}`, evaluate } };
}
