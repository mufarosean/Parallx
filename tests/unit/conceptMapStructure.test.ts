// conceptMapStructure.test.ts — restructuring a concept map and where its
// cards stand (ui/conceptMap). Pins: branches move as whole blocks of
// outline lines (under another card, among siblings, in and out a level,
// deleted together); override keys tell repeated labels apart; deltas
// carry a card's branch with it; the board keeps its frame when a card
// moves inside it; maps saved with per-card deltas look the same after
// migration.

import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  deleteBranches,
  indentBranch,
  layoutMindMap,
  MAP_GRID,
  migrateFlatOverrides,
  moveBranchAmongSiblings,
  moveBranchesUnder,
  outdentBranch,
  outlineTree,
  overrideKeysByLine,
  parseMindMap,
  pruneOverrides,
  renderMindMapSvg,
  subtreeLines,
  topmostLines,
} from '../../src/ui/conceptMap';

const SRC = [
  'Reserving',          // 0
  '  Chain Ladder',     // 1
  '    Mack',           // 2
  '    Bootstrap',      // 3
  '  Bornhuetter',      // 4
  '    Prior',          // 5
  '  Cape Cod',         // 6
].join('\n');

const labelsUnder = (src: string, label: string): string[] => {
  const find = (ns: ReturnType<typeof parseMindMap>): ReturnType<typeof parseMindMap>[number] | undefined => {
    for (const n of ns) {
      if (n.label === label) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  return (find(parseMindMap(src))?.children ?? []).map((c) => c.label);
};

describe('the drawn tree', () => {
  it('knows parents, children and branches by line', () => {
    const t = outlineTree(SRC);
    expect(t.roots).toEqual([0]);
    expect(t.parentOf.get(2)).toBe(1);
    expect(t.kidsOf.get(1)).toEqual([2, 3]);
    expect(subtreeLines(t, 1)).toEqual([1, 2, 3]);
  });
  it('collapses a pick to its topmost lines', () => {
    expect(topmostLines(outlineTree(SRC), [2, 1, 5, 99])).toEqual([1, 5]);
  });
});

describe('moving branches under another card', () => {
  it('moves a branch with its children, re-indented as a whole, after the last child', () => {
    const out = moveBranchesUnder(SRC, [1], 4)!;
    expect(labelsUnder(out.src, 'Bornhuetter')).toEqual(['Prior', 'Chain Ladder']);
    expect(labelsUnder(out.src, 'Chain Ladder')).toEqual(['Mack', 'Bootstrap']);
    expect(labelsUnder(out.src, 'Reserving')).toEqual(['Bornhuetter', 'Cape Cod']);
    expect(out.src.split('\n')[out.lines[0]]).toBe('    Chain Ladder');
  });
  it('moves several picks together, in outline order; a nested pick rides with its parent', () => {
    const out = moveBranchesUnder(SRC, [6, 2, 1], 5)!;
    expect(labelsUnder(out.src, 'Prior')).toEqual(['Chain Ladder', 'Cape Cod']);
    expect(out.lines.map((l) => out.src.split('\n')[l].trim())).toEqual(['Chain Ladder', 'Cape Cod']);
  });
  it('takes the indent the target children already use', () => {
    const four = 'Root\n    A\n    B\n        b1';
    const out = moveBranchesUnder(four, [2], 1)!;
    expect(out.src).toBe('Root\n    A\n        B\n            b1');
  });
  it('refuses to move a branch into itself, or under its own parent', () => {
    expect(moveBranchesUnder(SRC, [1], 2)).toBeNull();
    expect(moveBranchesUnder(SRC, [1], 1)).toBeNull();
    expect(moveBranchesUnder(SRC, [2], 1)).toBeNull();
  });
  it('can move a top-level card under another', () => {
    const out = moveBranchesUnder('A\n  a1\nB', [2], 0)!;
    expect(out.src).toBe('A\n  a1\n  B');
  });
});

describe('reordering and re-nesting', () => {
  it('swaps a branch with its previous or next sibling, children included', () => {
    const up = moveBranchAmongSiblings(SRC, 4, -1)!;
    expect(labelsUnder(up.src, 'Reserving')).toEqual(['Bornhuetter', 'Chain Ladder', 'Cape Cod']);
    expect(up.src.split('\n')[up.lines[0]].trim()).toBe('Bornhuetter');
    const down = moveBranchAmongSiblings(SRC, 1, 1)!;
    expect(labelsUnder(down.src, 'Reserving')).toEqual(['Bornhuetter', 'Chain Ladder', 'Cape Cod']);
    expect(down.src.split('\n')[down.lines[0]].trim()).toBe('Chain Ladder');
    expect(labelsUnder(down.src, 'Chain Ladder')).toEqual(['Mack', 'Bootstrap']);
    expect(moveBranchAmongSiblings(SRC, 1, -1)).toBeNull();
    expect(moveBranchAmongSiblings(SRC, 6, 1)).toBeNull();
  });
  it('indents under the previous sibling and outdents to after the parent', () => {
    const inn = indentBranch(SRC, 4)!;
    expect(labelsUnder(inn.src, 'Chain Ladder')).toEqual(['Mack', 'Bootstrap', 'Bornhuetter']);
    expect(labelsUnder(inn.src, 'Bornhuetter')).toEqual(['Prior']);
    expect(indentBranch(SRC, 1)).toBeNull();
    const out = outdentBranch(SRC, 2)!;
    expect(labelsUnder(out.src, 'Reserving')).toEqual(['Chain Ladder', 'Mack', 'Bornhuetter', 'Cape Cod']);
    expect(labelsUnder(out.src, 'Chain Ladder')).toEqual(['Bootstrap']);
    expect(outdentBranch(SRC, 0)).toBeNull();
  });
  it('deletes several branches at once, but never the whole map', () => {
    expect(deleteBranches(SRC, [2, 4])).toBe('Reserving\n  Chain Ladder\n    Bootstrap\n  Cape Cod');
    expect(deleteBranches(SRC, [0])).toBeNull();
  });
  it('keeps blank lines out of a moved branch', () => {
    const out = moveBranchesUnder('Root\n  A\n\n  B', [1], 3)!;
    expect(parseMindMap(out.src)[0].children.map((c) => c.label)).toEqual(['B']);
    expect(labelsUnder(out.src, 'B')).toEqual(['A']);
  });
});

describe('override keys', () => {
  it('count a repeated label, so two boxes never share a position', () => {
    const keys = [...overrideKeysByLine(parseMindMap('Root\n  Idea\n  Idea\n  Other')).values()];
    expect(keys[1]).toBe('Idea');
    expect(keys[2]).not.toBe('Idea');
    expect(keys[2].startsWith('Idea')).toBe(true);
    const base = layoutMindMap(parseMindMap('Root\n  Idea\n  Idea'), 'right');
    const moved = applyOverrides(base, { [keys[2]]: { dy: 4 * MAP_GRID } });
    expect(moved.nodes[1].y).toBe(base.nodes[1].y);
    expect(moved.nodes[2].y).toBe(base.nodes[2].y + 4 * MAP_GRID);
    expect(renderMindMapSvg('Root\n  Idea\n  Idea')).toContain(`data-mm-key="${keys[2]}"`);
  });
  it('prune by key: a second box that is gone takes its entry with it', () => {
    const keys = [...overrideKeysByLine(parseMindMap('Root\n  Idea\n  Idea')).values()];
    const pruned = pruneOverrides({ Idea: { dx: 18 }, [keys[2]]: { dx: 36 } }, 'Root\n  Idea');
    expect(Object.keys(pruned)).toEqual(['Idea']);
  });
});

describe('where cards stand', () => {
  const base = layoutMindMap(parseMindMap(SRC), 'right');
  const at = (layout: typeof base, label: string) => layout.nodes.find((n) => n.label === label)!;

  it('moving a card carries its whole branch', () => {
    const moved = applyOverrides(base, { 'Chain Ladder': { dx: 5 * MAP_GRID, dy: 2 * MAP_GRID } });
    for (const l of ['Chain Ladder', 'Mack', 'Bootstrap']) {
      expect(at(moved, l).x - at(base, l).x).toBe(5 * MAP_GRID);
      expect(at(moved, l).y - at(base, l).y).toBe(2 * MAP_GRID);
    }
    expect(at(moved, 'Prior').x).toBe(at(base, 'Prior').x);
  });
  it('the board keeps its frame: moving the topmost card down moves nothing else', () => {
    const top = [...base.nodes].sort((a, b) => (a.y - a.height / 2) - (b.y - b.height / 2))[0];
    const moved = applyOverrides(base, { [top.key!]: { dy: 6 * MAP_GRID } });
    expect(at(moved, 'Cape Cod')).toMatchObject({ x: at(base, 'Cape Cod').x, y: at(base, 'Cape Cod').y });
    expect(at(moved, top.label).y).toBe(top.y + 6 * MAP_GRID);
  });
  it('moving the root carries the whole map', () => {
    const moved = applyOverrides(base, { Reserving: { dx: 2 * MAP_GRID } });
    for (const n of base.nodes) expect(at(moved, n.label).x).toBe(n.x + 2 * MAP_GRID);
  });
  it('a card left of the margin (an old save) shifts the board by whole cells', () => {
    const moved = applyOverrides(base, { Bornhuetter: { dx: -400 } });
    for (const n of moved.nodes) expect(n.x).toBeGreaterThanOrEqual(MAP_GRID);
    const shift = at(moved, 'Cape Cod').x - at(base, 'Cape Cod').x;
    expect(shift % MAP_GRID).toBe(0);
  });
  it('the board grows to hold a card moved past its edge', () => {
    const moved = applyOverrides(base, { 'Cape Cod': { dx: 20 * MAP_GRID, dy: 20 * MAP_GRID } });
    const c = at(moved, 'Cape Cod');
    expect(moved.width).toBeGreaterThanOrEqual(c.x + c.width + MAP_GRID);
    expect(moved.height).toBeGreaterThanOrEqual(c.y + c.height / 2 + MAP_GRID);
  });
  it('a map saved with per-card deltas looks the same after migration', () => {
    const flat = { 'Chain Ladder': { dx: 90, dy: 36 }, Mack: { dx: 90, dy: 36 }, Bootstrap: { dx: 0, dy: 0 }, Prior: { dx: 18, w: 160 } };
    const tree = migrateFlatOverrides(SRC, flat);
    expect(tree.Mack).toBeUndefined();
    expect(tree.Bootstrap).toEqual({ dx: -90, dy: -36 });
    expect(tree.Prior).toEqual({ dx: 18, w: 160 });
    const after = applyOverrides(base, tree);
    const expected: Record<string, [number, number]> = {
      'Chain Ladder': [90, 36], Mack: [90, 36], Bootstrap: [0, 0], Prior: [18, 0], 'Cape Cod': [0, 0],
    };
    for (const [l, [dx, dy]] of Object.entries(expected)) {
      expect(at(after, l).x - at(base, l).x).toBe(dx);
      expect(at(after, l).y - at(base, l).y).toBe(dy);
    }
  });
});
