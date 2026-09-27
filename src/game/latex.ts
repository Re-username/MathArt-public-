/**
 * Конвертер подмножества LaTeX в формулы игрового парсера.
 *
 * Поддерживается: \frac{a}{b} → ((a)/(b)), \sqrt{x} → sqrt(x),
 * \sqrt[n]{x} → (x)^(1/(n)), \sin x → sin(x), x^{2} → x^(2),
 * \pi → pi, \cdot/\times → *, \div → /, \left \right \displaystyle и др.
 * команды-призраки выбрасываются, подстановки _{...} отбрасываются.
 *
 * Результат — каноническая текстовая формула (с префиксом y= при
 * отсутствии '='), которую понимает обычный парсер. В сетевой игре
 * конвертация происходит ДО отправки, чтобы все клиенты воспроизводили
 * одну и ту же каноническую запись.
 */

/** Команды, после которых идёт аргумент в фигурных скобках или одиночный символ. */
const FUNC_COMMANDS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh',
  'ln', 'lg', 'log', 'exp', 'sqrt',
  'abs', 'min', 'max', 'floor', 'ceil', 'round',
]);

/** Команды-призраки: выбрасываем целиком, оставляя их аргумент. */
const GHOST_COMMANDS = new Set([
  'left', 'right', 'displaystyle', 'limits', 'Big', 'big', 'Bigg', 'bigg',
  'Bigl', 'bigl', 'Bigr', 'bigr', 'Biggl', 'biggl', 'Biggr', 'biggr',
  'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathcal', 'operatorname',
  'text', 'textstyle', 'scriptstyle', 'quad', 'qquad', 'hspace', 'vspace',
  'thinspace', 'negthinspace',
]);

/** Простые макросы без аргумента → их замена. */
const WORD_MAP: Record<string, string> = {
  cdot: '*',
  times: '*',
  div: '/',
  pi: 'pi',
  le: '<=',
  leq: '<=',
  ge: '>=',
  geq: '>=',
  neq: '!=',
  pm: '+',
  mp: '-',
  infty: 'inf',
  infinity: 'inf',
  inf: 'inf',
};

export interface LatexResult {
  ok: boolean;
  /** каноническая формула игрового парсера */
  eq?: string;
  /** текст ошибки (незакрытая скобка и т.п.) */
  error?: string;
}

interface Scanner {
  s: string;
  i: number;
}

/** прочитать один атомарный аргумент: {…}, команду или одиночный символ (пробелы перед аргументом игнорируются). */
function readGroup(sc: Scanner): { text: string; isGroup: boolean } | null {
  const { s } = sc;
  while (sc.i < s.length && (s[sc.i] === ' ' || s[sc.i] === '\t')) sc.i++;
  if (sc.i >= s.length) return null;
  const ch = s[sc.i];
  if (ch === '{') {
    let depth = 1;
    let j = sc.i + 1;
    while (j < s.length && depth > 0) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') depth--;
      j++;
    }
    if (depth !== 0) return null;
    const text = s.slice(sc.i + 1, j - 1);
    sc.i = j;
    return { text, isGroup: true };
  }
  if (ch === '\\') {
    const m = /^\\([a-zA-Z]+)/.exec(s.slice(sc.i));
    if (m) {
      sc.i += m[0].length;
      return { text: m[0], isGroup: false };
    }
    sc.i += 2;
    return { text: s[sc.i - 1], isGroup: false };
  }
  sc.i += 1;
  return { text: ch, isGroup: false };
}

/** рекурсивно сконвертировать фрагмент (без префикса y=). null = синтаксическая ошибка. */
function convertBody(src: string): string | null {
  const sc: Scanner = { s: src, i: 0 };
  return convertFrag(sc, false);
}

function convertFrag(sc: Scanner, stopAtBrace: boolean): string | null {
  let r = '';
  const { s } = sc;
  while (sc.i < s.length) {
    const ch = s[sc.i];
    if (ch === '}') {
      if (stopAtBrace) return r;
      return null; // лишняя закрывающая скобка
    }
    if (ch === '{') {
      sc.i++;
      const inner = convertFrag(sc, true);
      if (inner === null || sc.i >= s.length || s[sc.i] !== '}') return null;
      sc.i++; // пропускаем '}'
      r += '(' + inner + ')';
      continue;
    }
    if (ch === '$' || ch === '~') { sc.i++; continue; }
    if (ch !== '\\') { r += ch; sc.i++; continue; }

    const rest = s.slice(sc.i);
    const m = /^\\([a-zA-Z]+)/.exec(rest);
    if (!m) {
      // \% \_ \{ \} и пр. — буквальный символ
      if (rest.length >= 2) { r += rest[1]; sc.i += 2; continue; }
      return null;
    }
    const cmd = m[1];
    const cmdLen = m[0].length;

    if (cmd in WORD_MAP) { r += WORD_MAP[cmd]; sc.i += cmdLen; continue; }
    if (GHOST_COMMANDS.has(cmd)) { sc.i += cmdLen; continue; }

    if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
      sc.i += cmdLen;
      const a = readGroup(sc);
      if (!a) return null;
      const b = readGroup(sc);
      if (!b) return null;
      const ea = convertBody(a.text);
      const eb = convertBody(b.text);
      if (ea === null || eb === null) return null;
      r += `((${ea})/(${eb}))`;
      continue;
    }
    if (cmd === 'sqrt') {
      sc.i += cmdLen;
      let root: string | null = null;
      if (sc.i < s.length && s[sc.i] === '[') {
        const j = s.indexOf(']', sc.i);
        if (j < 0) return null;
        root = s.slice(sc.i + 1, j);
        sc.i = j + 1;
      }
      const a = readGroup(sc);
      if (!a) return null;
      const ea = convertBody(a.text);
      if (ea === null) return null;
      r += root === null ? `sqrt(${ea})` : `((${ea})^(1/(${root})))`;
      continue;
    }
    if (FUNC_COMMANDS.has(cmd)) {
      sc.i += cmdLen;
      if (cmd === 'log' && sc.i < s.length && s[sc.i] === '_') {
        sc.i++;
        const base = readGroup(sc);
        if (!base) return null;
        const a = readGroup(sc);
        if (!a) return null;
        const eb = convertBody(base.text);
        const ea = convertBody(a.text);
        if (eb === null || ea === null) return null;
        r += `(log(${ea})/log(${eb}))`;
        continue;
      }
      const a = readGroup(sc);
      if (!a) return null;
      const ea = convertBody(a.text);
      if (ea === null) return null;
      r += `${cmd}(${ea})`;
      continue;
    }
    // неизвестная команда: оставляем как есть (парсер выдаст понятную ошибку)
    r += m[0];
    sc.i += cmdLen;
  }
  if (stopAtBrace) return null; // незакрытая '{'
  return r;
}

export function latexToEquation(src: string): LatexResult {
  const body = convertBody(src);
  if (body === null) return { ok: false, error: 'Незакрытая или лишняя скобка {} в LaTeX-выражении' };
  let eq = body;
  // подстановки нижнего индекса (_{...} или _x) отбрасываем: переменных с индексами нет
  eq = eq.replace(/_\{[^{}]*\}/g, '').replace(/_[a-zA-Z0-9]/g, '');
  eq = eq.trim().replace(/\s+/g, '');
  if (!eq) return { ok: false, error: 'Пустое LaTeX-выражение' };
  if (!/[=<>]/.test(eq)) eq = 'y=' + eq;
  return { ok: true, eq };
}
