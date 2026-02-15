// whenClause.ts — expression parser for when clauses
//
// Implements a recursive-descent parser that compiles when-clause strings
// into an AST, plus an evaluator that resolves them against a context lookup.
//
// Supported syntax (mirrors VS Code's when clause language):
//   • Boolean context keys:        `sidebarVisible`
//   • Negation:                    `!panelVisible`
//   • AND:                         `sidebarVisible && panelVisible`
//   • OR:                          `sidebarVisible || panelVisible`
//   • Equality:                    `activePart == 'workbench.parts.sidebar'`
//   • Inequality:                  `activePart != 'workbench.parts.sidebar'`
//   • Comparisons:                 `editorGroupCount > 1`, `editorGroupCount <= 3`
//   • 'in' operator:              `activeView in sidebarViews`
//   • Parentheses:                `(a || b) && c`
//   • String literals:            `'hello'` or `"hello"`
//   • Numeric literals:           `42`, `3.14`
//   • Boolean literals:           `true`, `false`
//
// Parsed ASTs are cached by expression string for efficient re-evaluation.

// ─── AST Node Types ──────────────────────────────────────────────────────────

export const enum WhenClauseNodeType {
  True = 'true',
  False = 'false',
  Not = 'not',
  And = 'and',
  Or = 'or',
  Equals = 'equals',
  NotEquals = 'notEquals',
  Greater = 'greater',
  GreaterOrEquals = 'greaterOrEquals',
  Less = 'less',
  LessOrEquals = 'lessOrEquals',
  In = 'in',
  ContextKey = 'contextKey',
  Literal = 'literal',
}

type WhenClauseNode =
  | { type: WhenClauseNodeType.True }
  | { type: WhenClauseNodeType.False }
  | { type: WhenClauseNodeType.Not; operand: WhenClauseNode }
  | { type: WhenClauseNodeType.And; left: WhenClauseNode; right: WhenClauseNode }
  | { type: WhenClauseNodeType.Or; left: WhenClauseNode; right: WhenClauseNode }
  | { type: WhenClauseNodeType.Equals; left: WhenClauseNode; right: WhenClauseNode }
  | { type: WhenClauseNodeType.NotEquals; left: WhenClauseNode; right: WhenClauseNode }
  | { type: WhenClauseNodeType.Greater; left: WhenClauseNode; right: WhenClauseNode }
  | { type: WhenClauseNodeType.GreaterOrEquals; left: WhenClauseNode; right: WhenClauseNode }
  | { type: WhenClauseNodeType.Less; left: WhenClauseNode; right: WhenClauseNode }
  | { type: WhenClauseNodeType.LessOrEquals; left: WhenClauseNode; right: WhenClauseNode }
  | { type: WhenClauseNodeType.In; key: WhenClauseNode; collection: WhenClauseNode }
  | { type: WhenClauseNodeType.ContextKey; key: string }
  | { type: WhenClauseNodeType.Literal; value: string | number | boolean };

// ─── Context Lookup ──────────────────────────────────────────────────────────

/**
 * Function that resolves a context key to its current value.
 * Returns undefined if the key is not set.
 */
export type ContextKeyLookup = (key: string) => unknown;

// ─── Tokenizer ───────────────────────────────────────────────────────────────

const enum TokenType {
  Identifier,
  String,
  Number,
  True,
  False,
  And,       // &&
  Or,        // ||
  Not,       // !
  Equals,    // ==
  NotEquals, // !=
  Greater,   // >
  GreaterEq, // >=
  Less,      // <
  LessEq,    // <=
  In,        // in
  LParen,    // (
  RParen,    // )
  EOF,
}

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expression.length;

  while (i < len) {
    // Skip whitespace
    if (expression[i] === ' ' || expression[i] === '\t' || expression[i] === '\n' || expression[i] === '\r') {
      i++;
      continue;
    }

    const start = i;
    const ch = expression[i];

    // Two-character operators
    if (i + 1 < len) {
      const two = expression[i] + expression[i + 1];
      if (two === '&&') { tokens.push({ type: TokenType.And, value: '&&', pos: start }); i += 2; continue; }
      if (two === '||') { tokens.push({ type: TokenType.Or, value: '||', pos: start }); i += 2; continue; }
      if (two === '==') { tokens.push({ type: TokenType.Equals, value: '==', pos: start }); i += 2; continue; }
      if (two === '!=') { tokens.push({ type: TokenType.NotEquals, value: '!=', pos: start }); i += 2; continue; }
      if (two === '>=') { tokens.push({ type: TokenType.GreaterEq, value: '>=', pos: start }); i += 2; continue; }
      if (two === '<=') { tokens.push({ type: TokenType.LessEq, value: '<=', pos: start }); i += 2; continue; }
    }

    // Single-character operators
    if (ch === '!') { tokens.push({ type: TokenType.Not, value: '!', pos: start }); i++; continue; }
    if (ch === '>') { tokens.push({ type: TokenType.Greater, value: '>', pos: start }); i++; continue; }
    if (ch === '<') { tokens.push({ type: TokenType.Less, value: '<', pos: start }); i++; continue; }
    if (ch === '(') { tokens.push({ type: TokenType.LParen, value: '(', pos: start }); i++; continue; }
    if (ch === ')') { tokens.push({ type: TokenType.RParen, value: ')', pos: start }); i++; continue; }

    // String literals
    if (ch === '\'' || ch === '"') {
      const quote = ch;
      i++;
      let str = '';
      while (i < len && expression[i] !== quote) {
        if (expression[i] === '\\' && i + 1 < len) {
          i++;
          str += expression[i];
        } else {
          str += expression[i];
        }
        i++;
      }
      if (i >= len) {
        throw new WhenClauseParseError(`Unterminated string literal at position ${start}`, expression, start);
      }
      i++; // skip closing quote
      tokens.push({ type: TokenType.String, value: str, pos: start });
      continue;
    }

    // Numbers
    if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < len && expression[i + 1] >= '0' && expression[i + 1] <= '9')) {
      let num = '';
      while (i < len && ((expression[i] >= '0' && expression[i] <= '9') || expression[i] === '.')) {
        num += expression[i];
        i++;
      }
      tokens.push({ type: TokenType.Number, value: num, pos: start });
      continue;
    }

    // Identifiers and keywords
    if (_isIdentStart(ch)) {
      let ident = '';
      while (i < len && _isIdentChar(expression[i])) {
        ident += expression[i];
        i++;
      }

      // Keywords
      if (ident === 'true') { tokens.push({ type: TokenType.True, value: 'true', pos: start }); continue; }
      if (ident === 'false') { tokens.push({ type: TokenType.False, value: 'false', pos: start }); continue; }
      if (ident === 'in') { tokens.push({ type: TokenType.In, value: 'in', pos: start }); continue; }
      if (ident === 'not') { tokens.push({ type: TokenType.Not, value: 'not', pos: start }); continue; }

      tokens.push({ type: TokenType.Identifier, value: ident, pos: start });
      continue;
    }

    throw new WhenClauseParseError(
      `Unexpected character '${ch}' at position ${start}`,
      expression,
      start,
    );
  }

  tokens.push({ type: TokenType.EOF, value: '', pos: i });
  return tokens;
}

function _isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function _isIdentChar(ch: string): boolean {
  return _isIdentStart(ch) || (ch >= '0' && ch <= '9') || ch === '.' || ch === '-';
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Error thrown when a when-clause expression cannot be parsed.
 */
class WhenClauseParseError extends Error {
  constructor(message: string, readonly expression: string, readonly position: number) {
    super(`When clause parse error: ${message} in "${expression}"`);
    this.name = 'WhenClauseParseError';
  }
}

/**
 * Recursive-descent parser for when-clause expressions.
 *
 * Grammar:
 *   expr       → orExpr
 *   orExpr     → andExpr ( '||' andExpr )*
 *   andExpr    → notExpr ( '&&' notExpr )*
 *   notExpr    → '!' notExpr | compareExpr
 *   compareExpr → primary ( ('==' | '!=' | '>' | '>=' | '<' | '<=' | 'in') primary )?
 *   primary    → '(' expr ')' | 'true' | 'false' | number | string | identifier
 */
class WhenClauseParser {
  private _tokens: Token[] = [];
  private _pos = 0;

  parse(expression: string): WhenClauseNode {
    if (!expression || expression.trim().length === 0) {
      return { type: WhenClauseNodeType.True };
    }

    this._tokens = tokenize(expression);
    this._pos = 0;

    const node = this._parseOr();

    if (this._peek().type !== TokenType.EOF) {
      const tok = this._peek();
      throw new WhenClauseParseError(
        `Unexpected token '${tok.value}' at position ${tok.pos}`,
        expression,
        tok.pos,
      );
    }

    return node;
  }

  private _peek(): Token {
    return this._tokens[this._pos];
  }

  private _advance(): Token {
    const tok = this._tokens[this._pos];
    this._pos++;
    return tok;
  }

  private _expect(type: TokenType, description: string): Token {
    const tok = this._peek();
    if (tok.type !== type) {
      throw new WhenClauseParseError(
        `Expected ${description} but got '${tok.value}' at position ${tok.pos}`,
        '',
        tok.pos,
      );
    }
    return this._advance();
  }

  // orExpr → andExpr ( '||' andExpr )*
  private _parseOr(): WhenClauseNode {
    let left = this._parseAnd();
    while (this._peek().type === TokenType.Or) {
      this._advance();
      const right = this._parseAnd();
      left = { type: WhenClauseNodeType.Or, left, right };
    }
    return left;
  }

  // andExpr → notExpr ( '&&' notExpr )*
  private _parseAnd(): WhenClauseNode {
    let left = this._parseNot();
    while (this._peek().type === TokenType.And) {
      this._advance();
      const right = this._parseNot();
      left = { type: WhenClauseNodeType.And, left, right };
    }
    return left;
  }

  // notExpr → '!' notExpr | compareExpr
  private _parseNot(): WhenClauseNode {
    if (this._peek().type === TokenType.Not) {
      this._advance();
      const operand = this._parseNot();
      return { type: WhenClauseNodeType.Not, operand };
    }
    return this._parseCompare();
  }

  // compareExpr → primary ( ('==' | '!=' | '>' | '>=' | '<' | '<=' | 'in') primary )?
  private _parseCompare(): WhenClauseNode {
    const left = this._parsePrimary();
    const tok = this._peek();

    switch (tok.type) {
      case TokenType.Equals:
        this._advance();
        return { type: WhenClauseNodeType.Equals, left, right: this._parsePrimary() };
      case TokenType.NotEquals:
        this._advance();
        return { type: WhenClauseNodeType.NotEquals, left, right: this._parsePrimary() };
      case TokenType.Greater:
        this._advance();
        return { type: WhenClauseNodeType.Greater, left, right: this._parsePrimary() };
      case TokenType.GreaterEq:
        this._advance();
        return { type: WhenClauseNodeType.GreaterOrEquals, left, right: this._parsePrimary() };
      case TokenType.Less:
        this._advance();
        return { type: WhenClauseNodeType.Less, left, right: this._parsePrimary() };
      case TokenType.LessEq:
        this._advance();
        return { type: WhenClauseNodeType.LessOrEquals, left, right: this._parsePrimary() };
      case TokenType.In:
        this._advance();
        return { type: WhenClauseNodeType.In, key: left, collection: this._parsePrimary() };
      default:
        return left;
    }
  }

  // primary → '(' expr ')' | 'true' | 'false' | number | string | identifier
  private _parsePrimary(): WhenClauseNode {
    const tok = this._peek();

    switch (tok.type) {
      case TokenType.LParen: {
        this._advance();
        const inner = this._parseOr();
        this._expect(TokenType.RParen, "closing ')'");
        return inner;
      }
      case TokenType.True:
        this._advance();
        return { type: WhenClauseNodeType.Literal, value: true };
      case TokenType.False:
        this._advance();
        return { type: WhenClauseNodeType.Literal, value: false };
      case TokenType.Number:
        this._advance();
        return { type: WhenClauseNodeType.Literal, value: parseFloat(tok.value) };
      case TokenType.String:
        this._advance();
        return { type: WhenClauseNodeType.Literal, value: tok.value };
      case TokenType.Identifier:
        this._advance();
        return { type: WhenClauseNodeType.ContextKey, key: tok.value };
      default:
        throw new WhenClauseParseError(
          `Unexpected token '${tok.value}' at position ${tok.pos}`,
          '',
          tok.pos,
        );
    }
  }
}

// ─── Parse Cache ─────────────────────────────────────────────────────────────

const _parseCache = new Map<string, WhenClauseNode>();
const PARSE_CACHE_MAX_SIZE = 500;

/**
 * Parse a when-clause expression into an AST node.
 * Results are cached (capped at 500 entries) for efficient re-evaluation.
 *
 * @param expression  The when-clause string, e.g. `'sidebarVisible && !panelVisible'`
 * @returns           The parsed AST node
 * @throws            WhenClauseParseError on invalid syntax
 */
export function parseWhenClause(expression: string | undefined): WhenClauseNode {
  if (!expression || expression.trim().length === 0) {
    return { type: WhenClauseNodeType.True };
  }

  const trimmed = expression.trim();
  const cached = _parseCache.get(trimmed);
  if (cached) {
    return cached;
  }

  const parser = new WhenClauseParser();
  const node = parser.parse(trimmed);

  // Evict oldest entries when cache grows too large
  if (_parseCache.size >= PARSE_CACHE_MAX_SIZE) {
    const firstKey = _parseCache.keys().next().value;
    if (firstKey !== undefined) _parseCache.delete(firstKey);
  }

  _parseCache.set(trimmed, node);
  return node;
}

/**
 * Clear the parse cache. Useful for testing.
 */
export function clearWhenClauseCache(): void {
  _parseCache.clear();
}

// ─── Evaluator ───────────────────────────────────────────────────────────────

/**
 * Evaluate a when-clause AST node against a context lookup function.
 *
 * @param node    The parsed AST
 * @param lookup  Function that resolves context key names to values
 * @returns       Whether the expression evaluates to truthy
 */
export function evaluateWhenClause(node: WhenClauseNode, lookup: ContextKeyLookup): boolean {
  return _evalNode(node, lookup);
}

function _evalNode(node: WhenClauseNode, lookup: ContextKeyLookup): boolean {
  switch (node.type) {
    case WhenClauseNodeType.True:
      return true;

    case WhenClauseNodeType.False:
      return false;

    case WhenClauseNodeType.Not:
      return !_evalNode(node.operand, lookup);

    case WhenClauseNodeType.And:
      return _evalNode(node.left, lookup) && _evalNode(node.right, lookup);

    case WhenClauseNodeType.Or:
      return _evalNode(node.left, lookup) || _evalNode(node.right, lookup);

    case WhenClauseNodeType.Equals:
      return _resolveValue(node.left, lookup) == _resolveValue(node.right, lookup);

    case WhenClauseNodeType.NotEquals:
      return _resolveValue(node.left, lookup) != _resolveValue(node.right, lookup);

    case WhenClauseNodeType.Greater:
      return _toNumber(_resolveValue(node.left, lookup)) > _toNumber(_resolveValue(node.right, lookup));

    case WhenClauseNodeType.GreaterOrEquals:
      return _toNumber(_resolveValue(node.left, lookup)) >= _toNumber(_resolveValue(node.right, lookup));

    case WhenClauseNodeType.Less:
      return _toNumber(_resolveValue(node.left, lookup)) < _toNumber(_resolveValue(node.right, lookup));

    case WhenClauseNodeType.LessOrEquals:
      return _toNumber(_resolveValue(node.left, lookup)) <= _toNumber(_resolveValue(node.right, lookup));

    case WhenClauseNodeType.In: {
      const key = _resolveValue(node.key, lookup);
      const coll = _resolveValue(node.collection, lookup);
      if (Array.isArray(coll)) {
        return coll.includes(key);
      }
      if (coll && typeof coll === 'object') {
        return String(key) in (coll as Record<string, unknown>);
      }
      if (typeof coll === 'string') {
        return coll.includes(String(key));
      }
      return false;
    }

    case WhenClauseNodeType.ContextKey: {
      const val = lookup(node.key);
      return _toBool(val);
    }

    case WhenClauseNodeType.Literal:
      return _toBool(node.value);
  }
}

/**
 * Resolve a node to its runtime value (not necessarily boolean).
 * For comparison operators we need the raw value, not a boolean coercion.
 */
function _resolveValue(node: WhenClauseNode, lookup: ContextKeyLookup): unknown {
  switch (node.type) {
    case WhenClauseNodeType.ContextKey:
      return lookup(node.key);
    case WhenClauseNodeType.Literal:
      return node.value;
    case WhenClauseNodeType.True:
      return true;
    case WhenClauseNodeType.False:
      return false;
    default:
      // For complex sub-expressions used as operands in comparisons,
      // evaluate them to boolean
      return _evalNode(node, lookup);
  }
}

function _toBool(val: unknown): boolean {
  if (val === undefined || val === null || val === '' || val === 0 || val === false) {
    return false;
  }
  return true;
}

function _toNumber(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  }
  if (typeof val === 'boolean') return val ? 1 : 0;
  return 0;
}

// ─── Convenience ─────────────────────────────────────────────────────────────

/**
 * Parse and immediately evaluate a when-clause expression.
 *
 * @param expression  The when-clause string
 * @param lookup      Context key resolver
 * @returns           Whether the expression is satisfied
 */
export function testWhenClause(expression: string | undefined, lookup: ContextKeyLookup): boolean {
  const node = parseWhenClause(expression);
  return evaluateWhenClause(node, lookup);
}
