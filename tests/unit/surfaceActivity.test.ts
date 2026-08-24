/**
 * Foundation step 7 — activity keyed by surface.
 *
 * Decision 7's claim is that specificity comes free once surfaces have
 * identity: which surface, bound to what, for how long, adjacent to what
 * else. These tests pin the grammar and, more importantly, the restraint —
 * dwell below the threshold stays silent, and switching arrangements reads
 * as ONE act instead of a burst of closes nobody performed.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { SurfaceTree } from '../../src/surfaces/surfaceTree';
import { SurfaceRegistry } from '../../src/surfaces/surfaceRegistry';
import { resolveArrangement } from '../../src/surfaces/arrangement';
import {
  SurfaceActivityTap,
  MIN_DWELL_MS,
  formatDuration,
  type ISurfaceActivityNote,
} from '../../src/surfaces/surfaceActivity';
import {
  SurfacePlacement,
  type ISurface,
  type ISurfaceBinding,
  type ISurfaceDescriptor,
  type SurfaceState,
} from '../../src/surfaces/surfaceTypes';
import { Emitter } from '../../src/platform/events';
import { Orientation, DEFAULT_SIZE_CONSTRAINTS } from '../../src/layout/layoutTypes';

class TestSurface implements ISurface {
  binding: ISurfaceBinding | undefined;
  element: HTMLElement | undefined;
  minimumWidth = 80; maximumWidth = Infinity;
  minimumHeight = 80; maximumHeight = Infinity;

  private readonly _t = new Emitter<void>();
  readonly onDidChangeTitle = this._t.event;
  private readonly _c = new Emitter<void>();
  readonly onDidChangeConstraints = this._c.event;
  private readonly _v = new Emitter<boolean>();
  readonly onDidChangeVisibility = this._v.event;

  constructor(readonly id: string, readonly typeId: string) {}
  get title(): string { return this.binding?.label ?? this.typeId; }
  create(c: HTMLElement): void { this.element = document.createElement('div'); c.appendChild(this.element); }
  async setBinding(b: ISurfaceBinding | undefined): Promise<void> { this.binding = b; }
  layout(): void {}
  setVisible(): void {}
  focus(): void {}
  saveState(): SurfaceState { return {}; }
  restoreState(): void {}
  dispose(): void { this._t.dispose(); this._c.dispose(); this._v.dispose(); }
}

function descriptor(typeId: string): ISurfaceDescriptor {
  return {
    typeId, name: typeId, placement: SurfacePlacement.Center,
    constraints: DEFAULT_SIZE_CONSTRAINTS,
    bindingKinds: ['file'],
    create: (id) => new TestSurface(id, typeId),
  };
}

const file = (p: string, label = p): ISurfaceBinding => ({ kind: 'file', key: p, label });

describe('SurfaceActivityTap', () => {
  let registry: SurfaceRegistry;
  let tree: SurfaceTree;
  let notes: ISurfaceActivityNote[];
  let now: number;

  const line = (n: ISurfaceActivityNote): string =>
    [n.verb, n.object, n.detail].filter(Boolean).join(' ');

  beforeEach(() => {
    registry = new SurfaceRegistry();
    registry.register(descriptor('editor.text'));
    registry.register(descriptor('explorer'));
    tree = new SurfaceTree(registry, Orientation.Horizontal, 1200, 800);
    notes = [];
    now = 1_000_000;
    new SurfaceActivityTap(tree, registry, (n) => notes.push(n), () => now);
  });

  it('narrates an open with the binding as identity', () => {
    tree.open('editor.text', file('/t.pdf', 'Taylor.pdf'));
    expect(notes).toHaveLength(1);
    expect(line(notes[0])).toBe('opened "Taylor.pdf"');
    expect(notes[0].ref).toBe('file:/t.pdf');
    expect(notes[0].source).toBe('surface');
  });

  it('names a bindingless surface by its type, unquoted', () => {
    tree.open('explorer');
    expect(notes[0].object).toBe('explorer');
    expect(notes[0].ref).toBe('surface:explorer');
  });

  it('narrates a close, with duration once it was open long enough', () => {
    const s = tree.open('editor.text', file('/a.md'));
    now += 5 * 60_000;
    tree.close(s.id);
    const closed = notes.find((n) => n.verb === 'closed');
    expect(closed?.detail).toBe('after 5m');
  });

  it('says how long a surface held focus, and only past the threshold', () => {
    const a = tree.open('editor.text', file('/a.md', 'a.md'));
    const b = tree.open('editor.text', file('/b.md', 'b.md'), { preserveFocus: true });

    // A quick flick over to b and back is navigation, not work.
    tree.setActive(b.id);
    now += MIN_DWELL_MS - 1;
    tree.setActive(a.id);
    expect(notes.filter((n) => n.verb === 'worked in')).toHaveLength(0);

    now += 12 * 60_000;
    tree.setActive(b.id);
    const dwell = notes.filter((n) => n.verb === 'worked in');
    expect(dwell).toHaveLength(1);
    expect(line(dwell[0])).toBe('worked in "a.md" for 12m');
    expect(dwell[0].ref).toBe('file:/a.md');
  });

  it('describes a move by its adjacency', () => {
    const a = tree.open('editor.text', file('/a.md', 'a.md'));
    const b = tree.open('editor.text', file('/b.md', 'b.md'));
    tree.move(a.id, b.id, Orientation.Vertical);
    const moved = notes.find((n) => n.verb === 'moved');
    expect(line(moved!)).toBe('moved "a.md" below "b.md"');
  });

  it('describes an edge move by its edge', () => {
    const a = tree.open('editor.text', file('/a.md', 'a.md'));
    tree.open('editor.text', file('/b.md'));
    tree.moveToEdge(a.id, Orientation.Horizontal, true);
    const moved = notes.find((n) => n.verb === 'moved');
    expect(line(moved!)).toBe('moved "a.md" to the left edge');
  });

  it('narrates an arrangement switch as one act, not a burst of closes', () => {
    tree.open('editor.text', file('/a.md'));
    tree.open('explorer');
    const arrangement = tree.capture({ id: 'study', name: 'Study' });
    expect(notes.some((n) => n.verb === 'saved' && n.object === 'arrangement "Study"')).toBe(true);

    notes.length = 0;
    tree.restore(resolveArrangement(arrangement, (t) => registry.getDescriptor(t)));

    expect(notes.filter((n) => n.verb === 'closed')).toHaveLength(0);
    expect(notes.filter((n) => n.verb === 'opened')).toHaveLength(0);
    const switched = notes.find((n) => n.verb === 'switched to');
    expect(line(switched!)).toBe('switched to arrangement "Study" 2 surfaces');
  });

  it('reports the unavailable count when a restore degrades', () => {
    tree.open('editor.text', file('/a.md'));
    tree.open('explorer');
    const arrangement = tree.capture({ id: 'x', name: 'X' });
    notes.length = 0;

    tree.restore(resolveArrangement(
      arrangement,
      (t) => (t === 'explorer' ? undefined : registry.getDescriptor(t)),
    ));
    const switched = notes.find((n) => n.verb === 'switched to');
    expect(switched?.detail).toBe('1 surfaces, 1 unavailable');
  });
});

describe('formatDuration', () => {
  it('reads like narration at every scale', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(12 * 60_000)).toBe('12m');
    expect(formatDuration(125 * 60_000)).toBe('2h 5m');
  });
});
