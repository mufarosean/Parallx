// worksheetFormulaEngineGuards.test.ts — the formula engine guards, against the real engine.
//
// Mufaro, 2026-10-03: during a long quiz a clicked reference stayed black,
// Enter gave #NAME? or #VALUE!, retyping failed the same way, and a restart
// brought the right number back. One parse of a formula holding a stray `[`
// or `]` left the lexer's bracket count wrong for good. These tests run the
// installed @univerjs/engine-formula, so an upgrade that renames what the
// guards patch fails here instead of silently undoing the fix.

import { describe, expect, it } from 'vitest';
import { LexerTreeBuilder, BaseReferenceObject, deserializeRangeWithSheetWithCache, sequenceNodeType } from '@univerjs/engine-formula';
import { applyFormulaEngineGuards } from '../../src/built-in/worksheet/formulaEngineGuards';

const report = applyFormulaEngineGuards(LexerTreeBuilder, BaseReferenceObject);

type Node = string | { nodeType: number; token: string };
const refsOf = (nodes: Node[] | undefined): string[] =>
  (nodes ?? []).filter((n): n is Exclude<Node, string> => typeof n !== 'string' && n.nodeType === sequenceNodeType.REFERENCE).map((n) => n.token);

/** Parse without the window-wide caches, so every call really runs the lexer. */
function parse(builder: LexerTreeBuilder, formula: string): { refs: string[]; tree: string } {
  const internals = builder as unknown as { _getSequenceArray(f: string): unknown[]; getSequenceNode(a: unknown[]): Node[] };
  const tree = builder.treeBuilder(formula, false);
  return { refs: refsOf(internals.getSequenceNode(internals._getSequenceArray(formula))), tree: typeof tree === 'string' ? tree : 'ok' };
}

describe('worksheet formula engine guards', () => {
  it('patches all three engine members', () => {
    expect(report).toEqual({ lexerReset: true, sequenceCopies: true, rangeCopies: true });
    expect(applyFormulaEngineGuards(LexerTreeBuilder, BaseReferenceObject)).toBe(report);
  });

  it('a stray bracket while typing leaves later formulas intact', () => {
    const builder = new LexerTreeBuilder();
    const later = ['=B6*C6', '=SUM(A1:A4)+1', '=ROUND(B5*(1+C5),2)', '=IF(B2>0,"yes","no")', '=-D9/2'];
    const clean = later.map((f) => parse(new LexerTreeBuilder(), f));
    expect(clean[0]).toEqual({ refs: ['B6', 'C6'], tree: 'ok' });
    // What the editor parses keystroke by keystroke: a typo on either side,
    // and a balanced reference on its way to being typed in full.
    for (const typed of ['=B5[', '=B5]', '=[', '=[1', '=[1]', '=Table1[Col', '=]]]']) {
      builder.sequenceNodesBuilder(typed);
      builder.treeBuilder(typed, false);
      builder.getFunctionAndParameter(typed, typed.length - 1);
      later.forEach((f, i) => expect(parse(builder, f), `${f} after ${typed}`).toEqual(clean[i]));
    }
  });

  it('a caller editing parsed nodes does not change what the next caller gets', () => {
    const builder = new LexerTreeBuilder();
    const formula = '=B5*C5+0.25';
    const first = builder.sequenceNodesBuilder(formula) as Node[];
    const ref = first.find((n): n is Exclude<Node, string> => typeof n !== 'string' && n.nodeType === sequenceNodeType.REFERENCE)!;
    ref.token = 'Z99';
    expect(refsOf(builder.sequenceNodesBuilder(formula) as Node[])).toEqual(['B5', 'C5']);
  });

  it('a reference stretched in place does not stretch the cached range', () => {
    deserializeRangeWithSheetWithCache('Q7');
    const cached = deserializeRangeWithSheetWithCache('Q7');
    const reference = new BaseReferenceObject('Q7');
    reference.setRangeData(cached.range);
    // SUMIF's own move when the sum range is shorter than the range.
    const rangeData = reference.getRangeData();
    rangeData.endRow = rangeData.startRow + 9;
    reference.setRangeData(rangeData);
    expect(reference.getRangeData().endRow).toBe(15);
    expect(deserializeRangeWithSheetWithCache('Q7').range.endRow).toBe(6);
  });
});
