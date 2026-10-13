// conceptMapKeys.ts — a concept map's pointer-only gestures, from the keyboard
// (docs/ACCESSIBILITY.md, section 6). A frame drawn across the board selects
// boxes: PageDown/PageUp pick the next or previous box in outline order, and
// with Shift add it to the selection. The right-edge grip resizes: Ctrl+Left/
// Right narrow or widen every selected box by one cell, by the grip's rule.

import { MAP_CELL2, type MindMapOverrides } from './conceptMap.js';

/** A box's width as the grip sets it: 80 to 420, on the cell, never under its longest word. */
export function snapBoxWidth(raw: number, floor: number): number {
  return Math.max(floor, MAP_CELL2, Math.round(Math.max(80, Math.min(420, raw)) / MAP_CELL2) * MAP_CELL2);
}

/**
 * The selection after PageDown (dir 1) or PageUp (-1): the box after the
 * last selected (before the first), wrapping; `add` keeps what was selected.
 * With nothing selected it starts at the first box (the last for PageUp).
 */
export function stepSelection(drawn: readonly number[], selected: readonly number[], dir: 1 | -1, add: boolean): number[] {
  const lines = [...drawn].sort((a, b) => a - b);
  if (!lines.length) return [];
  const sel = selected.filter((l) => lines.includes(l)).sort((a, b) => a - b);
  let at: number;
  if (!sel.length) at = dir > 0 ? 0 : lines.length - 1;
  else at = (lines.indexOf(dir > 0 ? sel[sel.length - 1] : sel[0]) + dir + lines.length) % lines.length;
  return add ? [...new Set([...sel, lines[at]])] : [lines[at]];
}

/** The overrides with every box one cell narrower (dir -1) or wider (1). */
export function resizedOverrides(
  overrides: MindMapOverrides,
  boxes: readonly { key: string; w: number; floor: number }[],
  dir: 1 | -1,
): MindMapOverrides {
  const next: Record<string, { dx?: number; dy?: number; w?: number }> = { ...overrides };
  for (const b of boxes) next[b.key] = { ...next[b.key], w: snapBoxWidth(b.w + dir * MAP_CELL2, b.floor) };
  return next;
}
