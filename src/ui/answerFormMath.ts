// answerFormMath.ts — the arithmetic behind live numbers in an answer.
//
// A `live` answer form (ui/answerForms.ts) declares a few numbers and the
// formulas that follow from them; the reader edits a number and every
// formula recomputes. This is the pure half: reading a number as a person
// writes it ("$4,200", "80%", "1.25"), writing one back in the same style,
// and a small formula reader. Formulas are parsed, never evaluated as
// code: + − × ÷ ^, parentheses, a handful of functions, and names.
//
// Dependency rules: src/ui/ depends only on src/platform/.

/** How a number was written, so a result can be written the same way. */
export interface NumberStyle {
  /** A currency sign written before it: '$', '€', '£', '¥' or ''. */
  readonly prefix: string;
  /** Written as a percent: 80% is the value 0.8. */
  readonly percent: boolean;
  /** Decimals as written; null lets the size of the number decide. */
  readonly decimals: number | null;
  /** Thousands separators as written; null groups from 1,000 up. */
  readonly group: boolean | null;
}

export const PLAIN_STYLE: NumberStyle = { prefix: '', percent: false, decimals: null, group: null };

const LITERAL = /^([$€£¥]?)(-?)([$€£¥]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(%?)$/;

/** A number as a person writes it, or null when the text is not one. */
export function parseLiteral(text: string): { value: number; style: NumberStyle } | null {
  const m = LITERAL.exec(String(text ?? '').replace(/\s+/g, '').replace(/−/g, '-'));
  if (!m) return null;
  const digits = m[4];
  const raw = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(raw)) return null;
  const percent = m[5] === '%';
  const value = (m[2] ? -raw : raw) / (percent ? 100 : 1);
  const dot = digits.indexOf('.');
  return {
    value,
    style: {
      prefix: m[1] || m[3],
      percent,
      decimals: dot >= 0 ? digits.length - dot - 1 : 0,
      group: digits.includes(','),
    },
  };
}

/** Decimals for a number nobody set a style for: fewer as it grows. */
function autoDecimals(abs: number): number {
  if (abs >= 100) return 0;
  if (abs >= 10) return 1;
  if (abs >= 1) return 2;
  return 3;
}

/** A number written in `style`; '–' when it is not a finite number. */
export function formatNumber(value: number, style: NumberStyle = PLAIN_STYLE): string {
  if (!Number.isFinite(value)) return '–';
  const shown = style.percent ? value * 100 : value;
  const abs = Math.abs(shown);
  const auto = style.decimals === null;
  const decimals = auto ? autoDecimals(abs) : Math.min(style.decimals!, 10);
  let body = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: style.group ?? abs >= 1000,
  });
  if (auto && body.includes('.')) body = body.replace(/\.?0+$/, '');
  const negative = shown < 0 && Number(body.replace(/,/g, '')) !== 0;
  return `${negative ? '-' : ''}${style.prefix}${body}${style.percent ? '%' : ''}`;
}

// ── Formulas ────────────────────────────────────────────────────────────────

export type FormulaNode =
  | { readonly k: 'num'; readonly v: number }
  | { readonly k: 'var'; readonly name: string }
  | { readonly k: 'neg'; readonly a: FormulaNode }
  | { readonly k: 'bin'; readonly op: '+' | '-' | '*' | '/' | '^'; readonly a: FormulaNode; readonly b: FormulaNode }
  | { readonly k: 'call'; readonly fn: string; readonly args: readonly FormulaNode[] };

const FUNCTIONS: Readonly<Record<string, (...xs: number[]) => number>> = {
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
  abs: (x) => Math.abs(x),
  sqrt: (x) => Math.sqrt(x),
  exp: (x) => Math.exp(x),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  pow: (x, y) => Math.pow(x, y),
  round: (x, d = 0) => { const f = Math.pow(10, Math.round(d)); return Math.round(x * f) / f; },
};

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  const s = src.replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)(%?)/.exec(s.slice(i));
    if (num) {
      const v = Number(num[0].replace('%', ''));
      out.push({ t: 'num', v: num[1] ? v / 100 : v });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    return null;
  }
  return out;
}

/** A formula's tree, or null when it is not one this reader understands. */
export function parseFormula(src: string): FormulaNode | null {
  const toks = tokenize(src);
  if (!toks || toks.length === 0) return null;
  let p = 0;
  const peek = (v: string): boolean => toks[p]?.t === 'op' && toks[p].v === v;
  const expr = (): FormulaNode | null => {
    let a = term();
    while (a && (peek('+') || peek('-'))) {
      const op = toks[p++].v as '+' | '-';
      const b = term();
      a = b ? { k: 'bin', op, a, b } : null;
    }
    return a;
  };
  const term = (): FormulaNode | null => {
    let a = unary();
    while (a && (peek('*') || peek('/'))) {
      const op = toks[p++].v as '*' | '/';
      const b = unary();
      a = b ? { k: 'bin', op, a, b } : null;
    }
    return a;
  };
  const unary = (): FormulaNode | null => {
    if (peek('-')) { p++; const a = unary(); return a ? { k: 'neg', a } : null; }
    if (peek('+')) { p++; return unary(); }
    return power();
  };
  const power = (): FormulaNode | null => {
    const a = primary();
    if (a && peek('^')) { p++; const b = unary(); return b ? { k: 'bin', op: '^', a, b } : null; }
    return a;
  };
  const primary = (): FormulaNode | null => {
    const tok = toks[p];
    if (!tok) return null;
    if (tok.t === 'num') { p++; return { k: 'num', v: tok.v }; }
    if (tok.t === 'id') {
      p++;
      if (!peek('(')) return { k: 'var', name: tok.v };
      const fn = tok.v.toLowerCase();
      if (!FUNCTIONS[fn]) return null;
      p++;
      const args: FormulaNode[] = [];
      if (!peek(')')) {
        for (;;) {
          const a = expr();
          if (!a) return null;
          args.push(a);
          if (peek(',')) { p++; continue; }
          break;
        }
      }
      if (!peek(')')) return null;
      p++;
      return { k: 'call', fn, args };
    }
    if (peek('(')) {
      p++;
      const a = expr();
      if (!a || !peek(')')) return null;
      p++;
      return a;
    }
    return null;
  };
  const tree = expr();
  return tree && p === toks.length ? tree : null;
}

/** Every name a formula reads, in order of first use. */
export function formulaNames(node: FormulaNode): string[] {
  const out: string[] = [];
  const walk = (n: FormulaNode): void => {
    if (n.k === 'var') { if (!out.includes(n.name)) out.push(n.name); }
    else if (n.k === 'neg') walk(n.a);
    else if (n.k === 'bin') { walk(n.a); walk(n.b); }
    else if (n.k === 'call') n.args.forEach(walk);
  };
  walk(node);
  return out;
}

/** A value and the currency it carries ('' for none). */
export interface Quantity { readonly v: number; readonly unit: string }

/**
 * Evaluate a formula. A currency follows the arithmetic: a sum or a
 * product keeps the one its operands carry, and a ratio of two amounts in
 * the same currency carries none.
 */
export function evaluateFormula(node: FormulaNode, values: ReadonlyMap<string, Quantity>): Quantity {
  switch (node.k) {
    case 'num': return { v: node.v, unit: '' };
    case 'var': return values.get(node.name) ?? { v: NaN, unit: '' };
    case 'neg': { const a = evaluateFormula(node.a, values); return { v: -a.v, unit: a.unit }; }
    case 'call': {
      const args = node.args.map((a) => evaluateFormula(a, values));
      const fn = FUNCTIONS[node.fn];
      return { v: fn ? fn(...args.map((a) => a.v)) : NaN, unit: args[0]?.unit ?? '' };
    }
    case 'bin': {
      const a = evaluateFormula(node.a, values);
      const b = evaluateFormula(node.b, values);
      switch (node.op) {
        case '+': return { v: a.v + b.v, unit: a.unit || b.unit };
        case '-': return { v: a.v - b.v, unit: a.unit || b.unit };
        case '*': return { v: a.v * b.v, unit: a.unit || b.unit };
        case '/': return { v: a.v / b.v, unit: a.unit && a.unit === b.unit ? '' : a.unit };
        case '^': return { v: Math.pow(a.v, b.v), unit: a.unit };
      }
    }
  }
}

/** How an operator is printed in a worked sum. */
export function operatorSign(op: '+' | '-' | '*' | '/' | '^'): string {
  return op === '*' ? '×' : op === '/' ? '÷' : op === '-' ? '−' : op;
}

/** A formula printed for a reader: × ÷ − and spaced operators. */
export function formatFormula(node: FormulaNode, labelOf: (name: string) => string = (n) => n): string {
  const prec = (n: FormulaNode): number => (n.k === 'bin' ? ({ '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 })[n.op] : 4);
  const show = (n: FormulaNode): string => {
    switch (n.k) {
      case 'num': return formatNumber(n.v);
      case 'var': return labelOf(n.name);
      case 'neg': return `−${prec(n.a) < 4 ? `(${show(n.a)})` : show(n.a)}`;
      case 'call': return `${n.fn}(${n.args.map(show).join(', ')})`;
      case 'bin': {
        const p = prec(n);
        const left = prec(n.a) < p ? `(${show(n.a)})` : show(n.a);
        const right = prec(n.b) < p || (prec(n.b) === p && (n.op === '-' || n.op === '/')) ? `(${show(n.b)})` : show(n.b);
        return `${left} ${operatorSign(n.op)} ${right}`;
      }
    }
  };
  return show(node);
}
