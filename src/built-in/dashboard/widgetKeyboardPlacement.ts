// widgetKeyboardPlacement.ts — the keyboard's drag for a dashboard widget.
//
// With focus anywhere in a widget, Alt+arrows move it one cell and
// Alt+Shift+arrows size it (Right and Down grow, Left and Up shrink),
// inside the grid and the widget type's size bounds, the same limits a
// drag keeps. docs/ACCESSIBILITY.md, section 6.

import type { WidgetPlacement } from './dashboardTypes.js';

export interface IWidgetSizeBounds {
  readonly minColSpan?: number;
  readonly maxColSpan?: number;
  readonly minRowSpan?: number;
  readonly maxRowSpan?: number;
}

const STEP: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

/** Where an Alt+arrow key puts the widget, or null when the key is not one or nothing changes. */
export function placementForKey(
  p: WidgetPlacement,
  e: Pick<KeyboardEvent, 'key' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
  bounds: IWidgetSizeBounds | undefined,
  cols: number,
): WidgetPlacement | null {
  const step = STEP[e.key];
  if (!step || !e.altKey || e.ctrlKey || e.metaKey) return null;
  const [dc, dr] = step;
  let next: WidgetPlacement;
  if (e.shiftKey) {
    const colSpan = Math.max(bounds?.minColSpan ?? 1, Math.min(bounds?.maxColSpan ?? cols, cols - p.col, p.colSpan + dc));
    const rowSpan = Math.max(bounds?.minRowSpan ?? 1, Math.min(bounds?.maxRowSpan ?? 12, p.rowSpan + dr));
    next = { ...p, colSpan, rowSpan };
  } else {
    next = { ...p, col: Math.max(0, Math.min(cols - p.colSpan, p.col + dc)), row: Math.max(0, p.row + dr) };
  }
  const same = next.col === p.col && next.row === p.row && next.colSpan === p.colSpan && next.rowSpan === p.rowSpan;
  return same ? null : next;
}
