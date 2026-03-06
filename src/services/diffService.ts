// diffService.ts — Diff computation engine (M11 Task 2.4)
//
// Computes unified diffs between two strings at line-level and word-level
// granularity. Output is usable by the diff review UI and the LLM.
//
// Algorithm: Myers O(ND) diff for line-level, then optionally refine
// changed hunks with word-level diffing for inline highlights.
//
// VS Code reference:
//   src/vs/editor/common/diff/defaultLinesDiffComputer.ts
//   Parallx uses a simpler implementation focused on correctness and
//   human-readable output rather than editor integration.

import { Disposable } from '../platform/lifecycle.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** A single diff change at line level. */
export interface ILineDiffChange {
  /** 'add' = new line added, 'remove' = old line removed, 'equal' = unchanged. */
  readonly type: 'add' | 'remove' | 'equal';
  /** Line content (without trailing newline). */
  readonly content: string;
  /** 1-based line number in the old document (undefined for 'add'). */
  readonly oldLineNumber?: number;
  /** 1-based line number in the new document (undefined for 'remove'). */
  readonly newLineNumber?: number;
}

/** A contiguous group of changes (a "hunk" in unified diff terminology). */
export interface IDiffHunk {
  /** Starting line in old file (1-based). */
  readonly oldStart: number;
  /** Number of lines in old file. */
  readonly oldCount: number;
  /** Starting line in new file (1-based). */
  readonly newStart: number;
  /** Number of lines in new file. */
  readonly newCount: number;
  /** The individual line changes in this hunk. */
  readonly changes: readonly ILineDiffChange[];
}

/** A word-level change within a single line. */
export interface IWordChange {
  /** 'add', 'remove', or 'equal'. */
  readonly type: 'add' | 'remove' | 'equal';
  /** The word/token content. */
  readonly value: string;
}

/** Full diff result between two documents. */
export interface IDiffResult {
  /** Path of the file being diffed (for display). */
  readonly filePath: string;
  /** Whether the documents are identical. */
  readonly isIdentical: boolean;
  /** Line-level hunks. */
  readonly hunks: readonly IDiffHunk[];
  /** Total lines added across all hunks. */
  readonly additions: number;
  /** Total lines removed across all hunks. */
  readonly deletions: number;
  /** Unified diff string (suitable for display or LLM consumption). */
  readonly unifiedDiff: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Myers diff algorithm (core)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the shortest edit script between two sequences using
 * Myers' O(ND) algorithm.
 *
 * Returns an array of operations: 'equal', 'add', 'remove'.
 */
function myersDiff<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): Array<{ type: 'equal' | 'add' | 'remove'; value: T }> {
  const N = a.length;
  const M = b.length;

  // Early exits
  if (N === 0 && M === 0) { return []; }
  if (N === 0) { return b.map((v) => ({ type: 'add' as const, value: v })); }
  if (M === 0) { return a.map((v) => ({ type: 'remove' as const, value: v })); }

  const MAX = N + M;
  const size = 2 * MAX + 1;
  const vArr = new Int32Array(size);
  const trace: Int32Array[] = [];

  // Forward pass — find the shortest edit path
  for (let d = 0; d <= MAX; d++) {
    const snapshot = new Int32Array(vArr);
    trace.push(snapshot);

    for (let k = -d; k <= d; k += 2) {
      const kOffset = k + MAX;

      let x: number;
      if (k === -d || (k !== d && vArr[kOffset - 1] < vArr[kOffset + 1])) {
        x = vArr[kOffset + 1]; // move down (insert from b)
      } else {
        x = vArr[kOffset - 1] + 1; // move right (delete from a)
      }

      let y = x - k;

      // Follow diagonal (equal elements)
      while (x < N && y < M && eq(a[x], b[y])) {
        x++;
        y++;
      }

      vArr[kOffset] = x;

      if (x >= N && y >= M) {
        // Reached the end — backtrack to build the edit script
        return _backtrack(trace, a, b, eq, d, MAX);
      }
    }
  }

  // Fallback (should not reach here for valid input)
  return [...a.map((v) => ({ type: 'remove' as const, value: v })), ...b.map((v) => ({ type: 'add' as const, value: v }))];
}

/** Backtrack through the Myers trace to reconstruct the edit script. */
function _backtrack<T>(
  trace: Int32Array[],
  a: readonly T[],
  b: readonly T[],
  _eq: (x: T, y: T) => boolean,
  D: number,
  MAX: number,
): Array<{ type: 'equal' | 'add' | 'remove'; value: T }> {
  const result: Array<{ type: 'equal' | 'add' | 'remove'; value: T }> = [];

  let x = a.length;
  let y = b.length;

  for (let d = D; d > 0; d--) {
    // trace[d] captured during forward pass; we only need vPrev for backtracking
    const vPrev = trace[d - 1];
    const k = x - y;
    const kOffset = k + MAX;

    let prevK: number;
    if (k === -d || (k !== d && vPrev[kOffset - 1] < vPrev[kOffset + 1])) {
      prevK = k + 1; // came from k+1 (insert)
    } else {
      prevK = k - 1; // came from k-1 (delete)
    }

    const prevX = vPrev[prevK + MAX];
    const prevY = prevX - prevK;

    // Diagonal (equal) moves
    while (x > prevX && y > prevY) {
      x--;
      y--;
      result.push({ type: 'equal', value: a[x] });
    }

    if (x === prevX) {
      // Insertion from b
      y--;
      result.push({ type: 'add', value: b[y] });
    } else {
      // Deletion from a
      x--;
      result.push({ type: 'remove', value: a[x] });
    }
  }

  // Remaining diagonal at d=0
  while (x > 0 && y > 0) {
    x--;
    y--;
    result.push({ type: 'equal', value: a[x] });
  }

  result.reverse();
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Line-level diffing
// ═══════════════════════════════════════════════════════════════════════════════

/** Split text into lines, preserving empty trailing line only if explicitly present. */
function splitLines(text: string): string[] {
  // Split on newlines — keep the content of each line without the newline itself
  const lines = text.split('\n');
  // If the text ends with \n, the split produces one extra empty string — keep it
  return lines;
}

/**
 * Compute a line-level diff between two texts.
 *
 * @param oldText The original text.
 * @param newText The modified text.
 * @param filePath Display path for the diff header.
 * @param contextLines Number of unchanged context lines around each hunk (default: 3).
 * @returns A full diff result with hunks and unified diff string.
 */
export function computeDiff(
  oldText: string,
  newText: string,
  filePath: string = 'file',
  contextLines: number = 3,
): IDiffResult {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  // Compute raw edit script
  const ops = myersDiff(oldLines, newLines, (a, b) => a === b);

  // Assign line numbers
  let oldLineNo = 1;
  let newLineNo = 1;
  const allChanges: ILineDiffChange[] = [];

  for (const op of ops) {
    switch (op.type) {
      case 'equal':
        allChanges.push({ type: 'equal', content: op.value, oldLineNumber: oldLineNo, newLineNumber: newLineNo });
        oldLineNo++;
        newLineNo++;
        break;
      case 'remove':
        allChanges.push({ type: 'remove', content: op.value, oldLineNumber: oldLineNo });
        oldLineNo++;
        break;
      case 'add':
        allChanges.push({ type: 'add', content: op.value, newLineNumber: newLineNo });
        newLineNo++;
        break;
    }
  }

  // Check if identical
  const isIdentical = allChanges.every((c) => c.type === 'equal');
  if (isIdentical) {
    return {
      filePath,
      isIdentical: true,
      hunks: [],
      additions: 0,
      deletions: 0,
      unifiedDiff: '',
    };
  }

  // Group into hunks with context
  const hunks = _buildHunks(allChanges, contextLines);

  // Count additions/deletions
  let additions = 0;
  let deletions = 0;
  for (const c of allChanges) {
    if (c.type === 'add') { additions++; }
    if (c.type === 'remove') { deletions++; }
  }

  // Build unified diff string
  const unifiedDiff = _formatUnifiedDiff(filePath, hunks);

  return {
    filePath,
    isIdentical: false,
    hunks,
    additions,
    deletions,
    unifiedDiff,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hunk building
// ═══════════════════════════════════════════════════════════════════════════════

/** Build hunks from a flat change list, including context lines around changes. */
function _buildHunks(changes: ILineDiffChange[], contextLines: number): IDiffHunk[] {
  const hunks: IDiffHunk[] = [];

  // Find regions of changes (non-equal)
  const changeIndices: number[] = [];
  for (let i = 0; i < changes.length; i++) {
    if (changes[i].type !== 'equal') {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) { return hunks; }

  // Group change indices into hunk ranges (merging when context overlaps)
  let hunkStart = Math.max(0, changeIndices[0] - contextLines);
  let hunkEnd = Math.min(changes.length - 1, changeIndices[0] + contextLines);

  const hunkRanges: Array<{ start: number; end: number }> = [];

  for (let i = 1; i < changeIndices.length; i++) {
    const candidateStart = Math.max(0, changeIndices[i] - contextLines);
    const candidateEnd = Math.min(changes.length - 1, changeIndices[i] + contextLines);

    if (candidateStart <= hunkEnd + 1) {
      // Merge with current hunk
      hunkEnd = candidateEnd;
    } else {
      // Finalize current hunk, start new one
      hunkRanges.push({ start: hunkStart, end: hunkEnd });
      hunkStart = candidateStart;
      hunkEnd = candidateEnd;
    }
  }
  hunkRanges.push({ start: hunkStart, end: hunkEnd });

  // Build IDiffHunk for each range
  for (const range of hunkRanges) {
    const hunkChanges = changes.slice(range.start, range.end + 1);

    // Calculate old/new start line numbers and counts
    let oldStart = 0;
    let oldCount = 0;
    let newStart = 0;
    let newCount = 0;
    let foundFirst = false;

    for (const c of hunkChanges) {
      if (!foundFirst) {
        oldStart = c.oldLineNumber ?? (c.newLineNumber ?? 1);
        newStart = c.newLineNumber ?? (c.oldLineNumber ?? 1);
        foundFirst = true;
      }
      if (c.type === 'equal' || c.type === 'remove') { oldCount++; }
      if (c.type === 'equal' || c.type === 'add') { newCount++; }
    }

    hunks.push({
      oldStart,
      oldCount,
      newStart,
      newCount,
      changes: hunkChanges,
    });
  }

  return hunks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unified diff formatting
// ═══════════════════════════════════════════════════════════════════════════════

/** Format hunks as a unified diff string. */
function _formatUnifiedDiff(filePath: string, hunks: readonly IDiffHunk[]): string {
  const lines: string[] = [];

  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);

  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);

    for (const change of hunk.changes) {
      switch (change.type) {
        case 'equal':
          lines.push(` ${change.content}`);
          break;
        case 'remove':
          lines.push(`-${change.content}`);
          break;
        case 'add':
          lines.push(`+${change.content}`);
          break;
      }
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Word-level diffing (for inline change highlighting)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tokenize a line into words and whitespace for word-level diffing.
 * Splits on word boundaries while preserving whitespace as separate tokens.
 */
function tokenizeLine(line: string): string[] {
  const tokens: string[] = [];
  const re = /(\s+)|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

/**
 * Compute word-level diff between two lines.
 * Useful for highlighting exactly what changed within a modified line.
 *
 * @param oldLine The original line.
 * @param newLine The modified line.
 * @returns Array of word changes.
 */
export function computeWordDiff(oldLine: string, newLine: string): IWordChange[] {
  const oldTokens = tokenizeLine(oldLine);
  const newTokens = tokenizeLine(newLine);

  const ops = myersDiff(oldTokens, newTokens, (a, b) => a === b);

  return ops.map((op) => ({
    type: op.type,
    value: op.value,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Statistics helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Estimate token count for a diff (for token budget calculations). */
export function estimateDiffTokens(diff: IDiffResult): number {
  // Rough estimate: unified diff chars / 4
  return Math.ceil(diff.unifiedDiff.length / 4);
}

/** Format a compact summary string: "+3 -2 lines in file.ts". */
export function formatDiffSummary(diff: IDiffResult): string {
  if (diff.isIdentical) {
    return `No changes in ${diff.filePath}`;
  }
  return `+${diff.additions} -${diff.deletions} lines in ${diff.filePath}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DiffService (stateless utility service)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Service wrapper for diff computation.
 * Provides a DI-compatible interface for the diff engine.
 */
export class DiffService extends Disposable {

  /** Compute a line-level diff between two texts. */
  computeDiff(oldText: string, newText: string, filePath?: string, contextLines?: number): IDiffResult {
    return computeDiff(oldText, newText, filePath, contextLines);
  }

  /** Compute word-level diff between two lines. */
  computeWordDiff(oldLine: string, newLine: string): IWordChange[] {
    return computeWordDiff(oldLine, newLine);
  }

  /** Estimate token count for a diff result. */
  estimateTokens(diff: IDiffResult): number {
    return estimateDiffTokens(diff);
  }

  /** Format a compact summary. */
  formatSummary(diff: IDiffResult): string {
    return formatDiffSummary(diff);
  }
}
