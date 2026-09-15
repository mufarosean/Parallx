// @vitest-environment jsdom
//
// Editor group layout persistence: the splits' shape and sizes survive a
// relaunch, in SCREEN order. Before this the editor snapshot carried only
// the tabs per group in creation order, so every relaunch re-split at the
// middle and a group the user kept on the left could come back on the
// right.
import { describe, it, expect, afterEach } from 'vitest';
import { EditorPart } from '../../src/parts/editorPart';
import { GroupDirection } from '../../src/editor/editorTypes';
import { Orientation } from '../../src/layout/layoutTypes';
import { SerializedNodeType } from '../../src/layout/layoutModel';
import type { SerializedGrid, SerializedGridNode } from '../../src/layout/layoutModel';

// jsdom has no scrollIntoView; the tab bar calls it on every render.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => { /* noop */ });

const mounted: { part: EditorPart; host: HTMLElement }[] = [];

function mountPart(width = 1200, height = 800): EditorPart {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const part = new EditorPart();
  part.create(host);
  part.layout(width, height, Orientation.Horizontal);
  mounted.push({ part, host });
  return part;
}

function leafIds(grid: SerializedGrid): string[] {
  const out: string[] = [];
  const walk = (node: SerializedGridNode): void => {
    if (node.type === SerializedNodeType.Leaf) out.push(node.viewId);
    else node.children.forEach(walk);
  };
  walk(grid.root);
  return out;
}

/** Through JSON, as a save is. */
const roundTrip = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

afterEach(() => {
  for (const { part, host } of mounted.splice(0)) {
    part.dispose();
    host.remove();
  }
});

describe('editor group layout persistence', () => {
  /** A left-of-the-first split, resized: the shape the old snapshot lost. */
  function arrange(part: EditorPart): { left: string; right: string; saved: SerializedGrid } {
    const right = part.groups[0];
    const left = part.splitGroup(right.id, GroupDirection.Left)!;
    part.grid!.resizeView(left.id, 400);
    return { left: left.id, right: right.id, saved: roundTrip(part.serializeGroupLayout()!) };
  }

  it('serializes leaves in screen order with their pixel sizes', () => {
    const part = mountPart();
    const { left, right, saved } = arrange(part);
    // Creation order says right-then-left; the screen says left-then-right.
    expect(part.groups.map((g) => g.id)).toEqual([right, left]);
    expect(leafIds(saved)).toEqual([left, right]);
    expect(part.grid!.getViewSize(left)).toBe(400);
    expect(part.grid!.getViewSize(right)).toBe(800);
  });

  it('restores the shape and sizes into fresh groups, mapped by saved id', () => {
    const { left, right, saved } = arrange(mountPart());

    const part = mountPart();
    const mapping = part.restoreGroupLayout(saved)!;
    expect(mapping.size).toBe(2);
    const left2 = mapping.get(left)!;
    const right2 = mapping.get(right)!;
    expect(part.groupCount).toBe(2);
    // The registry is in screen order now, and so is the grid.
    expect(part.groups.map((g) => g.id)).toEqual([left2.id, right2.id]);
    expect(leafIds(part.serializeGroupLayout()!)).toEqual([left2.id, right2.id]);
    expect(part.grid!.getViewSize(left2.id)).toBe(400);
    expect(part.grid!.getViewSize(right2.id)).toBe(800);
    // Both groups are live in the DOM, one of them active.
    expect(left2.element.isConnected).toBe(true);
    expect(right2.element.isConnected).toBe(true);
    expect(part.activeGroup).toBeDefined();
  });

  it('scales the saved sizes to the window it wakes up in', () => {
    const { left, right, saved } = arrange(mountPart(1200, 800));
    const part = mountPart(900, 800);
    const mapping = part.restoreGroupLayout(saved)!;
    expect(part.grid!.getViewSize(mapping.get(left)!.id)).toBe(300);
    expect(part.grid!.getViewSize(mapping.get(right)!.id)).toBe(600);
  });

  it('disposes the groups the saved shape has no leaf for', () => {
    const { saved } = arrange(mountPart());
    const part = mountPart();
    part.splitGroup(part.groups[0].id, GroupDirection.Right);
    part.splitGroup(part.groups[0].id, GroupDirection.Down);
    expect(part.groupCount).toBe(3);
    const mapping = part.restoreGroupLayout(saved)!;
    expect(mapping.size).toBe(2);
    expect(part.groupCount).toBe(2);
    expect(new Set(part.groups.map((g) => g.id))).toEqual(new Set([...mapping.values()].map((g) => g.id)));
  });

  it('refuses an empty, repeated or malformed tree and keeps what it has', () => {
    const { left, saved } = arrange(mountPart());
    const part = mountPart();
    const before = part.groups.map((g) => g.id);

    const empty: SerializedGrid = { ...saved, root: { ...saved.root, children: [] } };
    expect(part.restoreGroupLayout(empty)).toBeUndefined();

    const repeated = roundTrip(saved);
    const repeatedLeaf = { type: SerializedNodeType.Leaf, viewId: left, size: 100, sizingMode: saved.root.children[0].sizingMode };
    (repeated.root.children as unknown[]).push(repeatedLeaf);
    expect(part.restoreGroupLayout(repeated)).toBeUndefined();

    const malformed = { ...saved, root: { ...saved.root, children: [{ type: 'branch', size: 10 }] } } as unknown as SerializedGrid;
    expect(part.restoreGroupLayout(malformed)).toBeUndefined();

    expect(part.restoreGroupLayout(undefined as unknown as SerializedGrid)).toBeUndefined();
    expect(part.groups.map((g) => g.id)).toEqual(before);
  });
});
