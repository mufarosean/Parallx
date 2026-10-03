// formulaEngineGuards.ts — Worksheets: one stray keystroke must not break every later formula.
//
// Univer 0.25's formula lexer (LexerTreeBuilder) clears its per-parse state at
// the start of every parse, all of it but the square-bracket count: `[` adds
// one, `]` takes one away, and nothing sets it back. The editor parses the
// formula on every keystroke, so a `[` or `]` that was in the text for a
// moment (the keys beside `=` and Enter, or a half-typed `[1]Sheet!A1`) left
// the count wrong for the rest of the engine's life. From then on the lexer
// read every operator, comma and colon as part of a name: a clicked reference
// stayed black, `=B6*C6` evaluated as one unknown name (#NAME?) and a function
// call as a broken one (#VALUE!), on every retry, until the app was restarted
// (Mufaro, 2026-10-03, over a four-hour quiz). The engine keeps every parse in
// window-wide caches keyed by the formula text, which is why typing the same
// formula again failed the same way.
//
// The same caches hand their objects out by reference, and some callers write
// into them: the formula editor rewrites a cached node's token when a click
// replaces a reference, and SUMIF, AVERAGEIF and LOOKUP stretch a short sum
// or result range in place, so the next formula naming that cell read the
// stretched range. Copies go out instead, and the cache keeps the original.
//
// Applied once per window, before the first engine is created, to the
// classes the engine itself uses (the host bundles a single copy of
// @univerjs/engine-formula). Unit-tested against the real engine in
// tests/unit/worksheetFormulaEngineGuards.test.ts, which fails if an engine
// upgrade renames what is patched here.

type SequenceNode = string | { nodeType: number; token: string; startIndex: number; endIndex: number };

interface LexerInternals {
  _resetTemp(): void;
  _squareBracketState: number;
  _tableBracketState: boolean;
  _openBracketNormalIndexStack: number[];
  sequenceNodesBuilder(formula: string): SequenceNode[] | undefined;
}

interface ReferenceInternals {
  setRangeData(range: object): void;
}

const APPLIED = Symbol.for('parallx.worksheet.formulaEngineGuards');

/** What was patched; false where the engine no longer has the expected shape. */
export interface FormulaEngineGuardReport {
  lexerReset: boolean;
  sequenceCopies: boolean;
  rangeCopies: boolean;
}

export function applyFormulaEngineGuards(
  lexerTreeBuilder: { prototype: object },
  baseReferenceObject: { prototype: object },
): FormulaEngineGuardReport {
  const lexer = lexerTreeBuilder.prototype as LexerInternals & { [APPLIED]?: FormulaEngineGuardReport };
  const applied = lexer[APPLIED];
  if (applied) return applied;
  const report: FormulaEngineGuardReport = { lexerReset: false, sequenceCopies: false, rangeCopies: false };

  // Every parse starts with the bracket state cleared, like the rest.
  const resetTemp = lexer._resetTemp;
  if (typeof resetTemp === 'function') {
    lexer._resetTemp = function (this: LexerInternals): void {
      resetTemp.call(this);
      this._squareBracketState = 0;
      this._tableBracketState = false;
      this._openBracketNormalIndexStack = [];
    };
    report.lexerReset = true;
  }

  // Parsed sequences go out as copies, so a caller's edit stays its own.
  const sequenceNodesBuilder = lexer.sequenceNodesBuilder;
  if (typeof sequenceNodesBuilder === 'function') {
    lexer.sequenceNodesBuilder = function (this: LexerInternals, formula: string): SequenceNode[] | undefined {
      const nodes = sequenceNodesBuilder.call(this, formula);
      return nodes?.map((n) => (typeof n === 'string' ? n : { ...n }));
    };
    report.sequenceCopies = true;
  }

  // A reference keeps its own range, not the cached one it was parsed into.
  const reference = baseReferenceObject.prototype as ReferenceInternals;
  const setRangeData = reference.setRangeData;
  if (typeof setRangeData === 'function') {
    reference.setRangeData = function (this: ReferenceInternals, range: object): void {
      setRangeData.call(this, range && typeof range === 'object' ? { ...range } : range);
    };
    report.rangeCopies = true;
  }

  lexer[APPLIED] = report;
  return report;
}
