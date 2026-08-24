/**
 * Foundation step 2 — the adapters.
 *
 * EditorPaneSurface sits between two lifecycles that do not line up on their
 * own: a surface binds whenever the tree says so, but a pane can only render
 * once its DOM exists, and inputs are session objects standing in for
 * persistent identity. These tests pin the seams: binding keys that survive a
 * restart, input application deferred until create, tab titles that follow
 * renames, and inputs that do not leak.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EditorPaneSurface,
  editorInputToBinding,
  type IEditorBindingBridge,
} from '../../src/surfaces/surfaceAdapters';
import type { IEditorPane } from '../../src/editor/editorPane';
import type { IEditorInput } from '../../src/editor/editorInput';
import type { ISurfaceBinding } from '../../src/surfaces/surfaceTypes';
import { URI } from '../../src/platform/uri';
import { Emitter } from '../../src/platform/events';

// ── Fixtures ────────────────────────────────────────────────────────────────

function fakeInput(opts: {
  id?: string;
  typeId?: string;
  uri?: URI;
  name?: string;
  serialized?: Record<string, unknown>;
}): IEditorInput & { disposed: boolean; fireLabel(): void } {
  const label = new Emitter<void>();
  const dirty = new Emitter<boolean>();
  const willDispose = new Emitter<void>();
  const input = {
    id: opts.id ?? 'input-1',
    typeId: opts.typeId ?? 'text',
    uri: opts.uri,
    name: opts.name ?? 'a.md',
    description: '',
    isDirty: false,
    disposed: false,
    onDidChangeDirty: dirty.event,
    onDidChangeLabel: label.event,
    onWillDispose: willDispose.event,
    matches: (other: IEditorInput) => other.id === input.id,
    confirmClose: async () => true,
    serialize: () => (opts.serialized ?? { typeId: opts.typeId ?? 'text', data: {} }) as never,
    fireLabel: () => label.fire(),
    dispose: () => { input.disposed = true; },
  };
  return input as never;
}

function fakePane(): IEditorPane & { created: boolean; inputs: IEditorInput[] } {
  const viewState = new Emitter<void>();
  const pane = {
    id: 'pane-1',
    element: undefined as HTMLElement | undefined,
    input: undefined as IEditorInput | undefined,
    created: false,
    inputs: [] as IEditorInput[],
    create: (container: HTMLElement) => {
      pane.element = document.createElement('div');
      container.appendChild(pane.element);
      pane.created = true;
    },
    setInput: async (input: IEditorInput) => {
      if (!pane.created) throw new Error('setInput before create renders nothing');
      pane.input = input;
      pane.inputs.push(input);
    },
    clearInput: () => { pane.input = undefined; },
    layout: () => {},
    focus: () => {},
    saveViewState: () => ({}),
    restoreViewState: () => {},
    onDidChangeViewState: viewState.event,
    dispose: () => viewState.dispose(),
  };
  return pane as never;
}

const bridgeFor = (make: (b: ISurfaceBinding) => IEditorInput | undefined): IEditorBindingBridge => ({
  toBinding: editorInputToBinding,
  fromBinding: make,
});

// ── editorInputToBinding ────────────────────────────────────────────────────

describe('editorInputToBinding', () => {
  it('keys a file input by its uri under the file kind', () => {
    const b = editorInputToBinding(fakeInput({ uri: URI.file('/x/a.md'), name: 'a.md' }));
    expect(b.kind).toBe('file');
    expect(b.key).toContain('a.md');
  });

  it('uses the uri scheme as the kind, so untitled buffers do not claim to be files', () => {
    const untitled = URI.from({ scheme: 'untitled', path: '/one' });
    const b = editorInputToBinding(fakeInput({ uri: untitled }));
    expect(b.kind).toBe('untitled');
  });

  it('keys a uri-less input by its serialized form, which survives a restart', () => {
    // The instance id is a session counter — an arrangement persisted with
    // one could never resolve after a restart. serialize() is the identity
    // the editor-restore path already round-trips.
    const a = editorInputToBinding(fakeInput({
      typeId: 'welcome', id: 'input-7', serialized: { typeId: 'welcome', data: { page: 'home' } },
    }));
    const b = editorInputToBinding(fakeInput({
      typeId: 'welcome', id: 'input-99', serialized: { typeId: 'welcome', data: { page: 'home' } },
    }));
    expect(a.kind).toBe('welcome');
    expect(a.key).toBe(b.key);
    expect(a.key).not.toContain('input-7');
  });
});

// ── EditorPaneSurface lifecycle ─────────────────────────────────────────────

describe('EditorPaneSurface', () => {
  const binding: ISurfaceBinding = { kind: 'file', key: 'file:///a.md', label: 'a.md' };

  it('defers the input until create, then applies it', async () => {
    // The tree binds on open; the grid creates DOM lazily on first layout.
    // An input pushed into a pane with no DOM renders a blank editor.
    const pane = fakePane();
    const input = fakeInput({ uri: URI.file('/a.md') });
    const surface = new EditorPaneSurface('s1', 'editor.text', pane, bridgeFor(() => input));

    await surface.setBinding(binding);
    expect(pane.inputs).toHaveLength(0);

    const host = document.createElement('div');
    surface.create(host);
    await Promise.resolve();
    expect(pane.inputs).toEqual([input]);
    expect(pane.input).toBe(input);
  });

  it('applies the binding immediately once created', async () => {
    const pane = fakePane();
    const input = fakeInput({ uri: URI.file('/a.md') });
    const surface = new EditorPaneSurface('s2', 'editor.text', pane, bridgeFor(() => input));

    surface.create(document.createElement('div'));
    await surface.setBinding(binding);
    expect(pane.input).toBe(input);
  });

  it('repaints the tab when the input label changes', async () => {
    const pane = fakePane();
    const input = fakeInput({ uri: URI.file('/a.md'), name: 'a.md' });
    const surface = new EditorPaneSurface('s3', 'editor.text', pane, bridgeFor(() => input));
    surface.create(document.createElement('div'));
    await surface.setBinding(binding);

    const repaints = vi.fn();
    surface.onDidChangeTitle(repaints);
    input.fireLabel();
    expect(repaints).toHaveBeenCalledTimes(1);
  });

  it('disposes a replaced input, and the last one on its own dispose', async () => {
    const pane = fakePane();
    const first = fakeInput({ uri: URI.file('/a.md') });
    const second = fakeInput({ uri: URI.file('/b.md') });
    let next = first as IEditorInput;
    const surface = new EditorPaneSurface('s4', 'editor.text', pane, bridgeFor(() => next));
    surface.create(document.createElement('div'));

    await surface.setBinding(binding);
    next = second;
    await surface.setBinding({ kind: 'file', key: 'file:///b.md', label: 'b.md' });

    // The bridge built these for this adapter alone; nothing else is left to
    // dispose a replaced one.
    expect(first.disposed).toBe(true);
    expect(second.disposed).toBe(false);

    surface.dispose();
    expect(second.disposed).toBe(true);
  });

  it('throws on an unresolvable binding and leaves the pane as it was', async () => {
    const pane = fakePane();
    const input = fakeInput({ uri: URI.file('/a.md') });
    let resolvable = true;
    const surface = new EditorPaneSurface(
      's5', 'editor.text', pane,
      bridgeFor(() => (resolvable ? input : undefined)),
    );
    surface.create(document.createElement('div'));
    await surface.setBinding(binding);

    resolvable = false;
    await expect(surface.setBinding({ kind: 'file', key: 'file:///gone.md', label: 'gone.md' }))
      .rejects.toThrow();
    // A working editor is not blanked over a binding that failed to resolve.
    expect(pane.input).toBe(input);
    expect(surface.binding?.key).toContain('a.md');
  });
});
