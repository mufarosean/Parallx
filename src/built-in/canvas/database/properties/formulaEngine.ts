// formulaEngine.ts — Formula property expression evaluator
//
// A formula property computes a read-only value from an expression that
// references other properties in the same row. The engine provides:
//   - Tokenizer: source string → token stream
//   - Parser: token stream → AST (recursive descent)
//   - Evaluator: AST + row property values → computed value
//   - Type inference: AST → output type (text, number, date, boolean)
//
// Gate compliance: imports only from databaseRegistry (parent gate).

import type {
  IPropertyValue,
  IDatabaseProperty,
  PropertyType,
} from '../databaseRegistry.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Token types produced by the tokenizer. */
export type TokenType =
  | 'number'       // 42, 3.14
  | 'string'       // "hello", 'world'
  | 'boolean'      // true, false
  | 'identifier'   // function names
  | 'lparen'       // (
  | 'rparen'       // )
  | 'comma'        // ,
  | 'plus'         // +
  | 'minus'        // -
  | 'star'         // *
  | 'slash'        // /
  | 'percent'      // %
  | 'eq'           // ==
  | 'neq'          // !=
  | 'lt'           // <
  | 'lte'          // <=
  | 'gt'           // >
  | 'gte'          // >=
  | 'eof';         // end of input

/** A single token from the tokenizer. */
export interface IToken {
  readonly type: TokenType;
  readonly value: string;
  readonly pos: number;
}

/** AST node types for the expression tree. */
export type ASTNodeType =
  | 'number_literal'
  | 'string_literal'
  | 'boolean_literal'
  | 'unary'
  | 'binary'
  | 'call'
  | 'comparison';

/** Base AST node. */
export interface IASTNode {
  readonly type: ASTNodeType;
}

export interface INumberLiteral extends IASTNode {
  readonly type: 'number_literal';
  readonly value: number;
}

export interface IStringLiteral extends IASTNode {
  readonly type: 'string_literal';
  readonly value: string;
}

export interface IBooleanLiteral extends IASTNode {
  readonly type: 'boolean_literal';
  readonly value: boolean;
}

export interface IUnaryNode extends IASTNode {
  readonly type: 'unary';
  readonly operator: '+' | '-';
  readonly operand: ASTExpression;
}

export interface IBinaryNode extends IASTNode {
  readonly type: 'binary';
  readonly operator: '+' | '-' | '*' | '/' | '%';
  readonly left: ASTExpression;
  readonly right: ASTExpression;
}

export interface IComparisonNode extends IASTNode {
  readonly type: 'comparison';
  readonly operator: '==' | '!=' | '<' | '<=' | '>' | '>=';
  readonly left: ASTExpression;
  readonly right: ASTExpression;
}

export interface ICallNode extends IASTNode {
  readonly type: 'call';
  readonly name: string;
  readonly args: ASTExpression[];
}

/** Discriminated union of all AST expression types. */
export type ASTExpression =
  | INumberLiteral
  | IStringLiteral
  | IBooleanLiteral
  | IUnaryNode
  | IBinaryNode
  | IComparisonNode
  | ICallNode;

/** Formula output type used for renderer dispatch. */
export type FormulaOutputType = 'number' | 'string' | 'date' | 'boolean';

/** Result of a formula evaluation. */
export interface IFormulaResult {
  readonly type: FormulaOutputType;
  readonly value: unknown;
  readonly error?: string;
}

/** Error produced by the formula engine (parse or runtime). */
export class FormulaError extends Error {
  constructor(
    message: string,
    readonly pos?: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tokenizer
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tokenize a formula expression string into a stream of tokens.
 * @throws FormulaError on unexpected characters
 */
export function tokenize(source: string): IToken[] {
  const tokens: IToken[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Number literal
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < source.length && ((source[i] >= '0' && source[i] <= '9') || source[i] === '.')) i++;
      tokens.push({ type: 'number', value: source.slice(start, i), pos: start });
      continue;
    }

    // String literal (double or single quotes)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++; // skip opening quote
      let str = '';
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < source.length) {
          i++;
          str += source[i];
        } else {
          str += source[i];
        }
        i++;
      }
      if (i >= source.length) throw new FormulaError(`Unterminated string at position ${start}`, start);
      i++; // skip closing quote
      tokens.push({ type: 'string', value: str, pos: start });
      continue;
    }

    // Identifiers and keywords (true, false, function names)
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      const start = i;
      while (i < source.length && ((source[i] >= 'a' && source[i] <= 'z') || (source[i] >= 'A' && source[i] <= 'Z') || (source[i] >= '0' && source[i] <= '9') || source[i] === '_')) i++;
      const word = source.slice(start, i);
      if (word === 'true' || word === 'false') {
        tokens.push({ type: 'boolean', value: word, pos: start });
      } else {
        tokens.push({ type: 'identifier', value: word, pos: start });
      }
      continue;
    }

    // Two-character operators
    if (i + 1 < source.length) {
      const two = source.slice(i, i + 2);
      if (two === '==') { tokens.push({ type: 'eq', value: '==', pos: i }); i += 2; continue; }
      if (two === '!=') { tokens.push({ type: 'neq', value: '!=', pos: i }); i += 2; continue; }
      if (two === '<=') { tokens.push({ type: 'lte', value: '<=', pos: i }); i += 2; continue; }
      if (two === '>=') { tokens.push({ type: 'gte', value: '>=', pos: i }); i += 2; continue; }
    }

    // Single-character tokens
    switch (ch) {
      case '(': tokens.push({ type: 'lparen', value: '(', pos: i }); i++; continue;
      case ')': tokens.push({ type: 'rparen', value: ')', pos: i }); i++; continue;
      case ',': tokens.push({ type: 'comma', value: ',', pos: i }); i++; continue;
      case '+': tokens.push({ type: 'plus', value: '+', pos: i }); i++; continue;
      case '-': tokens.push({ type: 'minus', value: '-', pos: i }); i++; continue;
      case '*': tokens.push({ type: 'star', value: '*', pos: i }); i++; continue;
      case '/': tokens.push({ type: 'slash', value: '/', pos: i }); i++; continue;
      case '%': tokens.push({ type: 'percent', value: '%', pos: i }); i++; continue;
      case '<': tokens.push({ type: 'lt', value: '<', pos: i }); i++; continue;
      case '>': tokens.push({ type: 'gt', value: '>', pos: i }); i++; continue;
    }

    throw new FormulaError(`Unexpected character '${ch}' at position ${i}`, i);
  }

  tokens.push({ type: 'eof', value: '', pos: i });
  return tokens;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parser (Recursive Descent)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse a token stream into an AST expression.
 *
 * Grammar (precedence low → high):
 *   expression  = comparison
 *   comparison  = addition (('==' | '!=' | '<' | '<=' | '>' | '>=') addition)*
 *   addition    = multiplication (('+' | '-') multiplication)*
 *   multiplication = unary (('*' | '/' | '%') unary)*
 *   unary       = ('-' | '+') unary | call
 *   call        = identifier '(' arglist? ')' | primary
 *   primary     = number | string | boolean | '(' expression ')'
 *
 * @throws FormulaError on syntax errors
 */
export function parse(tokens: IToken[]): ASTExpression {
  let pos = 0;

  function peek(): IToken { return tokens[pos]; }
  function advance(): IToken { return tokens[pos++]; }
  function expect(type: TokenType): IToken {
    const t = peek();
    if (t.type !== type) throw new FormulaError(`Expected ${type} but got ${t.type} at position ${t.pos}`, t.pos);
    return advance();
  }

  function expression(): ASTExpression {
    return comparison();
  }

  function comparison(): ASTExpression {
    let left = addition();
    while (peek().type === 'eq' || peek().type === 'neq' || peek().type === 'lt' || peek().type === 'lte' || peek().type === 'gt' || peek().type === 'gte') {
      const op = advance().value as IComparisonNode['operator'];
      const right = addition();
      left = { type: 'comparison', operator: op, left, right };
    }
    return left;
  }

  function addition(): ASTExpression {
    let left = multiplication();
    while (peek().type === 'plus' || peek().type === 'minus') {
      const op = advance().value as IBinaryNode['operator'];
      const right = multiplication();
      left = { type: 'binary', operator: op, left, right };
    }
    return left;
  }

  function multiplication(): ASTExpression {
    let left = unary();
    while (peek().type === 'star' || peek().type === 'slash' || peek().type === 'percent') {
      const op = advance().value as IBinaryNode['operator'];
      const right = unary();
      left = { type: 'binary', operator: op, left, right };
    }
    return left;
  }

  function unary(): ASTExpression {
    if (peek().type === 'minus' || peek().type === 'plus') {
      const op = advance().value as IUnaryNode['operator'];
      const operand = unary();
      return { type: 'unary', operator: op, operand };
    }
    return call();
  }

  function call(): ASTExpression {
    if (peek().type === 'identifier' && pos + 1 < tokens.length && tokens[pos + 1].type === 'lparen') {
      const name = advance().value;
      advance(); // consume '('
      const args: ASTExpression[] = [];
      if (peek().type !== 'rparen') {
        args.push(expression());
        while (peek().type === 'comma') {
          advance(); // consume ','
          args.push(expression());
        }
      }
      expect('rparen');
      return { type: 'call', name, args };
    }
    return primary();
  }

  function primary(): ASTExpression {
    const t = peek();
    switch (t.type) {
      case 'number':
        advance();
        return { type: 'number_literal', value: parseFloat(t.value) };
      case 'string':
        advance();
        return { type: 'string_literal', value: t.value };
      case 'boolean':
        advance();
        return { type: 'boolean_literal', value: t.value === 'true' };
      case 'lparen': {
        advance();
        const expr = expression();
        expect('rparen');
        return expr;
      }
      default:
        throw new FormulaError(`Unexpected token '${t.value}' at position ${t.pos}`, t.pos);
    }
  }

  const ast = expression();
  if (peek().type !== 'eof') {
    const t = peek();
    throw new FormulaError(`Unexpected token '${t.value}' at position ${t.pos}`, t.pos);
  }
  return ast;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Evaluator
// ═══════════════════════════════════════════════════════════════════════════════

/** Property resolver context — maps property names to their values. */
export type PropertyResolver = (name: string) => unknown;

/**
 * Build a PropertyResolver from row values + property definitions.
 * The resolver maps property names to their extracted primitive values.
 */
export function buildPropertyResolver(
  rowValues: Record<string, IPropertyValue>,
  properties: IDatabaseProperty[],
): PropertyResolver {
  const nameToValue = new Map<string, unknown>();

  for (const prop of properties) {
    const val = rowValues[prop.id];
    nameToValue.set(prop.name, extractPrimitive(prop.type, val));
  }

  return (name: string) => {
    if (nameToValue.has(name)) return nameToValue.get(name);
    throw new FormulaError(`Unknown property "${name}"`);
  };
}

/**
 * Extract a primitive JS value from an IPropertyValue for formula use.
 */
function extractPrimitive(_type: PropertyType, value: IPropertyValue | undefined): unknown {
  if (!value) return null;
  switch (value.type) {
    case 'title': return value.title.map(s => s.content).join('');
    case 'rich_text': return value.rich_text.map(s => s.content).join('');
    case 'number': return value.number;
    case 'checkbox': return value.checkbox;
    case 'select': return value.select?.name ?? null;
    case 'multi_select': return value.multi_select.map(s => s.name).join(', ');
    case 'status': return value.status?.name ?? null;
    case 'date': return value.date?.start ?? null;
    case 'url': return value.url ?? null;
    case 'email': return value.email ?? null;
    case 'phone_number': return value.phone_number ?? null;
    case 'created_time': return value.created_time ?? null;
    case 'last_edited_time': return value.last_edited_time ?? null;
    default: return null;
  }
}

// ─── Built-in Functions ──────────────────────────────────────────────────────

/** Registry of built-in formula functions. */
const BUILTIN_FUNCTIONS: Record<string, (args: unknown[]) => unknown> = {
  // ── Property reference ──
  // prop() is handled specially in evaluate() — it uses the PropertyResolver

  // ── Conditional ──
  if: (args) => {
    if (args.length < 2) throw new FormulaError('if() requires at least 2 arguments');
    return _toBool(args[0]) ? args[1] : (args[2] ?? null);
  },
  ifs: (args) => {
    if (args.length < 2 || args.length % 2 !== 0) throw new FormulaError('ifs() requires pairs of (condition, value)');
    for (let i = 0; i < args.length; i += 2) {
      if (_toBool(args[i])) return args[i + 1];
    }
    return null;
  },

  // ── Arithmetic ──
  abs: (args) => Math.abs(_toNum(args[0])),
  ceil: (args) => Math.ceil(_toNum(args[0])),
  floor: (args) => Math.floor(_toNum(args[0])),
  round: (args) => {
    const n = _toNum(args[0]);
    const places = args.length > 1 ? _toNum(args[1]) : 0;
    const factor = Math.pow(10, places);
    return Math.round(n * factor) / factor;
  },
  min: (args) => Math.min(...args.map(_toNum)),
  max: (args) => Math.max(...args.map(_toNum)),
  sqrt: (args) => {
    const n = _toNum(args[0]);
    if (n < 0) throw new FormulaError('sqrt() of negative number');
    return Math.sqrt(n);
  },

  // ── String ──
  length: (args) => _toStr(args[0]).length,
  contains: (args) => _toStr(args[0]).includes(_toStr(args[1])),
  replace: (args) => _toStr(args[0]).replace(_toStr(args[1]), _toStr(args[2] ?? '')),
  replaceall: (args) => _toStr(args[0]).split(_toStr(args[1])).join(_toStr(args[2] ?? '')),
  concat: (args) => args.map(_toStr).join(''),
  join: (args) => {
    const sep = _toStr(args[0]);
    return args.slice(1).map(_toStr).join(sep);
  },
  slice: (args) => {
    const str = _toStr(args[0]);
    const start = _toNum(args[1]);
    const end = args.length > 2 ? _toNum(args[2]) : undefined;
    return str.slice(start, end);
  },
  lower: (args) => _toStr(args[0]).toLowerCase(),
  upper: (args) => _toStr(args[0]).toUpperCase(),
  trim: (args) => _toStr(args[0]).trim(),

  // ── Date ──
  now: () => new Date().toISOString(),
  today: () => _formatDateISO(new Date()),
  dateadd: (args) => {
    const date = new Date(_toStr(args[0]));
    const amount = _toNum(args[1]);
    const unit = _toStr(args[2]).toLowerCase();
    return _formatDateISO(_dateAdd(date, amount, unit));
  },
  datesubtract: (args) => {
    const date = new Date(_toStr(args[0]));
    const amount = _toNum(args[1]);
    const unit = _toStr(args[2]).toLowerCase();
    return _formatDateISO(_dateAdd(date, -amount, unit));
  },
  datebetween: (args) => {
    const d1 = new Date(_toStr(args[0])).getTime();
    const d2 = new Date(_toStr(args[1])).getTime();
    const unit = _toStr(args[2]).toLowerCase();
    return _dateDiff(d1, d2, unit);
  },
  formatdate: (args) => {
    const date = new Date(_toStr(args[0]));
    const fmt = args.length > 1 ? _toStr(args[1]) : 'YYYY-MM-DD';
    return _formatDateString(date, fmt);
  },
  minute: (args) => new Date(_toStr(args[0])).getUTCMinutes(),
  hour: (args) => new Date(_toStr(args[0])).getUTCHours(),
  day: (args) => new Date(_toStr(args[0])).getUTCDate(),
  month: (args) => new Date(_toStr(args[0])).getUTCMonth() + 1,
  year: (args) => new Date(_toStr(args[0])).getUTCFullYear(),

  // ── Logical ──
  and: (args) => args.every(_toBool),
  or: (args) => args.some(_toBool),
  not: (args) => !_toBool(args[0]),
  empty: (args) => args[0] == null || args[0] === '' || args[0] === 0,
  equal: (args) => args[0] === args[1],
  unequal: (args) => args[0] !== args[1],

  // ── Type conversion ──
  tonumber: (args) => {
    const v = args[0];
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const n = Number(v);
      if (isNaN(n)) throw new FormulaError(`Cannot convert "${v}" to number`);
      return n;
    }
    return 0;
  },
  toboolean: (args) => _toBool(args[0]),
};

// ─── Type Coercion Helpers ───────────────────────────────────────────────────

function _toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function _toStr(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

function _toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  return v != null;
}

// ─── Date Helpers ────────────────────────────────────────────────────────────

function _formatDateISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _dateAdd(date: Date, amount: number, unit: string): Date {
  const d = new Date(date);
  switch (unit) {
    case 'years': case 'year': d.setUTCFullYear(d.getUTCFullYear() + amount); break;
    case 'months': case 'month': d.setUTCMonth(d.getUTCMonth() + amount); break;
    case 'weeks': case 'week': d.setUTCDate(d.getUTCDate() + amount * 7); break;
    case 'days': case 'day': d.setUTCDate(d.getUTCDate() + amount); break;
    case 'hours': case 'hour': d.setUTCHours(d.getUTCHours() + amount); break;
    case 'minutes': case 'minute': d.setUTCMinutes(d.getUTCMinutes() + amount); break;
    default: throw new FormulaError(`Unknown date unit "${unit}"`);
  }
  return d;
}

function _dateDiff(ms1: number, ms2: number, unit: string): number {
  const diff = ms2 - ms1;
  switch (unit) {
    case 'years': case 'year': return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
    case 'months': case 'month': return Math.floor(diff / (30.44 * 24 * 60 * 60 * 1000));
    case 'weeks': case 'week': return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
    case 'days': case 'day': return Math.floor(diff / (24 * 60 * 60 * 1000));
    case 'hours': case 'hour': return Math.floor(diff / (60 * 60 * 1000));
    case 'minutes': case 'minute': return Math.floor(diff / (60 * 1000));
    default: throw new FormulaError(`Unknown date unit "${unit}"`);
  }
}

function _formatDateString(date: Date, fmt: string): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return fmt
    .replace('YYYY', String(y))
    .replace('YY', String(y).slice(-2))
    .replace('MM', String(m).padStart(2, '0'))
    .replace('DD', String(d).padStart(2, '0'))
    .replace('M', String(m))
    .replace('D', String(d));
}

// ─── AST Evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate an AST expression with a property resolver.
 * @throws FormulaError on runtime errors (division by zero, type mismatch, etc.)
 */
export function evaluate(ast: ASTExpression, resolver: PropertyResolver): unknown {
  switch (ast.type) {
    case 'number_literal':
      return ast.value;
    case 'string_literal':
      return ast.value;
    case 'boolean_literal':
      return ast.value;

    case 'unary': {
      const val = _toNum(evaluate(ast.operand, resolver));
      return ast.operator === '-' ? -val : val;
    }

    case 'binary': {
      const left = evaluate(ast.left, resolver);
      const right = evaluate(ast.right, resolver);

      // String concatenation with +
      if (ast.operator === '+' && (typeof left === 'string' || typeof right === 'string')) {
        return _toStr(left) + _toStr(right);
      }

      const l = _toNum(left);
      const r = _toNum(right);

      switch (ast.operator) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/':
          if (r === 0) throw new FormulaError('Division by zero');
          return l / r;
        case '%':
          if (r === 0) throw new FormulaError('Modulo by zero');
          return l % r;
      }
      break;
    }

    case 'comparison': {
      const left = evaluate(ast.left, resolver);
      const right = evaluate(ast.right, resolver);

      // Numeric comparison
      if (typeof left === 'number' && typeof right === 'number') {
        switch (ast.operator) {
          case '==': return left === right;
          case '!=': return left !== right;
          case '<':  return left < right;
          case '<=': return left <= right;
          case '>':  return left > right;
          case '>=': return left >= right;
        }
      }

      // String comparison
      const ls = _toStr(left);
      const rs = _toStr(right);
      switch (ast.operator) {
        case '==': return ls === rs;
        case '!=': return ls !== rs;
        case '<':  return ls < rs;
        case '<=': return ls <= rs;
        case '>':  return ls > rs;
        case '>=': return ls >= rs;
      }
      break;
    }

    case 'call': {
      const name = ast.name.toLowerCase();

      // Special: prop() resolves property by name
      if (name === 'prop') {
        if (ast.args.length !== 1) throw new FormulaError('prop() requires exactly 1 argument');
        const propName = evaluate(ast.args[0], resolver);
        if (typeof propName !== 'string') throw new FormulaError('prop() argument must be a string');
        return resolver(propName);
      }

      // Evaluate all arguments
      const args = ast.args.map(a => evaluate(a, resolver));

      const fn = BUILTIN_FUNCTIONS[name];
      if (!fn) throw new FormulaError(`Unknown function "${ast.name}"`);

      return fn(args);
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Type Inference
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Infer the output type of a formula expression from its AST.
 * This is a heuristic — it examines the top-level node to determine
 * the most likely output type for renderer dispatch.
 */
export function inferOutputType(ast: ASTExpression): FormulaOutputType {
  switch (ast.type) {
    case 'number_literal':
      return 'number';
    case 'string_literal':
      return 'string';
    case 'boolean_literal':
      return 'boolean';
    case 'unary':
      return 'number';
    case 'binary':
      return 'number'; // arithmetic always produces number (string concat is a special case but we default to number)
    case 'comparison':
      return 'boolean';
    case 'call': {
      const name = ast.name.toLowerCase();
      // Date functions
      if (['now', 'today', 'dateadd', 'datesubtract', 'formatdate'].includes(name)) return 'date';
      if (['datebetween', 'minute', 'hour', 'day', 'month', 'year'].includes(name)) return 'number';
      // Numeric functions
      if (['abs', 'ceil', 'floor', 'round', 'min', 'max', 'sqrt', 'length', 'tonumber'].includes(name)) return 'number';
      // Boolean functions
      if (['and', 'or', 'not', 'empty', 'equal', 'unequal', 'contains', 'toboolean'].includes(name)) return 'boolean';
      // String functions
      if (['concat', 'join', 'slice', 'lower', 'upper', 'trim', 'replace', 'replaceall'].includes(name)) return 'string';
      // prop() and if/ifs — could return anything
      return 'string';
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract all prop() references from an AST to determine formula dependencies.
 */
export function extractPropReferences(ast: ASTExpression): string[] {
  const refs: string[] = [];
  _walkAst(ast, (node) => {
    if (node.type === 'call' && node.name.toLowerCase() === 'prop' && node.args.length === 1) {
      const arg = node.args[0];
      if (arg.type === 'string_literal') {
        refs.push(arg.value);
      }
    }
  });
  return refs;
}

/** Walk the AST depth-first, calling visitor on each node. */
function _walkAst(node: ASTExpression, visitor: (node: ASTExpression) => void): void {
  visitor(node);
  switch (node.type) {
    case 'unary':
      _walkAst(node.operand, visitor);
      break;
    case 'binary':
    case 'comparison':
      _walkAst(node.left, visitor);
      _walkAst(node.right, visitor);
      break;
    case 'call':
      for (const arg of node.args) _walkAst(arg, visitor);
      break;
  }
}

/**
 * Compile and evaluate a formula expression for a row.
 *
 * This is the primary entry point. It:
 * 1. Tokenizes the expression
 * 2. Parses into an AST
 * 3. Evaluates with the row's property values
 * 4. Returns a typed result
 *
 * @returns IFormulaResult with value and inferred output type
 */
export function evaluateFormula(
  expression: string,
  rowValues: Record<string, IPropertyValue>,
  properties: IDatabaseProperty[],
): IFormulaResult {
  try {
    const tokens = tokenize(expression);
    const ast = parse(tokens);
    const resolver = buildPropertyResolver(rowValues, properties);
    const value = evaluate(ast, resolver);
    const type = inferOutputType(ast);

    return { type, value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type: 'string', value: null, error: message };
  }
}

/**
 * Parse an expression and return its AST + output type without evaluating.
 * Useful for validation and type display in the UI.
 */
export function parseFormula(expression: string): { ast: ASTExpression; outputType: FormulaOutputType } | { error: string } {
  try {
    const tokens = tokenize(expression);
    const ast = parse(tokens);
    return { ast, outputType: inferOutputType(ast) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}
