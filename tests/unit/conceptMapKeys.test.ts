// conceptMapKeys.test.ts — a concept map's frame selection and edge resize
// from the keyboard: PageDown/PageUp step the selection through the boxes in
// outline order (Shift adds), Ctrl+Left/Right resize by the grip's own rule.
// docs/ACCESSIBILITY.md, section 6.

import { describe, expect, it } from 'vitest';
import { resizedOverrides, snapBoxWidth, stepSelection } from '../../src/ui/conceptMapKeys';
import { MAP_CELL2 } from '../../src/ui/conceptMap';

describe('concept map keys', () => {
  it('steps the selection, wrapping, and adds with Shift', () => {
    const drawn = [4, 0, 2, 7];
    expect(stepSelection(drawn, [], 1, false)).toEqual([0]);
    expect(stepSelection(drawn, [], -1, false)).toEqual([7]);
    expect(stepSelection(drawn, [2], 1, false)).toEqual([4]);
    expect(stepSelection(drawn, [7], 1, false)).toEqual([0]);
    expect(stepSelection(drawn, [0], -1, false)).toEqual([7]);
    expect(stepSelection(drawn, [0, 2], 1, true)).toEqual([0, 2, 4]);
    expect(stepSelection(drawn, [2, 4], -1, true)).toEqual([2, 4, 0]);
    expect(stepSelection(drawn, [99], 1, false)).toEqual([0]); // a line no longer drawn
    expect(stepSelection([], [1], 1, false)).toEqual([]);
  });

  it('resizes by one cell inside the grip\'s bounds, keeping a moved box\'s offset', () => {
    expect(snapBoxWidth(1000, 0)).toBe(Math.round(420 / MAP_CELL2) * MAP_CELL2);
    expect(snapBoxWidth(10, 0)).toBe(Math.max(MAP_CELL2, Math.round(80 / MAP_CELL2) * MAP_CELL2));
    expect(snapBoxWidth(10, 150)).toBe(150); // never under its longest word
    const next = resizedOverrides({ a: { dx: 8 } }, [{ key: 'a', w: 160, floor: 40 }, { key: 'b', w: 160, floor: 40 }], 1);
    expect(next.a).toEqual({ dx: 8, w: snapBoxWidth(160 + MAP_CELL2, 40) });
    expect(next.b).toEqual({ w: snapBoxWidth(160 + MAP_CELL2, 40) });
    expect(resizedOverrides({}, [{ key: 'a', w: 160, floor: 40 }], -1).a?.w).toBe(snapBoxWidth(160 - MAP_CELL2, 40));
  });
});
