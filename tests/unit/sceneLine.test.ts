// sceneLine.test.ts — the one line about the scene that rides on the user's
// turn: the editor in front, the focused surface and its selection, or
// nothing at all. docs/SELF_DESCRIBING_UI_DESIGN.md step 8.

import { describe, it, expect } from 'vitest';
import { formatSceneLine, type SceneNode } from '../../src/ui/scene.js';

const surface = (id: string, label: string, extra: Partial<SceneNode> = {}): SceneNode =>
  ({ id, kind: 'surface', owner: 'core', label, visible: true, ...extra });

describe('formatSceneLine', () => {
  it('is empty when nothing is mounted', () => {
    expect(formatSceneLine({ surfaces: [] })).toBe('');
  });

  it('names the editor in front, the focused surface and its selection', () => {
    const line = formatSceneLine({ surfaces: [
      surface('editorGroup', 'Group', { instance: 'g1', children: [
        surface('canvas', 'Alpha', { owner: 'canvas', instance: 'p1', visible: false }),
        surface('pdf', 'Reading', { owner: 'pdf', instance: 'p2' }),
      ] }),
      surface('sidebar', 'Sidebar', { children: [
        surface('view.explorer', 'Explorer', { owner: 'explorer', focused: true, children: [
          { id: 'explorer.tree', kind: 'tree', owner: 'explorer', label: 'Files', visible: true, state: { kind: 'selection', value: ['notes/alpha.md'], count: 12 } },
          { id: 'explorer.newFile', kind: 'iconButton', owner: 'explorer', label: 'New File', visible: true },
        ] }),
      ] }),
    ] });
    expect(line).toBe('[Scene: editor "Reading" (pdf); focused "Explorer" (view.explorer); explorer.tree: notes/alpha.md]');
  });

  it('does not repeat the editor when it is the focused surface, and caps a long selection', () => {
    const many = Array.from({ length: 8 }, (_, i) => `row${i}`);
    const line = formatSceneLine({ surfaces: [
      surface('editorGroup', 'Group', { children: [
        surface('worksheet', 'Sheet 3', { owner: 'worksheet', focused: true, children: [
          { id: 'worksheet.bank.list', kind: 'list', owner: 'worksheet', label: 'Problems', visible: true, state: { kind: 'selection', value: many, count: many.length } },
        ] }),
      ] }),
    ] });
    expect(line).toBe('[Scene: editor "Sheet 3" (worksheet); worksheet.bank.list: row0, row1, row2, row3, row4, +3]');
  });
});
