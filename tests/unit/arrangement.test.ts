/**
 * Foundation step 5 — arrangements.
 *
 * The piece that makes Parallx sandbox software: a saved shape of the app that
 * carries what each surface is POINTED AT, not just where it sits. These tests
 * pin the three properties that make it worth having — it round-trips, it
 * survives a missing extension, and it never trusts what it loads.
 */

import { describe, expect, it } from 'vitest';
import {
  ARRANGEMENT_VERSION,
  captureArrangement,
  resolveArrangement,
  parseArrangement,
  requiredTypeIds,
  type Arrangement,
} from '../../src/surfaces/arrangement';
import { SerializedNodeType } from '../../src/layout/layoutModel';
import type { SerializedGrid } from '../../src/layout/layoutModel';
import { Orientation, SizingMode } from '../../src/layout/layoutTypes';
import { SurfacePlacement, type ISurface, type ISurfaceDescriptor } from '../../src/surfaces/surfaceTypes';

// ── Fixtures ────────────────────────────────────────────────────────────────

function fakeSurface(
  id: string, typeId: string,
  binding?: { kind: string; key: string; label: string },
  state: Record<string, unknown> = {},
): ISurface {
  return {
    id, typeId,
    title: binding?.label ?? typeId,
    binding,
    element: undefined,
    minimumWidth: 100, maximumWidth: Infinity,
    minimumHeight: 100, maximumHeight: Infinity,
    create: () => {}, setBinding: async () => {}, layout: () => {},
    setVisible: () => {}, focus: () => {},
    saveState: () => state, restoreState: () => {},
    onDidChangeTitle: (() => ({ dispose: () => {} })) as never,
    onDidChangeConstraints: (() => ({ dispose: () => {} })) as never,
    onDidChangeVisibility: (() => ({ dispose: () => {} })) as never,
    dispose: () => {},
  };
}

const leaf = (viewId: string, size = 300) => ({
  type: SerializedNodeType.Leaf as const,
  viewId, size, sizingMode: SizingMode.Pixel,
});

const branch = (orientation: Orientation, children: ReturnType<typeof leaf>[] | unknown[]) => ({
  type: SerializedNodeType.Branch as const,
  orientation, size: 0, sizingMode: SizingMode.Pixel,
  children: children as never,
});

function gridOf(children: unknown[], orientation = Orientation.Horizontal): SerializedGrid {
  return {
    root: branch(orientation, children) as never,
    orientation, width: 1200, height: 800,
  };
}

const descriptorFor = (typeId: string): ISurfaceDescriptor => ({
  typeId, name: typeId, placement: SurfacePlacement.Center,
  constraints: { minimumWidth: 100, maximumWidth: Infinity, minimumHeight: 100, maximumHeight: Infinity },
  bindingKinds: ['file'],
  create: () => fakeSurface('x', typeId),
});

// ── Capture ─────────────────────────────────────────────────────────────────

describe('capturing an arrangement', () => {
  it('stores what each surface is POINTED AT, not just where it sits', () => {
    // The whole difference between a saved window position and a working
    // context. Without the binding, restoring "Study" gives you an empty
    // flashcards pane instead of the Exam 7 deck.
    const surfaces = new Map<string, ISurface>([
      ['v1', fakeSurface('v1', 'flashcards.study', { kind: 'deck', key: '7', label: 'Exam 7' })],
      ['v2', fakeSurface('v2', 'editor.pdf', { kind: 'file', key: '/taylor.pdf', label: 'Taylor' })],
    ]);
    const { arrangement } = captureArrangement(
      gridOf([leaf('v1', 400), leaf('v2', 800)]),
      { id: 'study', name: 'Study' },
      (id) => surfaces.get(id),
    );

    expect(arrangement.root.children).toHaveLength(2);
    const [a, b] = arrangement.root.children as { typeId: string; binding?: { key: string } }[];
    expect(a.typeId).toBe('flashcards.study');
    expect(a.binding?.key).toBe('7');
    expect(b.binding?.key).toBe('/taylor.pdf');
  });

  it('records sizes so a restore looks like what was saved', () => {
    const surfaces = new Map([['v1', fakeSurface('v1', 't')]]);
    const { arrangement } = captureArrangement(
      gridOf([leaf('v1', 437)]), { id: 'a', name: 'A' }, (id) => surfaces.get(id),
    );
    expect((arrangement.root.children[0] as { size: number }).size).toBe(437);
  });

  it('captures surface state', () => {
    const surfaces = new Map([['v1', fakeSurface('v1', 't', undefined, { scroll: 240 })]]);
    const { arrangement } = captureArrangement(
      gridOf([leaf('v1')]), { id: 'a', name: 'A' }, (id) => surfaces.get(id),
    );
    expect((arrangement.root.children[0] as { state: unknown }).state).toEqual({ scroll: 240 });
  });

  it('drops non-surface leaves, and says how many', () => {
    // A half-captured arrangement that restores into a tree with holes is
    // worse than one that restores a little smaller — but the loss is
    // reported, never silent.
    const surfaces = new Map([['v1', fakeSurface('v1', 't')]]);
    const { arrangement, capturedCount, droppedCount } = captureArrangement(
      gridOf([leaf('v1'), leaf('legacy-part'), leaf('another-part')]),
      { id: 'a', name: 'A' }, (id) => surfaces.get(id),
    );
    expect(capturedCount).toBe(1);
    expect(droppedCount).toBe(2);
    expect(arrangement.root.children).toHaveLength(1);
  });

  it('collapses a branch left holding one child', () => {
    // Same canonical-tree rule the grid keeps: a branch with one child is not
    // a split.
    const surfaces = new Map([['v1', fakeSurface('v1', 't')], ['v2', fakeSurface('v2', 't')]]);
    const { arrangement } = captureArrangement(
      gridOf([leaf('v1'), branch(Orientation.Vertical, [leaf('v2'), leaf('gone')])]),
      { id: 'a', name: 'A' }, (id) => surfaces.get(id),
    );
    expect(arrangement.root.children).toHaveLength(2);
    expect(arrangement.root.children.every((c) => c.type === 'leaf')).toBe(true);
  });

  it('yields an empty arrangement rather than throwing when nothing is a surface', () => {
    const { arrangement, capturedCount } = captureArrangement(
      gridOf([leaf('a'), leaf('b')]), { id: 'x', name: 'X' }, () => undefined,
    );
    expect(capturedCount).toBe(0);
    expect(arrangement.root.children).toHaveLength(0);
  });

  it('never stores instance ids — they do not survive a restart', () => {
    const surfaces = new Map([['v1', fakeSurface('instance-4821', 'editor.text')]]);
    const { arrangement } = captureArrangement(
      gridOf([leaf('v1')]), { id: 'a', name: 'A' }, (id) => surfaces.get(id),
    );
    expect(JSON.stringify(arrangement)).not.toContain('instance-4821');
    expect(JSON.stringify(arrangement)).not.toContain('v1');
  });
});

// ── Resolve ─────────────────────────────────────────────────────────────────

describe('resolving an arrangement', () => {
  const capture = (types: string[]): Arrangement => {
    const surfaces = new Map(types.map((t, i) => [
      `v${i}`, fakeSurface(`v${i}`, t, { kind: 'file', key: `/f${i}`, label: `File ${i}` }),
    ]));
    return captureArrangement(
      gridOf(types.map((_, i) => leaf(`v${i}`))),
      { id: 'a', name: 'A' },
      (id) => surfaces.get(id),
    ).arrangement;
  };

  it('marks every leaf resolvable when the types are registered', () => {
    const registered = new Map([['editor.text', descriptorFor('editor.text')]]);
    const resolved = resolveArrangement(capture(['editor.text', 'editor.text']),
      (t) => registered.get(t));
    expect(resolved.unavailable).toHaveLength(0);
    expect(resolved.root.children.every((c) => c.kind === 'surface')).toBe(true);
  });

  it('degrades a missing type to a named placeholder, keeping the rest', () => {
    // FOUNDATION.md open question 3. Losing an entire layout because one
    // extension was uninstalled is what stops people trusting saved layouts.
    const registered = new Map([['editor.text', descriptorFor('editor.text')]]);
    const resolved = resolveArrangement(capture(['editor.text', 'ext.gone']),
      (t) => registered.get(t));

    expect(resolved.unavailable).toHaveLength(1);
    expect(resolved.unavailable[0].typeId).toBe('ext.gone');
    // Named by what it pointed at, not by its type id — "File 1" tells you
    // what is missing better than "ext.gone" does.
    expect(resolved.unavailable[0].label).toBe('File 1');
    expect(resolved.root.children).toHaveLength(2);
    expect(resolved.root.children[0].kind).toBe('surface');
    expect(resolved.root.children[1].kind).toBe('placeholder');
  });

  it('instantiates nothing', () => {
    // Resolution has to be answerable BEFORE anything is torn down, so a
    // switch can report "3 of these will not open" while the current
    // arrangement is still on screen.
    let created = 0;
    const descriptor: ISurfaceDescriptor = {
      ...descriptorFor('editor.text'),
      create: () => { created++; return fakeSurface('x', 'editor.text'); },
    };
    resolveArrangement(capture(['editor.text', 'editor.text']), () => descriptor);
    expect(created).toBe(0);
  });

  it('carries binding and state through to the plan', () => {
    const registered = new Map([['editor.text', descriptorFor('editor.text')]]);
    const resolved = resolveArrangement(capture(['editor.text']), (t) => registered.get(t));
    const first = resolved.root.children[0] as { binding?: { key: string }; descriptor?: unknown };
    expect(first.binding?.key).toBe('/f0');
    expect(first.descriptor).toBeDefined();
  });

  it('preserves nesting', () => {
    const surfaces = new Map([
      ['v1', fakeSurface('v1', 't')], ['v2', fakeSurface('v2', 't')], ['v3', fakeSurface('v3', 't')],
    ]);
    const { arrangement } = captureArrangement(
      gridOf([leaf('v1'), branch(Orientation.Vertical, [leaf('v2'), leaf('v3')])]),
      { id: 'a', name: 'A' }, (id) => surfaces.get(id),
    );
    const resolved = resolveArrangement(arrangement, () => descriptorFor('t'));
    expect(resolved.root.children).toHaveLength(2);
    expect(resolved.root.children[1].kind).toBe('branch');
  });
});

// ── Parsing untrusted input ─────────────────────────────────────────────────

describe('parsing an arrangement', () => {
  const valid = (): unknown => JSON.parse(JSON.stringify(captureArrangement(
    gridOf([leaf('v1'), leaf('v2')]),
    { id: 'study', name: 'Study', icon: 'book' },
    (id) => fakeSurface(id, 'editor.text', { kind: 'file', key: `/${id}`, label: id }),
  ).arrangement));

  it('round-trips a captured arrangement through JSON', () => {
    const parsed = parseArrangement(valid());
    expect(parsed?.id).toBe('study');
    expect(parsed?.name).toBe('Study');
    expect(parsed?.icon).toBe('book');
    expect(parsed?.root.children).toHaveLength(2);
  });

  it('rejects junk without throwing', () => {
    // Arrangements are shareable, so this parses untrusted JSON. A layout that
    // will not load must cost you that layout, never the app's startup.
    for (const junk of [null, undefined, 42, 'nope', {}, { id: 'a' }, []]) {
      expect(parseArrangement(junk)).toBeUndefined();
    }
  });

  it('rejects a version from the future', () => {
    const a = valid() as Record<string, unknown>;
    a['version'] = ARRANGEMENT_VERSION + 1;
    expect(parseArrangement(a)).toBeUndefined();
  });

  it('drops malformed leaves rather than failing the whole layout', () => {
    const a = valid() as { root: { children: unknown[] } };
    a.root.children.push({ type: 'leaf', size: 100 });     // no typeId
    a.root.children.push({ type: 'nonsense' });
    const parsed = parseArrangement(a);
    expect(parsed?.root.children).toHaveLength(2);
  });

  it('defaults a binding label to its key when the label is missing', () => {
    const a = valid() as { root: { children: Record<string, unknown>[] } };
    delete (a.root.children[0]['binding'] as Record<string, unknown>)['label'];
    const parsed = parseArrangement(a);
    const b = (parsed?.root.children[0] as { binding?: { label: string } }).binding;
    expect(b?.label).toBe('/v1');
  });

  it('rejects a binding with no key', () => {
    const a = valid() as { root: { children: Record<string, unknown>[] } };
    a.root.children[0]['binding'] = { kind: 'file' };
    const parsed = parseArrangement(a);
    expect((parsed?.root.children[0] as { binding?: unknown }).binding).toBeUndefined();
  });
});

// ── Requirements ────────────────────────────────────────────────────────────

describe('requiredTypeIds', () => {
  it('lists every type an arrangement needs, deduplicated', () => {
    // Drives "this arrangement needs extension X" before a shared layout is
    // adopted, rather than after it half-opens.
    const surfaces = new Map([
      ['v1', fakeSurface('v1', 'editor.text')],
      ['v2', fakeSurface('v2', 'flashcards.study')],
      ['v3', fakeSurface('v3', 'editor.text')],
    ]);
    const { arrangement } = captureArrangement(
      gridOf([leaf('v1'), branch(Orientation.Vertical, [leaf('v2'), leaf('v3')])]),
      { id: 'a', name: 'A' }, (id) => surfaces.get(id),
    );
    expect([...requiredTypeIds(arrangement)].sort())
      .toEqual(['editor.text', 'flashcards.study']);
  });
});

// ── Hostile and degenerate inputs ───────────────────────────────────────────

describe('what an untrusted file cannot do', () => {
  it('absorbs a nesting bomb as malformed rather than overflowing the stack', () => {
    // JSON.parse handles tens of thousands of nesting levels; a recursive
    // walker does not. A hostile shared arrangement must cost the layout,
    // never a RangeError in the startup path.
    let node: Record<string, unknown> = {
      type: 'leaf', typeId: 'x', size: 100, sizingMode: SizingMode.Pixel,
    };
    for (let i = 0; i < 5000; i++) {
      node = {
        type: 'branch', orientation: Orientation.Horizontal,
        size: 0, sizingMode: SizingMode.Pixel, children: [node],
      };
    }
    const raw = {
      version: 1, id: 'bomb', name: 'Bomb',
      rootOrientation: Orientation.Horizontal, root: node,
    };

    let parsed: unknown = 'unset';
    expect(() => { parsed = parseArrangement(raw); }).not.toThrow();
    expect(parsed).toBeUndefined();
  });

  it('clamps absurd sizes instead of storing them', () => {
    const raw = {
      version: 1, id: 'n', name: 'N', rootOrientation: Orientation.Horizontal,
      root: {
        type: 'branch', orientation: Orientation.Horizontal, size: -5, sizingMode: SizingMode.Pixel,
        children: [
          { type: 'leaf', typeId: 'x', size: Number.POSITIVE_INFINITY, sizingMode: SizingMode.Pixel },
          { type: 'leaf', typeId: 'y', size: -200, sizingMode: SizingMode.Pixel },
        ],
      },
    };
    const parsed = parseArrangement(raw);
    expect(parsed).toBeDefined();
    expect(parsed!.root.size).toBe(0);
    expect((parsed!.root.children[0] as { size: number }).size).toBe(0);
    expect((parsed!.root.children[1] as { size: number }).size).toBe(0);
  });

  it('round-trips an empty capture', () => {
    // Capturing an empty grid is legal, so its file must parse back — an
    // asymmetry here means the one arrangement the app itself wrote refuses
    // to load.
    const { arrangement } = captureArrangement(gridOf([]), { id: 'e', name: 'Empty' }, () => undefined);
    const parsed = parseArrangement(JSON.parse(JSON.stringify(arrangement)));
    expect(parsed).toBeDefined();
    expect(parsed!.root.children).toHaveLength(0);
  });
});

// ── Capture fidelity under mutation and collapse ────────────────────────────

describe('capture fidelity', () => {
  it('captures state as a snapshot, not a live reference', () => {
    const state: Record<string, unknown> = { page: 1 };
    const { arrangement } = captureArrangement(
      gridOf([leaf('v1')]),
      { id: 's', name: 'S' },
      () => fakeSurface('v1', 'editor.text', undefined, state),
    );
    state.page = 99;
    const stored = (arrangement.root.children[0] as { state?: Record<string, unknown> }).state;
    expect(stored).toEqual({ page: 1 });
  });

  it('a collapsed one-child branch keeps the branch slot size, not the child measure', () => {
    // The child's size runs along the collapsing branch's axis; the slot it
    // is promoted into runs along the parent's. 300 vertical pixels are not
    // 300 horizontal ones.
    const grid = gridOf([
      {
        type: SerializedNodeType.Branch, orientation: Orientation.Vertical,
        size: 420, sizingMode: SizingMode.Pixel,
        children: [leaf('a', 300)],
      },
      leaf('b', 780),
    ]);
    const { arrangement } = captureArrangement(
      grid, { id: 'c', name: 'C' },
      (id) => fakeSurface(id, 'editor.text'),
    );
    const first = arrangement.root.children[0] as { type: string; size: number };
    expect(first.type).toBe('leaf');
    expect(first.size).toBe(420);
  });

  it('keeps a placeholder leaf state through resolution', () => {
    // A missing extension freezes the pane; it must not also wipe it. The
    // state rides through resolve so a re-save after restore loses nothing.
    const arrangement: Arrangement = {
      version: ARRANGEMENT_VERSION, id: 'p', name: 'P',
      rootOrientation: Orientation.Horizontal,
      root: {
        type: 'branch', orientation: Orientation.Horizontal, size: 0, sizingMode: SizingMode.Pixel,
        children: [{
          type: 'leaf', size: 300, sizingMode: SizingMode.Pixel,
          typeId: 'gone.type', state: { queue: [1, 2] },
        }],
      },
    };
    const resolved = resolveArrangement(arrangement, () => undefined);
    const ph = resolved.root.children[0] as { kind: string; state?: Record<string, unknown> };
    expect(ph.kind).toBe('placeholder');
    expect(ph.state).toEqual({ queue: [1, 2] });
  });
});
