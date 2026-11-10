// formula.ts — the formula property's language (pure; docs/DATABASES.md step 6).
//
// Notion's shape: an expression over the row's other properties, read with
// prop("Name"). Numbers, text, booleans, dates (as the stored "YYYY-MM-DD"
// or "YYYY-MM-DDTHH:mm" strings) and lists. Operators + - * / % ^, the
// comparisons, and, or, not, the ternary, and the common functions. A wrong
// formula gives a FormulaError, shown in the cell; nothing is ever stored.
//
//   parseFormula(text)                    → an AST, or throws FormulaError
//   evaluateFormula(ast, resolve)         → a value, or throws FormulaError
//   formulaValue(text, resolve)           → a value, or { error }
//   formulaResultType(value)              → how a cell shows it

export class FormulaError extends Error {
  constructor(message: string, readonly at?: number) { super(message); this.name = 'FormulaError'; }
}

export type FormulaValue = number | string | boolean | null | FormulaValue[];
export interface IFormulaErrorValue { readonly error: string }
export function isFormulaError(v: unknown): v is IFormulaErrorValue {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as IFormulaErrorValue).error === 'string' && Object.keys(v as object).length === 1;
}

// ── Lexer ────────────────────────────────────────────────────────────────────

type Tok =
  | { kind: 'num'; value: number; at: number }
  | { kind: 'str'; value: string; at: number }
  | { kind: 'id'; value: string; at: number }
  | { kind: 'op'; value: string; at: number }
  | { kind: 'end'; at: number };

const OPS = ['==', '!=', '>=', '<=', '&&', '||', '+', '-', '*', '/', '%', '^', '>', '<', '!', '(', ')', ',', '?', ':', '.'];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(src.slice(i))!;
      out.push({ kind: 'num', value: Number(m[0]), at: i }); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) { j++; s += src[j] === 'n' ? '\n' : src[j]; } else s += src[j]; j++; }
      if (j >= src.length) throw new FormulaError('A quote was opened and never closed', i);
      out.push({ kind: 'str', value: s, at: i }); i = j + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ kind: 'id', value: m[0], at: i }); i += m[0].length; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaError(`Unexpected "${c}"`, i);
    out.push({ kind: 'op', value: op, at: i }); i += op.length;
  }
  out.push({ kind: 'end', at: src.length });
  return out;
}

// ── Parser (Pratt) ───────────────────────────────────────────────────────────

export type Ast =
  | { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'bool'; v: boolean }
  | { t: 'prop'; name: string }
  | { t: 'un'; op: '-' | '!'; a: Ast }
  | { t: 'bin'; op: string; a: Ast; b: Ast }
  | { t: 'cond'; c: Ast; a: Ast; b: Ast }
  | { t: 'call'; fn: string; args: Ast[] };

const PREC: Record<string, number> = { '?': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 8 };

export function parseFormula(src: string): Ast {
  const toks = lex(src);
  let p = 0;
  const peek = (): Tok => toks[p]!;
  const next = (): Tok => toks[p++]!;
  const expectOp = (v: string): void => { const t = next(); if (t.kind !== 'op' || t.value !== v) throw new FormulaError(`Expected "${v}"`, t.at); };
  const primary = (): Ast => {
    const t = next();
    if (t.kind === 'num') return { t: 'num', v: t.value };
    if (t.kind === 'str') return { t: 'str', v: t.value };
    if (t.kind === 'id') {
      if (t.value === 'true' || t.value === 'false') return { t: 'bool', v: t.value === 'true' };
      if (t.value === 'e') return { t: 'num', v: Math.E };
      if (t.value === 'pi') return { t: 'num', v: Math.PI };
      if (peek().kind === 'op' && (peek() as { value: string }).value === '(') {
        next();
        const args: Ast[] = [];
        if (!(peek().kind === 'op' && (peek() as { value: string }).value === ')')) {
          for (;;) { args.push(expr(0)); const n = next(); if (n.kind === 'op' && n.value === ',') continue; if (n.kind === 'op' && n.value === ')') break; throw new FormulaError('Expected "," or ")"', n.at); }
        } else next();
        if (t.value === 'prop') {
          const a = args[0];
          if (args.length !== 1 || !a || a.t !== 'str') throw new FormulaError('prop() takes a property name in quotes, like prop("Pages")', t.at);
          return { t: 'prop', name: a.v };
        }
        return { t: 'call', fn: t.value, args };
      }
      throw new FormulaError(`Unknown name "${t.value}" (a property is prop("${t.value}"))`, t.at);
    }
    if (t.kind === 'op') {
      if (t.value === '(') { const e = expr(0); expectOp(')'); return e; }
      if (t.value === '-') return { t: 'un', op: '-', a: expr(7) };
      if (t.value === '!') return { t: 'un', op: '!', a: expr(7) };
    }
    throw new FormulaError(t.kind === 'end' ? 'The formula ends too soon' : `Unexpected "${(t as { value: string }).value}"`, t.at);
  };
  const expr = (minPrec: number): Ast => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (t.kind !== 'op') break;
      if (t.value === '.') {
        // Method form: x.round(), text.length(), list.map(…) is not supported; x.fn(args) = fn(x, args).
        next();
        const name = next();
        if (name.kind !== 'id') throw new FormulaError('Expected a function name after "."', name.at);
        const args: Ast[] = [left];
        if (peek().kind === 'op' && (peek() as { value: string }).value === '(') {
          next();
          if (!(peek().kind === 'op' && (peek() as { value: string }).value === ')')) {
            for (;;) { args.push(expr(0)); const n = next(); if (n.kind === 'op' && n.value === ',') continue; if (n.kind === 'op' && n.value === ')') break; throw new FormulaError('Expected "," or ")"', n.at); }
          } else next();
        }
        left = { t: 'call', fn: name.value, args };
        continue;
      }
      const prec = PREC[t.value];
      if (prec === undefined || prec < minPrec) break;
      next();
      if (t.value === '?') {
        const a = expr(0); expectOp(':'); const b = expr(1);
        left = { t: 'cond', c: left, a, b };
        continue;
      }
      const right = expr(t.value === '^' ? prec : prec + 1);
      left = { t: 'bin', op: t.value, a: left, b: right };
    }
    return left;
  };
  const ast = expr(0);
  const end = next();
  if (end.kind !== 'end') throw new FormulaError(`Unexpected "${(end as { value: string }).value}"`, end.at);
  return ast;
}

// ── Evaluator ────────────────────────────────────────────────────────────────

export type PropResolver = (name: string) => unknown;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

function toNum(v: FormulaValue, what = 'a number'): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null) return 0;
  if (typeof v === 'string') { const n = Number(v.trim().replace(/,/g, '')); if (v.trim() !== '' && Number.isFinite(n)) return n; }
  throw new FormulaError(`Expected ${what}, got ${describe(v)}`);
}
function toStr(v: FormulaValue): string {
  if (v === null) return '';
  if (Array.isArray(v)) return v.map(toStr).join(', ');
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  return String(v);
}
function truthy(v: FormulaValue): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== false && v !== 0 && v !== '';
}
function describe(v: FormulaValue): string {
  if (v === null) return 'empty';
  if (Array.isArray(v)) return 'a list';
  return typeof v === 'string' ? `"${v}"` : String(v);
}
function toDate(v: FormulaValue): Date {
  if (typeof v === 'number') return new Date(v);
  if (typeof v !== 'string') throw new FormulaError(`Expected a date, got ${describe(v)}`);
  const m = DATE_RE.exec(v);
  if (!m) throw new FormulaError(`Expected a date, got ${describe(v)}`);
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}
function fromDate(d: Date, withTime: boolean): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${day}T${p(d.getHours())}:${p(d.getMinutes())}` : day;
}
function hasTime(v: FormulaValue): boolean { return typeof v === 'string' && v.length > 10; }

/** Normalise what a property cell holds into a formula value. */
export function toFormulaValue(v: unknown): FormulaValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? String((x as { title?: unknown; name?: unknown }).title ?? (x as { name?: unknown }).name ?? '') : toFormulaValue(x)));
  if (isFormulaError(v)) throw new FormulaError(v.error);
  if (typeof v === 'object') { const o = v as { title?: unknown; name?: unknown }; return String(o.title ?? o.name ?? ''); }
  return null;
}

const UNIT_MS: Record<string, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 };

type Fn = (args: FormulaValue[], ev: (a: Ast) => FormulaValue, raw: Ast[]) => FormulaValue;

const FUNCTIONS: Record<string, Fn> = {
  if: (a) => { if (a.length !== 3) throw new FormulaError('if(condition, then, else) takes three parts'); return truthy(a[0]!) ? a[1]! : a[2]!; },
  ifs: (a) => { for (let i = 0; i + 1 < a.length; i += 2) if (truthy(a[i]!)) return a[i + 1]!; return a.length % 2 ? a[a.length - 1]! : null; },
  empty: (a) => !truthy(a[0] ?? null) && (a[0] ?? null) !== 0 && a[0] !== false,
  not: (a) => !truthy(a[0] ?? null),
  and: (a) => a.every(truthy),
  or: (a) => a.some(truthy),
  equal: (a) => eq(a[0] ?? null, a[1] ?? null),
  unequal: (a) => !eq(a[0] ?? null, a[1] ?? null),
  add: (a) => (typeof a[0] === 'string' || typeof a[1] === 'string' ? toStr(a[0] ?? null) + toStr(a[1] ?? null) : toNum(a[0] ?? null) + toNum(a[1] ?? null)),
  subtract: (a) => toNum(a[0] ?? null) - toNum(a[1] ?? null),
  multiply: (a) => toNum(a[0] ?? null) * toNum(a[1] ?? null),
  divide: (a) => div(toNum(a[0] ?? null), toNum(a[1] ?? null)),
  mod: (a) => toNum(a[0] ?? null) % toNum(a[1] ?? null),
  pow: (a) => Math.pow(toNum(a[0] ?? null), toNum(a[1] ?? null)),
  abs: (a) => Math.abs(toNum(a[0] ?? null)),
  round: (a) => { const n = toNum(a[0] ?? null); const d = a.length > 1 ? toNum(a[1]!) : 0; const f = Math.pow(10, d); return Math.round(n * f) / f; },
  floor: (a) => Math.floor(toNum(a[0] ?? null)),
  ceil: (a) => Math.ceil(toNum(a[0] ?? null)),
  sqrt: (a) => Math.sqrt(toNum(a[0] ?? null)),
  ln: (a) => Math.log(toNum(a[0] ?? null)),
  log10: (a) => Math.log10(toNum(a[0] ?? null)),
  exp: (a) => Math.exp(toNum(a[0] ?? null)),
  sign: (a) => Math.sign(toNum(a[0] ?? null)),
  min: (a) => Math.min(...flat(a).map((x) => toNum(x))),
  max: (a) => Math.max(...flat(a).map((x) => toNum(x))),
  sum: (a) => flat(a).reduce<number>((s, x) => s + toNum(x), 0),
  mean: (a) => { const xs = flat(a); return xs.length ? xs.reduce<number>((s, x) => s + toNum(x), 0) / xs.length : null; },
  median: (a) => { const xs = flat(a).map((x) => toNum(x)).sort((x, y) => x - y); if (!xs.length) return null; const m = xs.length >> 1; return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2; },
  toNumber: (a) => { const v = a[0] ?? null; if (typeof v === 'string') { const n = Number(v.replace(/[^0-9.+\-eE]/g, '')); return Number.isFinite(n) && v.trim() !== '' ? n : null; } if (typeof v === 'boolean') return v ? 1 : 0; if (typeof v === 'number') return v; return null; },
  format: (a) => toStr(a[0] ?? null),
  concat: (a) => a.map(toStr).join(''),
  join: (a) => { const list = Array.isArray(a[0]) ? a[0] : a.slice(0, -1); const sep = Array.isArray(a[0]) ? toStr(a[1] ?? ', ') : toStr(a[a.length - 1] ?? ''); return list.map(toStr).join(sep); },
  length: (a) => (Array.isArray(a[0]) ? a[0].length : toStr(a[0] ?? null).length),
  upper: (a) => toStr(a[0] ?? null).toUpperCase(),
  lower: (a) => toStr(a[0] ?? null).toLowerCase(),
  trim: (a) => toStr(a[0] ?? null).trim(),
  contains: (a) => (Array.isArray(a[0]) ? a[0].some((x) => eq(x, a[1] ?? null)) : toStr(a[0] ?? null).includes(toStr(a[1] ?? null))),
  startsWith: (a) => toStr(a[0] ?? null).startsWith(toStr(a[1] ?? null)),
  endsWith: (a) => toStr(a[0] ?? null).endsWith(toStr(a[1] ?? null)),
  replace: (a) => toStr(a[0] ?? null).replace(new RegExp(toStr(a[1] ?? null)), toStr(a[2] ?? null)),
  replaceAll: (a) => toStr(a[0] ?? null).replace(new RegExp(toStr(a[1] ?? null), 'g'), toStr(a[2] ?? null)),
  test: (a) => new RegExp(toStr(a[1] ?? null)).test(toStr(a[0] ?? null)),
  slice: (a) => { const v = a[0] ?? null; const s = toNum(a[1] ?? 0); const e = a.length > 2 ? toNum(a[2]!) : undefined; return Array.isArray(v) ? v.slice(s, e) : toStr(v).slice(s, e); },
  substring: (a) => toStr(a[0] ?? null).slice(toNum(a[1] ?? 0), a.length > 2 ? toNum(a[2]!) : undefined),
  split: (a) => toStr(a[0] ?? null).split(toStr(a[1] ?? ',')),
  padStart: (a) => toStr(a[0] ?? null).padStart(toNum(a[1] ?? 0), toStr(a[2] ?? ' ')),
  padEnd: (a) => toStr(a[0] ?? null).padEnd(toNum(a[1] ?? 0), toStr(a[2] ?? ' ')),
  repeat: (a) => toStr(a[0] ?? null).repeat(Math.max(0, toNum(a[1] ?? 0))),
  first: (a) => (Array.isArray(a[0]) ? a[0][0] ?? null : a[0] ?? null),
  last: (a) => (Array.isArray(a[0]) ? a[0][a[0].length - 1] ?? null : a[0] ?? null),
  at: (a) => (Array.isArray(a[0]) ? a[0][toNum(a[1] ?? 0)] ?? null : null),
  unique: (a) => { const out: FormulaValue[] = []; for (const x of flat(a)) if (!out.some((y) => eq(x, y))) out.push(x); return out; },
  sort: (a) => [...flat(a)].sort((x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : toStr(x).localeCompare(toStr(y)))),
  reverse: (a) => [...flat(a)].reverse(),
  includes: (a) => flat([a[0] ?? null]).some((x) => eq(x, a[1] ?? null)),
  now: () => fromDate(new Date(), true),
  today: () => fromDate(new Date(), false),
  year: (a) => toDate(a[0] ?? null).getFullYear(),
  month: (a) => toDate(a[0] ?? null).getMonth() + 1,
  date: (a) => toDate(a[0] ?? null).getDate(),
  day: (a) => toDate(a[0] ?? null).getDay(),
  hour: (a) => toDate(a[0] ?? null).getHours(),
  minute: (a) => toDate(a[0] ?? null).getMinutes(),
  timestamp: (a) => toDate(a[0] ?? null).getTime(),
  fromTimestamp: (a) => fromDate(new Date(toNum(a[0] ?? null)), true),
  dateAdd: (a) => shift(a, 1),
  dateSubtract: (a) => shift(a, -1),
  dateBetween: (a) => {
    const unit = toStr(a[2] ?? 'days');
    const ms = toDate(a[0] ?? null).getTime() - toDate(a[1] ?? null).getTime();
    if (unit === 'months') { const x = toDate(a[0] ?? null), y = toDate(a[1] ?? null); return (x.getFullYear() - y.getFullYear()) * 12 + x.getMonth() - y.getMonth(); }
    if (unit === 'years') return toDate(a[0] ?? null).getFullYear() - toDate(a[1] ?? null).getFullYear();
    const u = UNIT_MS[unit]; if (!u) throw new FormulaError(`Unknown unit "${unit}" (minutes, hours, days, weeks, months, years)`);
    return Math.trunc(ms / u);
  },
  formatDate: (a) => { const d = toDate(a[0] ?? null); const f = toStr(a[1] ?? 'YYYY-MM-DD'); const p = (n: number): string => String(n).padStart(2, '0'); return f.replace(/YYYY/g, String(d.getFullYear())).replace(/MMMM/g, d.toLocaleString(undefined, { month: 'long' })).replace(/MMM/g, d.toLocaleString(undefined, { month: 'short' })).replace(/MM/g, p(d.getMonth() + 1)).replace(/DD/g, p(d.getDate())).replace(/HH/g, p(d.getHours())).replace(/mm/g, p(d.getMinutes())); },
  dateStart: (a) => fromDate(toDate(a[0] ?? null), false),
  id: () => null,
};

function flat(a: FormulaValue[]): FormulaValue[] { return a.flatMap((x) => (Array.isArray(x) ? x : [x])).filter((x) => x !== null); }
function div(a: number, b: number): number { if (b === 0) throw new FormulaError('Division by zero'); return a / b; }
function eq(a: FormulaValue, b: FormulaValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  if (typeof a === 'number' || typeof b === 'number') { const x = Number(a), y = Number(b); if (Number.isFinite(x) && Number.isFinite(y)) return x === y; }
  return toStr(a) === toStr(b);
}
function shift(a: FormulaValue[], sign: 1 | -1): string {
  const d = toDate(a[0] ?? null); const n = toNum(a[1] ?? null) * sign; const unit = toStr(a[2] ?? 'days');
  if (unit === 'months') d.setMonth(d.getMonth() + n);
  else if (unit === 'years') d.setFullYear(d.getFullYear() + n);
  else { const u = UNIT_MS[unit]; if (!u) throw new FormulaError(`Unknown unit "${unit}" (minutes, hours, days, weeks, months, years)`); d.setTime(d.getTime() + n * u); }
  return fromDate(d, hasTime(a[0] ?? null) || unit === 'minutes' || unit === 'hours');
}

export function evaluateFormula(ast: Ast, resolve: PropResolver): FormulaValue {
  const ev = (n: Ast): FormulaValue => {
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'bool': return n.v;
      case 'prop': return toFormulaValue(resolve(n.name));
      case 'un': { const v = ev(n.a); return n.op === '-' ? -toNum(v) : !truthy(v); }
      case 'cond': return truthy(ev(n.c)) ? ev(n.a) : ev(n.b);
      case 'bin': {
        if (n.op === '&&') return truthy(ev(n.a)) && truthy(ev(n.b));
        if (n.op === '||') return truthy(ev(n.a)) || truthy(ev(n.b));
        const a = ev(n.a), b = ev(n.b);
        switch (n.op) {
          case '+': return typeof a === 'string' || typeof b === 'string' ? toStr(a) + toStr(b) : toNum(a) + toNum(b);
          case '-': return toNum(a) - toNum(b);
          case '*': return toNum(a) * toNum(b);
          case '/': return div(toNum(a), toNum(b));
          case '%': return toNum(a) % toNum(b);
          case '^': return Math.pow(toNum(a), toNum(b));
          case '==': return eq(a, b);
          case '!=': return !eq(a, b);
          case '<': return cmp(a, b) < 0;
          case '>': return cmp(a, b) > 0;
          case '<=': return cmp(a, b) <= 0;
          case '>=': return cmp(a, b) >= 0;
          default: throw new FormulaError(`Unknown operator ${n.op}`);
        }
      }
      case 'call': {
        // if, ifs, and, or take only the branches they need: an error in a branch not taken is no error.
        if (n.fn === 'if') { if (n.args.length !== 3) throw new FormulaError('if(condition, then, else) takes three parts'); return truthy(ev(n.args[0]!)) ? ev(n.args[1]!) : ev(n.args[2]!); }
        if (n.fn === 'ifs') { for (let i = 0; i + 1 < n.args.length; i += 2) if (truthy(ev(n.args[i]!))) return ev(n.args[i + 1]!); return n.args.length % 2 ? ev(n.args[n.args.length - 1]!) : null; }
        if (n.fn === 'and') { for (const a of n.args) if (!truthy(ev(a))) return false; return true; }
        if (n.fn === 'or') { for (const a of n.args) if (truthy(ev(a))) return true; return false; }
        const fn = FUNCTIONS[n.fn];
        if (!fn) throw new FormulaError(`Unknown function ${n.fn}()`);
        return fn(n.args.map(ev), ev, n.args);
      }
    }
  };
  return ev(ast);
}

function cmp(a: FormulaValue, b: FormulaValue): number {
  if (typeof a === 'number' || typeof b === 'number') return toNum(a) - toNum(b);
  return toStr(a).localeCompare(toStr(b));
}

/** The names a picker offers, with a one-line hint each. */
export const FORMULA_FUNCTIONS: readonly { name: string; hint: string }[] = [
  { name: 'if', hint: 'if(condition, then, else)' }, { name: 'empty', hint: 'empty(value)' }, { name: 'not', hint: 'not(value)' }, { name: 'and', hint: 'and(a, b)' }, { name: 'or', hint: 'or(a, b)' },
  { name: 'round', hint: 'round(number, places)' }, { name: 'abs', hint: 'abs(number)' }, { name: 'floor', hint: 'floor(number)' }, { name: 'ceil', hint: 'ceil(number)' }, { name: 'min', hint: 'min(a, b, …)' }, { name: 'max', hint: 'max(a, b, …)' }, { name: 'sum', hint: 'sum(list)' }, { name: 'mean', hint: 'mean(list)' },
  { name: 'format', hint: 'format(value) as text' }, { name: 'concat', hint: 'concat(a, b, …)' }, { name: 'join', hint: 'join(list, ", ")' }, { name: 'length', hint: 'length(text or list)' }, { name: 'upper', hint: 'upper(text)' }, { name: 'lower', hint: 'lower(text)' }, { name: 'contains', hint: 'contains(text, part)' }, { name: 'replace', hint: 'replace(text, pattern, with)' }, { name: 'slice', hint: 'slice(text, from, to)' }, { name: 'toNumber', hint: 'toNumber(text)' },
  { name: 'now', hint: 'now()' }, { name: 'today', hint: 'today()' }, { name: 'dateAdd', hint: 'dateAdd(date, 7, "days")' }, { name: 'dateSubtract', hint: 'dateSubtract(date, 1, "months")' }, { name: 'dateBetween', hint: 'dateBetween(later, earlier, "days")' }, { name: 'formatDate', hint: 'formatDate(date, "MMM DD, YYYY")' }, { name: 'year', hint: 'year(date)' }, { name: 'month', hint: 'month(date)' }, { name: 'date', hint: 'date(date) the day of the month' },
];

/** A value, or the error to show, for `expression` over a row. */
export function formulaValue(expression: string, resolve: PropResolver, cache?: Map<string, Ast | FormulaError>): FormulaValue | IFormulaErrorValue {
  if (!expression.trim()) return null;
  try {
    let ast = cache?.get(expression);
    if (!ast) { try { ast = parseFormula(expression); } catch (e) { ast = e as FormulaError; } cache?.set(expression, ast); }
    if (ast instanceof FormulaError) throw ast;
    if (!expression.trim()) return null;
    const v = evaluateFormula(ast, resolve);
    return typeof v === 'number' && !Number.isFinite(v) ? { error: 'Not a number' } : v;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** How a cell shows a formula's values: by what they are. */
export function formulaResultType(samples: readonly unknown[]): 'number' | 'checkbox' | 'date' | 'datetime' | 'tags' | 'text' {
  const v = samples.find((x) => x !== null && x !== undefined && x !== '' && !isFormulaError(x));
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'checkbox';
  if (Array.isArray(v)) return 'tags';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return 'datetime';
  return 'text';
}
