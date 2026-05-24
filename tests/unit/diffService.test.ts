// diffService.test.ts — pin DiffService current behavior (M82 redesign closure).
//
// NOTE: The Myers implementation in src/services/diffService.ts has known
// behavioral quirks that this file pins as-is:
//   - `splitLines('')` returns `['']`, so empty-old yields one "remove" of ''.
//   - The backtrack reverses the order of some interleaved adds/removes
//     (e.g. "abc"→"axc" emits `+a -a b c` rather than `a -b +x c`).
//   - non-empty → empty produces "add" entries with content=undefined,
//     rendering "+undefined" in the unified diff.
// Any future intent change MUST update these pins explicitly.

import { describe, it, expect } from 'vitest';
import {
  computeDiff,
  computeWordDiff,
  estimateDiffTokens,
  formatDiffSummary,
  DiffService,
} from '../../src/services/diffService';

describe('computeDiff — identical', () => {
  it('isIdentical=true for equal text, no hunks, empty unifiedDiff', () => {
    const r = computeDiff('a\nb\nc', 'a\nb\nc', 'x.ts');
    expect(r.isIdentical).toBe(true);
    expect(r.hunks).toEqual([]);
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(0);
    expect(r.unifiedDiff).toBe('');
  });

  it('two empty strings are identical', () => {
    const r = computeDiff('', '', 'x');
    expect(r.isIdentical).toBe(true);
  });
});

describe('computeDiff — formatting & headers', () => {
  it('emits "--- a/path" and "+++ b/path" headers and @@ hunk markers', () => {
    const r = computeDiff('a', 'b', 'src/x.ts');
    expect(r.unifiedDiff.startsWith('--- a/src/x.ts\n+++ b/src/x.ts\n')).toBe(true);
    expect(r.unifiedDiff).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('default filePath is "file"', () => {
    const r = computeDiff('a', 'b');
    expect(r.unifiedDiff).toMatch(/--- a\/file/);
    expect(r.unifiedDiff).toMatch(/\+\+\+ b\/file/);
  });

  it('hunk header has 1-based starts and equal/changed counts', () => {
    const r = computeDiff('a\nb\nc', 'a\nx\nc', 'f.ts');
    expect(r.hunks.length).toBe(1);
    const h = r.hunks[0];
    expect(h.oldStart).toBe(1);
    expect(h.newStart).toBe(1);
    expect(h.oldCount).toBe(3);
    expect(h.newCount).toBe(3);
  });
});

describe('computeDiff — current Myers backtrack order (pinned as-is)', () => {
  it('empty → "a\\nb" produces 2 adds + 1 remove of the leading empty line', () => {
    const r = computeDiff('', 'a\nb', 'f');
    expect(r.additions).toBe(2);
    expect(r.deletions).toBe(1);
    expect(r.unifiedDiff).toContain('+a');
    expect(r.unifiedDiff).toContain('+b');
  });

  it('"abc"→"axc" pins the current (mis-ordered) unified diff payload', () => {
    const r = computeDiff('a\nb\nc', 'a\nx\nc', 'f');
    expect(r.unifiedDiff).toBe('--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n+a\n-a\n b\n c');
  });

  it('isolated change with contextLines=0 still yields one hunk', () => {
    const r = computeDiff('a\nb\nc\nd\ne', 'a\nb\nX\nd\ne', 'f', 0);
    expect(r.hunks.length).toBe(1);
  });

  it('two close changes merge into ONE hunk when within contextLines', () => {
    const r = computeDiff('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne', 'f', 2);
    expect(r.hunks.length).toBe(1);
  });
});

describe('computeWordDiff', () => {
  it('identical lines produce only equal ops', () => {
    const ops = computeWordDiff('hello world', 'hello world');
    expect(ops.every((o) => o.type === 'equal')).toBe(true);
  });

  it('every op has shape {type, value:string}', () => {
    const ops = computeWordDiff('the quick brown fox', 'the slow brown fox');
    for (const op of ops) {
      expect(['add', 'remove', 'equal']).toContain(op.type);
      expect(typeof op.value).toBe('string');
    }
  });

  it('different lines emit at least one non-equal op', () => {
    const ops = computeWordDiff('the quick brown fox', 'the slow brown fox');
    expect(ops.some((o) => o.type !== 'equal')).toBe(true);
  });
});

describe('estimateDiffTokens / formatDiffSummary', () => {
  it('estimateDiffTokens = ceil(unifiedDiff.length / 4)', () => {
    const r = computeDiff('a\nb', 'a\nc', 'f');
    expect(estimateDiffTokens(r)).toBe(Math.ceil(r.unifiedDiff.length / 4));
  });

  it('formatDiffSummary: identical message', () => {
    const r = computeDiff('x', 'x', 'foo.ts');
    expect(formatDiffSummary(r)).toBe('No changes in foo.ts');
  });

  it('formatDiffSummary: "+a -d lines in path"', () => {
    const r = computeDiff('a\nb', 'a\nc\nd', 'bar.ts');
    expect(formatDiffSummary(r)).toBe(`+${r.additions} -${r.deletions} lines in bar.ts`);
  });
});

describe('DiffService class — DI wrapper', () => {
  it('delegates to functional API', () => {
    const svc = new DiffService();
    const r = svc.computeDiff('a', 'b', 'p.ts');
    expect(r.unifiedDiff).toMatch(/p\.ts/);
    const wd = svc.computeWordDiff('a b', 'a c');
    expect(wd.some((o) => o.type !== 'equal')).toBe(true);
    expect(svc.estimateTokens(r)).toBe(estimateDiffTokens(r));
    expect(svc.formatSummary(r)).toBe(formatDiffSummary(r));
  });
});
