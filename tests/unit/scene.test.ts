// @vitest-environment jsdom
// scene.test.ts — the scene holds what is mounted, finds parents from the
// DOM, adds late-connected elements when they connect, and drops removed
// ones without anyone calling dispose. docs/SELF_DESCRIBING_UI_DESIGN.md
// section 4.

import { describe, it, expect, beforeEach } from 'vitest';
import { scene, type ISceneEntry } from '../../src/ui/scene.js';

const settle = () => new Promise<void>((r) => setTimeout(r, 60));

/** A surface element, appended to `parent` (the body by default; null for detached) before it registers. */
function surface(id: string, opts: Partial<ISceneEntry> = {}, parent: HTMLElement | null = document.body): { el: HTMLElement; dispose: () => void } {
  const el = document.createElement('div');
  if (parent) parent.appendChild(el);
  const reg = scene.register({ id, kind: 'surface', owner: 'core', label: id, element: el, ...opts });
  return { el, dispose: () => reg.dispose() };
}

function button(id: string, parent: HTMLElement, opts: Partial<ISceneEntry> = {}): { el: HTMLButtonElement; dispose: () => void } {
  const el = document.createElement('button');
  parent.appendChild(el);
  const reg = scene.register({ id, kind: 'button', owner: '', label: id, element: el, ...opts });
  return { el, dispose: () => reg.dispose() };
}

beforeEach(() => {
  document.body.innerHTML = '';
  scene.reset();
});

describe('scene', () => {
  it('registers a connected surface and a control under it, parent found from the DOM', () => {
    const s = surface('sidebar');
    const b = button('workbench.action.toggleSidebar', s.el);
    expect(scene.find('workbench.action.toggleSidebar')).toHaveLength(1);
    expect(scene.under(scene.find('sidebar')[0]).map((e) => e.id)).toEqual(['workbench.action.toggleSidebar']);
    expect(b.el.getAttribute('data-px-id')).toBe('workbench.action.toggleSidebar');
    expect(s.el.getAttribute('data-px-surface')).toBe('sidebar');
  });

  it('holds an entry registered before its element connects, and adds it on connection', async () => {
    const s = surface('panel', {}, null);
    const b = button('panel.clear', s.el);
    expect(scene.find('panel')).toHaveLength(0);
    expect(scene.find('panel.clear')).toHaveLength(0);
    document.body.appendChild(s.el);
    await settle();
    expect(scene.find('panel')).toHaveLength(1);
    expect(scene.find('panel.clear')).toHaveLength(1);
    expect(scene.under(scene.find('panel')[0]).map((e) => e.id)).toEqual(['panel.clear']);
    b.dispose();
    expect(scene.find('panel.clear')).toHaveLength(0);
  });

  it('drops an entry whose element leaves the document, without dispose', async () => {
    const s = surface('statusbar');
    button('statusbar.zoom', s.el);
    await settle();
    expect(scene.find('statusbar.zoom')).toHaveLength(1);
    s.el.remove();
    await settle();
    expect(scene.find('statusbar')).toHaveLength(0);
    expect(scene.find('statusbar.zoom')).toHaveLength(0);
  });

  it('refuses a duplicate id under one parent and instance, and allows it across instances', () => {
    const a = surface('worksheet', { owner: 'worksheet', instance: '1' });
    const b = surface('worksheet', { owner: 'worksheet', instance: '2' });
    button('worksheet.sheetTheme', a.el);
    button('worksheet.sheetTheme', b.el);
    expect(scene.find('worksheet.sheetTheme')).toHaveLength(2);
    const dupEl = document.createElement('button');
    a.el.appendChild(dupEl);
    expect(() => scene.register({ id: 'worksheet.sheetTheme', kind: 'button', owner: '', label: 'x', element: dupEl })).toThrow(/registered twice/);
    expect(scene.find('worksheet.sheetTheme')).toHaveLength(2);
  });

  it('throws on a missing id or label in development', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    expect(() => scene.register({ id: '', kind: 'button', owner: '', label: 'x', element: el })).toThrow(/needs an id and a label/);
    expect(() => scene.register({ id: 'x', kind: 'button', owner: '', label: '', element: el })).toThrow(/needs an id and a label/);
  });

  it('describes the tree as data: owner inherited, state read live, instance kept', () => {
    const pane = surface('planner', { owner: 'planner', instance: 'p1', label: 'Planner' });
    let pressed = false;
    button('planner.addTask', pane.el, { label: 'Add Task', command: 'planner.addTask', state: () => ({ kind: 'pressed', value: pressed }) });
    const before = scene.describe();
    expect(before.surfaces).toHaveLength(1);
    const node = before.surfaces[0];
    expect(node).toMatchObject({ id: 'planner', owner: 'planner', instance: 'p1', label: 'Planner', kind: 'surface' });
    expect(node.children?.[0]).toMatchObject({ id: 'planner.addTask', owner: 'planner', command: 'planner.addTask', state: { kind: 'pressed', value: false } });
    pressed = true;
    expect(scene.describe('planner').surfaces[0].children?.[0].state).toEqual({ kind: 'pressed', value: true });
    expect(JSON.stringify(before)).not.toContain('element');
  });

  it('hands a disposed surface\'s children to the surface above when its element stays', () => {
    const outer = surface('sidebar');
    const inner = surface('explorer', { owner: 'explorer' }, outer.el);
    button('explorer.refresh', inner.el);
    expect(scene.under(scene.find('sidebar')[0]).map((e) => e.id)).toEqual(['explorer', 'explorer.refresh']);
    inner.dispose();
    expect(scene.find('explorer')).toHaveLength(0);
    expect(scene.find('explorer.refresh')).toHaveLength(1);
    expect(scene.under(scene.find('sidebar')[0]).map((e) => e.id)).toEqual(['explorer.refresh']);
  });

  it('lets a control replace one with the same id whose element already left, in the same frame', () => {
    const s = surface('editor');
    const first = button('editorGroup.tabs', s.el);
    first.el.remove();
    const second = button('editorGroup.tabs', s.el);
    expect(scene.find('editorGroup.tabs').map((e) => e.element)).toEqual([second.el]);
  });

  it('lets a view\'s root be both its surface and a control, the control under the surface', () => {
    const s = surface('view.explorer', { owner: 'explorer' });
    const reg = scene.register({ id: 'explorer.tree', kind: 'tree', owner: '', label: 'Files', element: s.el });
    expect(scene.find('explorer.tree')).toHaveLength(1);
    expect(scene.under(scene.find('view.explorer')[0]).map((e) => e.id)).toEqual(['explorer.tree']);
    expect(scene.describe('view.explorer').surfaces[0].children?.[0]).toMatchObject({ id: 'explorer.tree', kind: 'tree', owner: 'explorer' });
    reg.dispose();
    expect(scene.find('explorer.tree')).toHaveLength(0);
    expect(scene.find('view.explorer')).toHaveLength(1);
  });

  it('fires onDidChange once per batch of changes', async () => {
    let fired = 0;
    scene.onDidChange(() => { fired++; });
    const s = surface('a');
    button('a.one', s.el);
    button('a.two', s.el);
    await settle();
    expect(fired).toBe(1);
  });
});
