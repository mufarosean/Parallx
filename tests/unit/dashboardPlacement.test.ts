// @vitest-environment jsdom
// New widgets fill the first free spot instead of all stacking in column 0.
import { describe, expect, it } from 'vitest';

import { firstFitPlacement } from '../../src/built-in/dashboard/dashboardEditorProvider';

describe('dashboard first-fit placement', () => {
  it('an empty page starts at the top left', () => {
    expect(firstFitPlacement([], { colSpan: 4, rowSpan: 2 }, 12)).toEqual({ row: 0, col: 0, rowSpan: 2, colSpan: 4 });
  });

  it('the next widget sits beside the last one while the row has room', () => {
    const taken = [{ row: 0, col: 0, rowSpan: 2, colSpan: 4 }];
    expect(firstFitPlacement(taken, { colSpan: 4, rowSpan: 2 }, 12)).toEqual({ row: 0, col: 4, rowSpan: 2, colSpan: 4 });
  });

  it('a full row sends it below, never overlapping', () => {
    const taken = [{ row: 0, col: 0, rowSpan: 2, colSpan: 6 }, { row: 0, col: 6, rowSpan: 3, colSpan: 6 }];
    const p = firstFitPlacement(taken, { colSpan: 6, rowSpan: 2 }, 12);
    expect(p).toEqual({ row: 2, col: 0, rowSpan: 2, colSpan: 6 });
  });

  it('a widget wider than the grid is clamped to it', () => {
    expect(firstFitPlacement([], { colSpan: 20, rowSpan: 1 }, 12).colSpan).toBe(12);
  });
});
