/**
 * Foundation step 2 — the one citizen.
 *
 * These tests pin the contract the whole layout foundation rests on: a
 * surface is identified by type + binding, instances are reused rather than
 * duplicated, and NOTHING here knows or can express where a surface lives.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { SurfaceRegistry } from '../../src/surfaces/surfaceRegistry';
import { SurfaceGridView } from '../../src/surfaces/surfaceGridView';
import {
  SurfacePlacement,
  bindingsEqual,
  bindingId,
  type ISurface,
  type ISurfaceBinding,
  type ISurfaceDescriptor,
  type SurfaceState,
} from '../../src/surfaces/surfaceTypes';
import { Emitter } from '../../src/platform/events';
import { Orientation, DEFAULT_SIZE_CONSTRAINTS } from '../../src/layout/layoutTypes';

// ── A minimal surface that records what was done to it ──────────────────────

class FakeSurface implements ISurface {
  readonly icon = 'file';
  binding: ISurfaceBinding | undefined;
  element: HTMLElement | undefined;

  minimumWidth = 100;
  maximumWidth = Infinity;
  minimumHeight = 80;
  maximumHeight = Infinity;

  created = 0;
  disposed = false;
  visible: boolean | undefined;
  lastLayout: { w: number; h: number } | undefined;
  /** Records anything the surface was told about its position. Must stay 0. */
  positionalCalls = 0;

  private readonly _title = new Emitter<void>();
  readonly onDidChangeTitle = this._title.event;
  private readonly _constraints = new Emitter<void>();
  readonly onDidChangeConstraints = this._constraints.event;
  private readonly _visibility = new Emitter<boolean>();
  readonly onDidChangeVisibility = this._visibility.event;

  constructor(readonly id: string, readonly typeId: string) {}

  get title(): string { return this.binding?.label ?? this.typeId; }

  create(container: HTMLElement): void {
    this.created++;
    this.element = document.createElement('div');
    container.appendChild(this.element);
  }

  async setBinding(binding: ISurfaceBinding | undefined): Promise<void> {
    this.binding = binding;
    this._title.fire();
  }

  layout(w: number, h: number): void { this.lastLayout = { w, h }; }
  setVisible(v: boolean): void { this.visible = v; this._visibility.fire(v); }
  focus(): void {}
  saveState(): SurfaceState { return { seen: true }; }
  restoreState(): void {}

  widen(): void { this.minimumWidth = 400; this._constraints.fire(); }

  dispose(): void {
    this.disposed = true;
    this._title.dispose();
    this._constraints.dispose();
    this._visibility.dispose();
  }
}

function descriptorFor(
  typeId: string,
  extra: Partial<ISurfaceDescriptor> = {},
): ISurfaceDescriptor {
  return {
    typeId,
    name: typeId,
    placement: SurfacePlacement.Center,
    constraints: DEFAULT_SIZE_CONSTRAINTS,
    bindingKinds: ['file'],
    create: (instanceId: string) => new FakeSurface(instanceId, typeId),
    ...extra,
  };
}

const fileBinding = (path: string): ISurfaceBinding => ({
  kind: 'file', key: path, label: path.split('/').pop() ?? path,
});

// ── Bindings ────────────────────────────────────────────────────────────────

describe('surface bindings', () => {
  it('compares on kind and key, not on label', () => {
    // The label is display text and can differ for the same thing (a renamed
    // tab, a shortened path). Identity is kind + key or reuse breaks.
    expect(bindingsEqual(
      { kind: 'file', key: '/a.md', label: 'a.md' },
      { kind: 'file', key: '/a.md', label: 'Something Else' },
    )).toBe(true);
  });

  it('separates the same key in different kinds', () => {
    expect(bindingsEqual(
      { kind: 'file', key: '1', label: 'x' },
      { kind: 'deck', key: '1', label: 'x' },
    )).toBe(false);
  });

  it('treats undefined as its own identity', () => {
    expect(bindingsEqual(undefined, undefined)).toBe(true);
    expect(bindingsEqual(undefined, fileBinding('/a'))).toBe(false);
  });

  it('produces a stable id for persistence', () => {
    expect(bindingId(fileBinding('/a/b.md'))).toBe('file:/a/b.md');
    expect(bindingId(undefined)).toBe('');
  });
});

// ── Registration ────────────────────────────────────────────────────────────

describe('surface registration', () => {
  let registry: SurfaceRegistry;
  beforeEach(() => { registry = new SurfaceRegistry(); });

  it('registers and looks up a descriptor', () => {
    registry.register(descriptorFor('canvas.page'));
    expect(registry.getDescriptor('canvas.page')?.name).toBe('canvas.page');
    expect(registry.descriptors).toHaveLength(1);
  });

  it('refuses a duplicate type id', () => {
    registry.register(descriptorFor('canvas.page'));
    expect(() => registry.register(descriptorFor('canvas.page'))).toThrow();
  });

  it('unregisters and disposes the instances that came from it', () => {
    // An extension unloading must not leave panes behind that nothing can
    // rebuild or serialise.
    const reg = registry.register(descriptorFor('canvas.page'));
    const inst = registry.createInstance('canvas.page', fileBinding('/a.md'));
    reg.dispose();
    expect((inst.surface as FakeSurface).disposed).toBe(true);
    expect(registry.getDescriptor('canvas.page')).toBeUndefined();
    expect(registry.instances).toHaveLength(0);
  });

  it('finds the types that can open a kind of thing', () => {
    registry.register(descriptorFor('canvas.page', { bindingKinds: ['page'] }));
    registry.register(descriptorFor('editor.text', { bindingKinds: ['file'] }));
    registry.register(descriptorFor('viewer.any', { bindingKinds: ['file', 'page'] }));
    expect(registry.descriptorsForBindingKind('file').map((d) => d.typeId).sort())
      .toEqual(['editor.text', 'viewer.any']);
  });
});

// ── Instances ───────────────────────────────────────────────────────────────

describe('surface instances', () => {
  let registry: SurfaceRegistry;
  beforeEach(() => {
    registry = new SurfaceRegistry();
    registry.register(descriptorFor('editor.text'));
  });

  it('reuses the instance for an identical binding', () => {
    // A second click on the same file focuses what is open; it does not open
    // a second copy.
    const a = registry.createInstance('editor.text', fileBinding('/a.md'));
    void a.surface.setBinding(fileBinding('/a.md'));
    const b = registry.createInstance('editor.text', fileBinding('/a.md'));
    expect(b).toBe(a);
    expect(registry.instances).toHaveLength(1);
  });

  it('creates a separate instance per distinct binding', () => {
    const a = registry.createInstance('editor.text', fileBinding('/a.md'));
    void a.surface.setBinding(fileBinding('/a.md'));
    const b = registry.createInstance('editor.text', fileBinding('/b.md'));
    expect(b).not.toBe(a);
    expect(registry.instances).toHaveLength(2);
  });

  it('opens a second view of the same thing on forceNew', () => {
    // Side-by-side comparison of one document. Obsidian's model.
    const a = registry.createInstance('editor.text', fileBinding('/a.md'));
    void a.surface.setBinding(fileBinding('/a.md'));
    const b = registry.createInstance('editor.text', fileBinding('/a.md'), { forceNew: true });
    expect(b).not.toBe(a);
    expect(a.surface.id).not.toBe(b.surface.id);
  });

  it('keeps a single-instance type to one, whatever the binding', () => {
    registry.register(descriptorFor('settings.hub', {
      instances: 'single', bindingKinds: [],
    }));
    const a = registry.createInstance('settings.hub');
    const b = registry.createInstance('settings.hub', fileBinding('/unrelated'));
    expect(b).toBe(a);
  });

  it('throws for an unregistered type', () => {
    expect(() => registry.createInstance('nope')).toThrow();
  });

  it('announces a disposal BEFORE tearing the surface down', () => {
    // The tree has to detach a LIVE surface; a disposed one can no longer be
    // found or removed cleanly.
    const inst = registry.createInstance('editor.text', fileBinding('/a.md'));
    let disposedAtEvent: boolean | undefined;
    registry.onDidDisposeInstance(() => {
      disposedAtEvent = (inst.surface as FakeSurface).disposed;
    });
    registry.disposeInstance(inst.surface.id);
    expect(disposedAtEvent).toBe(false);
    expect((inst.surface as FakeSurface).disposed).toBe(true);
  });
});

// ── The invariant ───────────────────────────────────────────────────────────

describe('a surface cannot learn where it lives', () => {
  it('is never handed an orientation', () => {
    // THE invariant (Decision 2). The grid passes an orientation to every
    // IGridView; the wrapper drops it. A surface that could read it could
    // infer its position, and the first `if (orientation === ...)` inside a
    // surface is the day drag-anywhere starts needing special cases.
    const surface = new FakeSurface('s1', 'editor.text');
    const view = new SurfaceGridView(surface);

    view.layout(500, 400, Orientation.Vertical);
    view.layout(500, 400, Orientation.Horizontal);

    expect(surface.positionalCalls).toBe(0);
    expect(surface.lastLayout).toEqual({ w: 500, h: 400 });
  });

  it('exposes no region, container or placement on the live surface', () => {
    // Placement lives on the DESCRIPTOR as an advisory default, never on the
    // instance — an extension must not be able to pin itself anywhere.
    const surface = new FakeSurface('s1', 'editor.text');
    for (const banned of ['placement', 'region', 'container', 'containerId', 'position', 'side']) {
      expect(banned in surface).toBe(false);
    }
  });

  it('builds its DOM lazily, on first layout', () => {
    // A surface restored into a collapsed region should not pay for DOM it is
    // not going to show.
    const surface = new FakeSurface('s1', 'editor.text');
    const view = new SurfaceGridView(surface);
    expect(surface.created).toBe(0);
    view.layout(300, 300, Orientation.Horizontal);
    expect(surface.created).toBe(1);
    view.layout(400, 300, Orientation.Horizontal);
    expect(surface.created).toBe(1);
  });

  it('hides rather than disposes', () => {
    // The retention contract: a hidden surface keeps running.
    const surface = new FakeSurface('s1', 'editor.text');
    const view = new SurfaceGridView(surface);
    view.setVisible(false);
    expect(surface.visible).toBe(false);
    expect(surface.disposed).toBe(false);
  });

  it('does NOT dispose the surface when the wrapper is disposed', () => {
    // A move detaches and re-attaches the wrapper. Disposing the surface here
    // would destroy exactly what the move exists to preserve.
    const surface = new FakeSurface('s1', 'editor.text');
    const view = new SurfaceGridView(surface);
    view.dispose();
    expect(surface.disposed).toBe(false);
  });

  it('relays constraint changes so the grid can revalidate', () => {
    const surface = new FakeSurface('s1', 'editor.text');
    const view = new SurfaceGridView(surface);
    let fired = 0;
    view.onDidChangeConstraints(() => fired++);
    surface.widen();
    expect(fired).toBe(1);
    expect(view.minimumWidth).toBe(400);
  });

  it('serialises type, binding and state — enough to restore it anywhere', () => {
    const surface = new FakeSurface('s1', 'editor.text');
    void surface.setBinding(fileBinding('/a/b.md'));
    const json = new SurfaceGridView(surface).toJSON() as Record<string, unknown>;
    expect(json).toMatchObject({
      id: 's1',
      typeId: 'editor.text',
      binding: { kind: 'file', key: '/a/b.md' },
      state: { seen: true },
    });
    // Deliberately absent: anything about position. An arrangement owns that.
    expect(json['placement']).toBeUndefined();
    expect(json['region']).toBeUndefined();
  });
});

// ── Source-level canary ─────────────────────────────────────────────────────

describe('the invariant is guarded in source, not just in review', () => {
  it('no surface implementation branches on its position', async () => {
    // The foundation's single load-bearing rule is that a surface does not
    // know where it lives. It will be violated by someone (probably me) taking
    // the short path on a drag-to-edge bug, and it will not show up as a test
    // failure anywhere else — the app will simply stop being rearrangeable.
    //
    // Scans the surfaces layer for the shapes that violation takes. This is
    // the same enforcement the chat gate and motion tokens already use.
    const { readdirSync, readFileSync } = await import('fs');
    const { resolve, join } = await import('path');

    const dir = resolve(__dirname, '../../src/surfaces');
    const banned: { pattern: RegExp; why: string }[] = [
      { pattern: /\bthis\.(placement|region|container|side|position)\b/, why: 'reads its own position' },
      { pattern: /orientation\s*===\s*Orientation\./, why: 'branches on grid orientation' },
      { pattern: /isInSidebar|isInPanel|isInEditor|inSidebar\b/, why: 'asks which region it is in' },
    ];

    // The activity tap NARRATES positions — "moved left of X" is its whole
    // job. It is not a surface and renders nothing; the invariant binds the
    // things that live in the tree, not the voice describing the tree.
    const exempt = new Set(['surfaceActivity.ts']);

    const offences: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !exempt.has(f))) {
      const src = readFileSync(join(dir, file), 'utf8');
      for (const line of src.split('\n')) {
        // Comments explain the rule; they must not trip it.
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        for (const { pattern, why } of banned) {
          if (pattern.test(code)) offences.push(`${file}: ${why} — ${line.trim()}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});

// ── Binding-in-flight identity and adopted instances ────────────────────────

import { PlaceholderSurface, PLACEHOLDER_DESCRIPTOR } from '../../src/surfaces/surfacePlaceholder';

describe('identity while a binding is still loading', () => {
  let registry: SurfaceRegistry;

  beforeEach(() => {
    registry = new SurfaceRegistry();
    registry.register(descriptorFor('editor.text'));
  });

  it('reuses on an identical binding even before the surface has applied it', () => {
    // setBinding is async, and a surface may set its live binding after an
    // await. The registry cannot need the surface's cooperation to keep
    // "a second open focuses, it does not duplicate" true — a rapid double
    // open lands exactly in that window.
    const a = registry.createInstance('editor.text', fileBinding('/a.md'));
    const b = registry.createInstance('editor.text', fileBinding('/a.md'));
    expect(b).toBe(a);
    expect(registry.instances).toHaveLength(1);
  });

  it('does not hand a bound instance to a deliberately unbound open', () => {
    registry.createInstance('editor.text', fileBinding('/a.md'));
    const b = registry.createInstance('editor.text');
    expect(registry.instances).toHaveLength(2);
    expect(b.requestedBinding).toBeUndefined();
  });

  it('ignores forceNew on a single-instance type', () => {
    // "Another view of this" is exactly what a single declaration says is
    // meaningless; honouring the flag would strand a duplicate no lookup
    // could ever return.
    registry.register(descriptorFor('settings.hub', { instances: 'single', bindingKinds: [] }));
    const a = registry.createInstance('settings.hub');
    const b = registry.createInstance('settings.hub', undefined, { forceNew: true });
    expect(b).toBe(a);
    expect(registry.instances.filter((i) => i.descriptor.typeId === 'settings.hub')).toHaveLength(1);
  });
});

describe('adopted instances', () => {
  it('gives an adopted surface the registry lifetime: one dispose, one event', () => {
    const registry = new SurfaceRegistry();
    const ph = new PlaceholderSurface('placeholder#t1', 'gone.type', undefined, { kept: true });
    registry.adoptInstance(ph, PLACEHOLDER_DESCRIPTOR);

    const disposed: string[] = [];
    registry.onDidDisposeInstance((id) => disposed.push(id));
    registry.disposeInstance('placeholder#t1');

    expect(disposed).toEqual(['placeholder#t1']);
    expect(registry.getInstance('placeholder#t1')).toBeUndefined();
  });

  it('refuses to adopt the same id twice', () => {
    const registry = new SurfaceRegistry();
    const ph = new PlaceholderSurface('placeholder#t2', 'gone.type', undefined, undefined);
    registry.adoptInstance(ph, PLACEHOLDER_DESCRIPTOR);
    expect(() => registry.adoptInstance(ph, PLACEHOLDER_DESCRIPTOR)).toThrow();
  });

  it('keeps the missing type unregistered, so resolution keeps reporting it', () => {
    // If adoption registered anything, resolveArrangement would start
    // "resolving" the missing type into more placeholders and the user would
    // never hear that the extension is gone.
    const registry = new SurfaceRegistry();
    const ph = new PlaceholderSurface('placeholder#t3', 'gone.type', undefined, undefined);
    registry.adoptInstance(ph, PLACEHOLDER_DESCRIPTOR);
    expect(registry.getDescriptor('gone.type')).toBeUndefined();
    expect(registry.getDescriptor('surface.placeholder')).toBeUndefined();
  });

  it('a placeholder reports the missing type and hands back its frozen state', () => {
    const ph = new PlaceholderSurface(
      'placeholder#t4', 'flashcards.study',
      { kind: 'deck', key: 'exam7', label: 'Exam 7' },
      { queue: [3, 1] },
    );
    expect(ph.typeId).toBe('flashcards.study');
    expect(ph.title).toBe('Exam 7');
    expect(ph.saveState()).toEqual({ queue: [3, 1] });
  });
});
