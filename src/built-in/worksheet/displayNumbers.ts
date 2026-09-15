// displayNumbers.ts — Worksheets: how many decimals an unformatted number shows.
//
// PURE (unit-tested in tests/unit/worksheetDisplayDecimals.test.ts). The
// engine keeps full precision and so does the cell editor; this only decides
// what a cell WITHOUT a number format paints, the way Excel's General trims a
// long fraction. A number format set on a cell always wins (the engine host
// checks that before calling roundForDisplay).

/** The worksheet.displayDecimals setting's choices. */
export const DISPLAY_DECIMALS_CHOICES = ['2', '4', '6', '8', 'full'] as const;
export const DEFAULT_DISPLAY_DECIMALS = '4';

/** The setting as a number of decimals; null shows what the engine keeps. */
export function parseDisplayDecimals(setting: unknown): number | null {
  if (setting === 'full') return null;
  const n = typeof setting === 'number' ? setting : parseInt(String(setting ?? ''), 10);
  return Number.isInteger(n) && n >= 0 && n <= 15 ? n : parseInt(DEFAULT_DISPLAY_DECIMALS, 10);
}

/**
 * The number to paint for `v` under `decimals`. Integers and anything that
 * already fits pass through unchanged. A value too small to survive the
 * rounding keeps three significant digits rather than reading as zero.
 */
export function roundForDisplay(v: number, decimals: number | null): number {
  if (decimals === null || !Number.isFinite(v) || Number.isInteger(v)) return v;
  const rounded = Number(v.toFixed(decimals));
  if (rounded === 0 && v !== 0) return Number(v.toPrecision(3));
  return rounded;
}
