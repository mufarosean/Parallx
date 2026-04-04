// formulaEngine.test.ts — Phase 8 formula engine tests
/**
 * @vitest-environment jsdom
 */
//
// Covers:
//   - Tokenizer (token types, edge cases, errors)
//   - Parser (literals, expressions, operator precedence, function calls, errors)
//   - Evaluator (arithmetic, string concat, comparisons, builtins, prop(), errors)
//   - Type inference (inferOutputType for all AST shapes)
//   - extractPropReferences
//   - evaluateFormula (end-to-end)
//   - parseFormula (validation-only entry point)
//   - Formula renderer (renderFormula)
//   - Registry exports

import { describe, it, expect, vi } from 'vitest';

// ─── Registry barrel (static import to avoid forks-pool race conditions) ─────
import * as databaseRegistry from '../../src/built-in/canvas/database/databaseRegistry';

// ─── Imports from formulaEngine (via databaseRegistry gate in prod,
//     but in tests we import directly for unit testing) ───────────────────────

import {
  tokenize,
  parse,
  evaluate,
  buildPropertyResolver,
  evaluateFormula,
  parseFormula,
  inferOutputType,
  extractPropReferences,
  FormulaError,
} from '../../src/built-in/canvas/database/properties/formulaEngine';

import type {
  IToken,
  ASTExpression,
  IFormulaResult,
} from '../../src/built-in/canvas/database/properties/formulaEngine';

import type {
  IPropertyValue,
  IDatabaseProperty,
  PropertyType,
} from '../../src/built-in/canvas/database/databaseTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProp(id: string, name: string, type: PropertyType): IDatabaseProperty {
  return { id, name, type, config: {} } as IDatabaseProperty;
}

function makeNumberVal(n: number): IPropertyValue {
  return { type: 'number', number: n } as IPropertyValue;
}

function makeTextVal(text: string): IPropertyValue {
  return { type: 'rich_text', rich_text: [{ content: text }] } as IPropertyValue;
}

function makeCheckboxVal(checked: boolean): IPropertyValue {
  return { type: 'checkbox', checkbox: checked } as IPropertyValue;
}

function makeDateVal(date: string): IPropertyValue {
  return { type: 'date', date: { start: date } } as IPropertyValue;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOKENIZER
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Tokenizer', () => {
  it('tokenizes numbers', () => {
    const tokens = tokenize('42');
    expect(tokens[0]).toEqual({ type: 'number', value: '42', pos: 0 });
    expect(tokens[1].type).toBe('eof');
  });

  it('tokenizes decimal numbers', () => {
    const tokens = tokenize('3.14');
    expect(tokens[0]).toEqual({ type: 'number', value: '3.14', pos: 0 });
  });

  it('tokenizes double-quoted strings', () => {
    const tokens = tokenize('"hello world"');
    expect(tokens[0]).toEqual({ type: 'string', value: 'hello world', pos: 0 });
  });

  it('tokenizes single-quoted strings', () => {
    const tokens = tokenize("'test'");
    expect(tokens[0]).toEqual({ type: 'string', value: 'test', pos: 0 });
  });

  it('tokenizes strings with escaped characters', () => {
    const tokens = tokenize('"say \\"hi\\""');
    expect(tokens[0].value).toBe('say "hi"');
  });

  it('tokenizes boolean literals', () => {
    const tokens = tokenize('true false');
    expect(tokens[0]).toEqual({ type: 'boolean', value: 'true', pos: 0 });
    expect(tokens[1]).toEqual({ type: 'boolean', value: 'false', pos: 5 });
  });

  it('tokenizes identifiers', () => {
    const tokens = tokenize('abs ceil floor_2');
    expect(tokens[0]).toEqual({ type: 'identifier', value: 'abs', pos: 0 });
    expect(tokens[1]).toEqual({ type: 'identifier', value: 'ceil', pos: 4 });
    expect(tokens[2]).toEqual({ type: 'identifier', value: 'floor_2', pos: 9 });
  });

  it('tokenizes operators and delimiters', () => {
    const tokens = tokenize('( ) , + - * / %');
    const types = tokens.slice(0, -1).map(t => t.type);
    expect(types).toEqual(['lparen', 'rparen', 'comma', 'plus', 'minus', 'star', 'slash', 'percent']);
  });

  it('tokenizes comparison operators', () => {
    const tokens = tokenize('== != < <= > >=');
    const types = tokens.slice(0, -1).map(t => t.type);
    expect(types).toEqual(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']);
  });

  it('produces EOF token at end', () => {
    const tokens = tokenize('');
    expect(tokens).toEqual([{ type: 'eof', value: '', pos: 0 }]);
  });

  it('skips whitespace', () => {
    const tokens = tokenize('  1  +  2  ');
    expect(tokens.length).toBe(4); // number, plus, number, eof
  });

  it('throws on unterminated string', () => {
    expect(() => tokenize('"hello')).toThrow(FormulaError);
  });

  it('throws on unexpected character', () => {
    expect(() => tokenize('1 @ 2')).toThrow(FormulaError);
  });

  it('tokenizes a complex expression', () => {
    const tokens = tokenize('if(prop("Score") > 90, "A", "B")');
    const types = tokens.slice(0, -1).map(t => t.type);
    expect(types).toEqual([
      'identifier', 'lparen', 'identifier', 'lparen', 'string', 'rparen',
      'gt', 'number', 'comma', 'string', 'comma', 'string', 'rparen',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PARSER
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Parser', () => {
  function parseExpr(src: string): ASTExpression {
    return parse(tokenize(src));
  }

  it('parses number literal', () => {
    const ast = parseExpr('42');
    expect(ast).toEqual({ type: 'number_literal', value: 42 });
  });

  it('parses string literal', () => {
    const ast = parseExpr('"hello"');
    expect(ast).toEqual({ type: 'string_literal', value: 'hello' });
  });

  it('parses boolean literal', () => {
    expect(parseExpr('true')).toEqual({ type: 'boolean_literal', value: true });
    expect(parseExpr('false')).toEqual({ type: 'boolean_literal', value: false });
  });

  it('parses unary minus', () => {
    const ast = parseExpr('-5');
    expect(ast.type).toBe('unary');
    expect((ast as any).operator).toBe('-');
    expect((ast as any).operand).toEqual({ type: 'number_literal', value: 5 });
  });

  it('parses binary addition', () => {
    const ast = parseExpr('1 + 2');
    expect(ast.type).toBe('binary');
    expect((ast as any).operator).toBe('+');
  });

  it('parses operator precedence (multiplication before addition)', () => {
    const ast = parseExpr('1 + 2 * 3') as any;
    expect(ast.type).toBe('binary');
    expect(ast.operator).toBe('+');
    expect(ast.left).toEqual({ type: 'number_literal', value: 1 });
    expect(ast.right.type).toBe('binary');
    expect(ast.right.operator).toBe('*');
  });

  it('parses parenthesized expression', () => {
    const ast = parseExpr('(1 + 2) * 3') as any;
    expect(ast.type).toBe('binary');
    expect(ast.operator).toBe('*');
    expect(ast.left.type).toBe('binary');
    expect(ast.left.operator).toBe('+');
  });

  it('parses function call with no args', () => {
    const ast = parseExpr('now()') as any;
    expect(ast.type).toBe('call');
    expect(ast.name).toBe('now');
    expect(ast.args).toEqual([]);
  });

  it('parses function call with multiple args', () => {
    const ast = parseExpr('if(true, 1, 2)') as any;
    expect(ast.type).toBe('call');
    expect(ast.name).toBe('if');
    expect(ast.args.length).toBe(3);
  });

  it('parses nested function calls', () => {
    const ast = parseExpr('abs(min(1, 2))') as any;
    expect(ast.type).toBe('call');
    expect(ast.name).toBe('abs');
    expect(ast.args[0].type).toBe('call');
    expect(ast.args[0].name).toBe('min');
  });

  it('parses comparison operators', () => {
    const ast = parseExpr('1 > 2') as any;
    expect(ast.type).toBe('comparison');
    expect(ast.operator).toBe('>');
  });

  it('parses comparison with arithmetic', () => {
    const ast = parseExpr('1 + 2 >= 3') as any;
    expect(ast.type).toBe('comparison');
    expect(ast.operator).toBe('>=');
    expect(ast.left.type).toBe('binary');
  });

  it('throws on unexpected token', () => {
    expect(() => parseExpr('+')).toThrow(FormulaError);
  });

  it('throws on trailing tokens', () => {
    expect(() => parseExpr('1 2')).toThrow(FormulaError);
  });

  it('throws on unmatched parenthesis', () => {
    expect(() => parseExpr('(1 + 2')).toThrow(FormulaError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — Arithmetic
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (Arithmetic)', () => {
  const noResolver = () => null;

  function evalExpr(src: string): unknown {
    return evaluate(parse(tokenize(src)), noResolver);
  }

  it('evaluates number literals', () => {
    expect(evalExpr('42')).toBe(42);
    expect(evalExpr('3.14')).toBe(3.14);
  });

  it('evaluates addition', () => {
    expect(evalExpr('1 + 2')).toBe(3);
  });

  it('evaluates subtraction', () => {
    expect(evalExpr('10 - 3')).toBe(7);
  });

  it('evaluates multiplication', () => {
    expect(evalExpr('4 * 5')).toBe(20);
  });

  it('evaluates division', () => {
    expect(evalExpr('10 / 4')).toBe(2.5);
  });

  it('evaluates modulo', () => {
    expect(evalExpr('10 % 3')).toBe(1);
  });

  it('evaluates unary minus', () => {
    expect(evalExpr('-5')).toBe(-5);
  });

  it('evaluates complex arithmetic', () => {
    expect(evalExpr('(1 + 2) * 3 - 1')).toBe(8);
  });

  it('throws on division by zero', () => {
    expect(() => evalExpr('1 / 0')).toThrow('Division by zero');
  });

  it('throws on modulo by zero', () => {
    expect(() => evalExpr('1 % 0')).toThrow('Modulo by zero');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — String Operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (Strings)', () => {
  const noResolver = () => null;

  function evalExpr(src: string): unknown {
    return evaluate(parse(tokenize(src)), noResolver);
  }

  it('evaluates string concatenation with +', () => {
    expect(evalExpr('"hello" + " " + "world"')).toBe('hello world');
  });

  it('evaluates length()', () => {
    expect(evalExpr('length("hello")')).toBe(5);
  });

  it('evaluates contains()', () => {
    expect(evalExpr('contains("hello world", "world")')).toBe(true);
    expect(evalExpr('contains("hello world", "xyz")')).toBe(false);
  });

  it('evaluates replace()', () => {
    expect(evalExpr('replace("hello world", "world", "there")')).toBe('hello there');
  });

  it('evaluates replaceAll()', () => {
    expect(evalExpr('replaceAll("aabbaa", "aa", "x")')).toBe('xbbx');
  });

  it('evaluates concat()', () => {
    expect(evalExpr('concat("a", "b", "c")')).toBe('abc');
  });

  it('evaluates join()', () => {
    expect(evalExpr('join(", ", "a", "b", "c")')).toBe('a, b, c');
  });

  it('evaluates slice()', () => {
    expect(evalExpr('slice("hello", 1, 3)')).toBe('el');
  });

  it('evaluates lower()', () => {
    expect(evalExpr('lower("HELLO")')).toBe('hello');
  });

  it('evaluates upper()', () => {
    expect(evalExpr('upper("hello")')).toBe('HELLO');
  });

  it('evaluates trim()', () => {
    expect(evalExpr('trim("  hello  ")')).toBe('hello');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — Comparisons
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (Comparisons)', () => {
  const noResolver = () => null;

  function evalExpr(src: string): unknown {
    return evaluate(parse(tokenize(src)), noResolver);
  }

  it('evaluates == for numbers', () => {
    expect(evalExpr('1 == 1')).toBe(true);
    expect(evalExpr('1 == 2')).toBe(false);
  });

  it('evaluates != for numbers', () => {
    expect(evalExpr('1 != 2')).toBe(true);
  });

  it('evaluates < <= > >=', () => {
    expect(evalExpr('1 < 2')).toBe(true);
    expect(evalExpr('2 <= 2')).toBe(true);
    expect(evalExpr('3 > 2')).toBe(true);
    expect(evalExpr('2 >= 3')).toBe(false);
  });

  it('evaluates string comparisons', () => {
    expect(evalExpr('"a" < "b"')).toBe(true);
    expect(evalExpr('"abc" == "abc"')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — Conditional Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (Conditionals)', () => {
  const noResolver = () => null;

  function evalExpr(src: string): unknown {
    return evaluate(parse(tokenize(src)), noResolver);
  }

  it('evaluates if() — true path', () => {
    expect(evalExpr('if(true, "yes", "no")')).toBe('yes');
  });

  it('evaluates if() — false path', () => {
    expect(evalExpr('if(false, "yes", "no")')).toBe('no');
  });

  it('evaluates if() with 2 args (no else)', () => {
    expect(evalExpr('if(false, "yes")')).toBe(null);
  });

  it('evaluates ifs() — multi-condition', () => {
    // ifs(false, "a", true, "b")  →  "b"
    expect(evalExpr('ifs(false, "a", true, "b")')).toBe('b');
  });

  it('evaluates ifs() — no match returns null', () => {
    expect(evalExpr('ifs(false, "a", false, "b")')).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — Math Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (Math Functions)', () => {
  const noResolver = () => null;

  function evalExpr(src: string): unknown {
    return evaluate(parse(tokenize(src)), noResolver);
  }

  it('abs()', () => expect(evalExpr('abs(-5)')).toBe(5));
  it('ceil()', () => expect(evalExpr('ceil(3.2)')).toBe(4));
  it('floor()', () => expect(evalExpr('floor(3.8)')).toBe(3));
  it('round() no decimals', () => expect(evalExpr('round(3.5)')).toBe(4));
  it('round() with decimals', () => expect(evalExpr('round(3.456, 2)')).toBe(3.46));
  it('min()', () => expect(evalExpr('min(3, 1, 2)')).toBe(1));
  it('max()', () => expect(evalExpr('max(3, 1, 2)')).toBe(3));
  it('sqrt()', () => expect(evalExpr('sqrt(16)')).toBe(4));
  it('sqrt() of negative throws', () => expect(() => evalExpr('sqrt(-1)')).toThrow('negative'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — Logical Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (Logical)', () => {
  const noResolver = () => null;

  function evalExpr(src: string): unknown {
    return evaluate(parse(tokenize(src)), noResolver);
  }

  it('and()', () => {
    expect(evalExpr('and(true, true)')).toBe(true);
    expect(evalExpr('and(true, false)')).toBe(false);
  });

  it('or()', () => {
    expect(evalExpr('or(false, true)')).toBe(true);
    expect(evalExpr('or(false, false)')).toBe(false);
  });

  it('not()', () => {
    expect(evalExpr('not(true)')).toBe(false);
    expect(evalExpr('not(false)')).toBe(true);
  });

  it('empty()', () => {
    expect(evalExpr('empty("")')).toBe(true);
    expect(evalExpr('empty(0)')).toBe(true);
    expect(evalExpr('empty("x")')).toBe(false);
  });

  it('equal() / unequal()', () => {
    expect(evalExpr('equal(1, 1)')).toBe(true);
    expect(evalExpr('unequal(1, 2)')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — Type Conversion Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (Type Conversion)', () => {
  const noResolver = () => null;

  function evalExpr(src: string): unknown {
    return evaluate(parse(tokenize(src)), noResolver);
  }

  it('toNumber() from string', () => expect(evalExpr('toNumber("42")')).toBe(42));
  it('toNumber() from boolean', () => expect(evalExpr('toNumber(true)')).toBe(1));
  it('toNumber() invalid throws', () => expect(() => evalExpr('toNumber("abc")')).toThrow());
  it('toBoolean() from number', () => {
    expect(evalExpr('toBoolean(1)')).toBe(true);
    expect(evalExpr('toBoolean(0)')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — Date Functions
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (Date Functions)', () => {
  const noResolver = () => null;

  function evalExpr(src: string): unknown {
    return evaluate(parse(tokenize(src)), noResolver);
  }

  it('dateAdd() adds days', () => {
    expect(evalExpr('dateAdd("2025-01-01", 5, "days")')).toBe('2025-01-06');
  });

  it('dateSubtract() subtracts months', () => {
    expect(evalExpr('dateSubtract("2025-06-15", 3, "months")')).toBe('2025-03-15');
  });

  it('dateBetween() returns days', () => {
    expect(evalExpr('dateBetween("2025-01-01", "2025-01-11", "days")')).toBe(10);
  });

  it('year/month/day extract components', () => {
    expect(evalExpr('year("2025-06-15")')).toBe(2025);
    expect(evalExpr('month("2025-06-15")')).toBe(6);
    expect(evalExpr('day("2025-06-15")')).toBe(15);
  });

  it('formatDate() formats dates', () => {
    expect(evalExpr('formatDate("2025-06-15", "YYYY/MM/DD")')).toBe('2025/06/15');
  });

  it('now() returns a string', () => {
    const result = evalExpr('now()');
    expect(typeof result).toBe('string');
  });

  it('today() returns a date string', () => {
    const result = evalExpr('today()') as string;
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — prop() resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (prop())', () => {
  it('resolves prop() by name', () => {
    const resolver = (name: string) => {
      if (name === 'Price') return 42;
      throw new FormulaError(`Unknown property "${name}"`);
    };
    const ast = parse(tokenize('prop("Price") * 2'));
    expect(evaluate(ast, resolver)).toBe(84);
  });

  it('throws for non-string prop() argument', () => {
    const resolver = () => null;
    const ast = parse(tokenize('prop(123)'));
    expect(() => evaluate(ast, resolver)).toThrow('prop() argument must be a string');
  });

  it('throws for wrong number of prop() arguments', () => {
    const resolver = () => null;
    const ast = parse(tokenize('prop("a", "b")'));
    expect(() => evaluate(ast, resolver)).toThrow('prop() requires exactly 1 argument');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVALUATOR — Unknown function
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Evaluator (Errors)', () => {
  it('throws for unknown function', () => {
    const ast = parse(tokenize('foo(1)'));
    expect(() => evaluate(ast, () => null)).toThrow('Unknown function "foo"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildPropertyResolver
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — buildPropertyResolver', () => {
  it('resolves property values by name', () => {
    const props = [
      makeProp('p1', 'Score', 'number'),
      makeProp('p2', 'Name', 'rich_text'),
    ];
    const values: Record<string, IPropertyValue> = {
      p1: makeNumberVal(95),
      p2: makeTextVal('Alice'),
    };
    const resolver = buildPropertyResolver(values, props);
    expect(resolver('Score')).toBe(95);
    expect(resolver('Name')).toBe('Alice');
  });

  it('returns null for missing values', () => {
    const props = [makeProp('p1', 'Score', 'number')];
    const resolver = buildPropertyResolver({}, props);
    expect(resolver('Score')).toBeNull();
  });

  it('throws for unknown property name', () => {
    const resolver = buildPropertyResolver({}, []);
    expect(() => resolver('Missing')).toThrow('Unknown property');
  });

  it('extracts checkbox values', () => {
    const props = [makeProp('p1', 'Done', 'checkbox')];
    const values = { p1: makeCheckboxVal(true) };
    const resolver = buildPropertyResolver(values, props);
    expect(resolver('Done')).toBe(true);
  });

  it('extracts date values', () => {
    const props = [makeProp('p1', 'Due', 'date')];
    const values = { p1: makeDateVal('2025-06-15') };
    const resolver = buildPropertyResolver(values, props);
    expect(resolver('Due')).toBe('2025-06-15');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// inferOutputType
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — inferOutputType', () => {
  function infer(src: string): string {
    return inferOutputType(parse(tokenize(src)));
  }

  it('number literal → number', () => expect(infer('42')).toBe('number'));
  it('string literal → string', () => expect(infer('"hello"')).toBe('string'));
  it('boolean literal → boolean', () => expect(infer('true')).toBe('boolean'));
  it('unary minus → number', () => expect(infer('-5')).toBe('number'));
  it('binary arithmetic → number', () => expect(infer('1 + 2')).toBe('number'));
  it('comparison → boolean', () => expect(infer('1 > 2')).toBe('boolean'));
  it('abs() → number', () => expect(infer('abs(1)')).toBe('number'));
  it('now() → date', () => expect(infer('now()')).toBe('date'));
  it('lower() → string', () => expect(infer('lower("X")')).toBe('string'));
  it('and() → boolean', () => expect(infer('and(true, false)')).toBe('boolean'));
  it('contains() → boolean', () => expect(infer('contains("a", "b")')).toBe('boolean'));
  it('dateBetween() → number', () => expect(infer('dateBetween("a", "b", "days")')).toBe('number'));
  it('prop() → string (default)', () => expect(infer('prop("X")')).toBe('string'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractPropReferences
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — extractPropReferences', () => {
  it('extracts prop() references', () => {
    const ast = parse(tokenize('prop("Score") + prop("Bonus")'));
    expect(extractPropReferences(ast)).toEqual(['Score', 'Bonus']);
  });

  it('extracts from nested expressions', () => {
    const ast = parse(tokenize('if(prop("Done"), prop("Bonus"), 0)'));
    expect(extractPropReferences(ast)).toEqual(['Done', 'Bonus']);
  });

  it('returns empty for no prop() calls', () => {
    const ast = parse(tokenize('1 + 2'));
    expect(extractPropReferences(ast)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluateFormula (end-to-end)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — evaluateFormula (E2E)', () => {
  const props = [
    makeProp('p1', 'Price', 'number'),
    makeProp('p2', 'Quantity', 'number'),
    makeProp('p3', 'Label', 'rich_text'),
  ];
  const values: Record<string, IPropertyValue> = {
    p1: makeNumberVal(10),
    p2: makeNumberVal(5),
    p3: makeTextVal('Widget'),
  };

  it('computes prop("Price") * prop("Quantity")', () => {
    const result = evaluateFormula('prop("Price") * prop("Quantity")', values, props);
    expect(result.value).toBe(50);
    expect(result.type).toBe('number');
    expect(result.error).toBeUndefined();
  });

  it('computes concat(prop("Label"), " x", " ", prop("Quantity"))', () => {
    const result = evaluateFormula('concat(prop("Label"), " x ", prop("Quantity"))', values, props);
    expect(result.value).toBe('Widget x 5');
    expect(result.type).toBe('string');
  });

  it('returns error result for bad expression', () => {
    const result = evaluateFormula('1 + +', values, props);
    expect(result.error).toBeDefined();
    expect(result.value).toBeNull();
  });

  it('returns error result for runtime error', () => {
    const result = evaluateFormula('prop("Price") / 0', values, props);
    expect(result.error).toBeDefined();
  });

  it('returns error for unknown property', () => {
    const result = evaluateFormula('prop("Missing")', values, props);
    expect(result.error).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseFormula (validation entry point)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — parseFormula', () => {
  it('returns ast and outputType for valid expression', () => {
    const result = parseFormula('1 + 2');
    expect('ast' in result).toBe(true);
    if ('ast' in result) {
      expect(result.outputType).toBe('number');
    }
  });

  it('returns error for invalid expression', () => {
    const result = parseFormula('1 + +');
    expect('error' in result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Formula Renderer
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — renderFormula', () => {
  // We need to import renderFormula. In prod it goes through the registry,
  // but we import directly from propertyRenderers for testing.
  let renderFormula: typeof import('../../src/built-in/canvas/database/properties/propertyRenderers').renderFormula;

  // Set up minimal DOM
  beforeAll(async () => {
    const mod = await import('../../src/built-in/canvas/database/properties/propertyRenderers');
    renderFormula = mod.renderFormula;
  });

  function makeContainer(): HTMLElement {
    return document.createElement('div');
  }

  it('renders number result', () => {
    const container = makeContainer();
    renderFormula(undefined, container, { type: 'number', value: 42 });
    expect(container.textContent).toBe('42');
    expect(container.querySelector('.db-cell-formula')).toBeTruthy();
  });

  it('renders boolean result', () => {
    const container = makeContainer();
    renderFormula(undefined, container, { type: 'boolean', value: true });
    expect(container.textContent).toBe('Yes');
  });

  it('renders string result', () => {
    const container = makeContainer();
    renderFormula(undefined, container, { type: 'string', value: 'hello' });
    expect(container.textContent).toBe('hello');
  });

  it('renders date result', () => {
    const container = makeContainer();
    renderFormula(undefined, container, { type: 'date', value: '2025-01-15' });
    expect(container.textContent).toBe('2025-01-15');
  });

  it('renders error with warning icon', () => {
    const container = makeContainer();
    renderFormula(undefined, container, { type: 'string', value: null, error: 'Parse error' });
    const errEl = container.querySelector('.db-cell-formula-error');
    expect(errEl).toBeTruthy();
    expect(errEl!.textContent).toContain('Parse error');
  });

  it('renders empty when no result', () => {
    const container = makeContainer();
    renderFormula(undefined, container);
    expect(container.querySelector('.db-cell-empty')).toBeTruthy();
  });

  it('renders from stored formula value', () => {
    const container = makeContainer();
    const value = {
      type: 'formula',
      formula: { type: 'number', number: 99 },
    } as any;
    renderFormula(value, container);
    expect(container.textContent).toBe('99');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Registry Exports
// ═══════════════════════════════════════════════════════════════════════════════

describe('Formula Engine — Registry Exports', () => {
  it('exports formula engine functions from databaseRegistry', () => {
    // Functions
    expect(typeof databaseRegistry.tokenize).toBe('function');
    expect(typeof databaseRegistry.parseFormulaAST).toBe('function');
    expect(typeof databaseRegistry.evaluateFormulaAST).toBe('function');
    expect(typeof databaseRegistry.buildPropertyResolver).toBe('function');
    expect(typeof databaseRegistry.evaluateFormula).toBe('function');
    expect(typeof databaseRegistry.parseFormula).toBe('function');
    expect(typeof databaseRegistry.inferOutputType).toBe('function');
    expect(typeof databaseRegistry.extractPropReferences).toBe('function');

    // Class
    expect(typeof databaseRegistry.FormulaError).toBe('function');

    // Renderer
    expect(typeof databaseRegistry.renderFormula).toBe('function');
  });
});
