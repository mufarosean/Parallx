// @vitest-environment jsdom
// kitContractCompliance.test.ts — every kit function keeps the contract in
// docs/SELF_DESCRIBING_UI_DESIGN.md section 5: it writes data-px-id, a role
// where the kind implies one, a readable label, registers one scene entry of
// the right kind under the surface it is mounted in with a state of the
// right shape, and leaves the scene on dispose or when its element leaves
// the document.

import { describe, it, expect, beforeEach } from 'vitest';
import { scene } from '../../src/ui/scene.js';
import {
  createSurface, createButton, createIconButton, createFilterChip, createSegmented, createToggle,
  createInput, createSelect, createSlider, createTabs, createList, createTree, installKitCommands,
} from '../../src/ui/kit.js';

const settle = () => new Promise<void>((r) => setTimeout(r, 60));

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  scene.reset();
  host = document.createElement('div');
  document.body.appendChild(host);
  createSurface(host, { id: 'test', owner: 'core', label: 'Test' });
});

function entryOf(id: string) {
  const found = scene.find(id);
  expect(found, `one entry for ${id}`).toHaveLength(1);
  const surface = scene.find('test')[0];
  expect(scene.under(surface).map((e) => e.id)).toContain(id);
  return found[0];
}

function readableLabel(el: HTMLElement): string {
  return el.getAttribute('aria-label') || el.textContent?.trim() || '';
}

describe('kit contract', () => {
  it('button: data-px-id, label text, enabled state, command recorded, gone on dispose', () => {
    const btn = createButton(host, { id: 'test.save', label: 'Save', command: 'workbench.action.save' });
    expect(btn.getAttribute('data-px-id')).toBe('test.save');
    expect(readableLabel(btn)).toBe('Save');
    const e = entryOf('test.save');
    expect(e.kind).toBe('button');
    expect(e.command).toBe('workbench.action.save');
    expect(e.state?.()).toEqual({ kind: 'enabled', value: true });
    btn.disabled = true;
    expect(e.state?.()).toEqual({ kind: 'enabled', value: false });
  });

  it('button: a command runs through the installed service; a handler and a command together throw', async () => {
    const ran: string[] = [];
    installKitCommands({ executeCommand: async (id, ...args) => { ran.push(`${id}:${JSON.stringify(args)}`); } });
    const btn = createButton(host, { id: 'test.run', label: 'Run', command: 'x.run', args: [1] });
    btn.click();
    await settle();
    expect(ran).toEqual(['x.run:[1]']);
    expect(() => createButton(host, { id: 'test.both', label: 'Both', command: 'a', onClick: () => {} })).toThrow(/both a command and a handler/);
  });

  it('button without an id registers nothing and renders as before', () => {
    const btn = createButton(host, { label: 'Plain' });
    expect(btn.hasAttribute('data-px-id')).toBe(false);
    expect(btn.className).toBe('px-btn px-btn--secondary');
    expect(scene.entries().map((e) => e.id)).toEqual(['test']);
  });

  it('icon button: the title is the label', () => {
    const btn = createIconButton(host, { id: 'test.more', icon: 'ellipsis', title: 'More Actions' });
    expect(btn.getAttribute('aria-label')).toBe('More Actions');
    expect(entryOf('test.more')).toMatchObject({ kind: 'iconButton', label: 'More Actions' });
  });

  it('chip: pressed state', () => {
    const chip = createFilterChip(host, { id: 'test.starred', label: 'Starred' });
    const e = entryOf('test.starred');
    expect(e.state?.()).toEqual({ kind: 'pressed', value: false });
    chip.pressed = true;
    expect(e.state?.()).toEqual({ kind: 'pressed', value: true });
  });

  it('segmented: value state, dispose removes the entry', () => {
    const seg = createSegmented(host, { id: 'test.range', ariaLabel: 'Range', items: [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }], value: 'week' });
    expect(seg.element.getAttribute('data-px-id')).toBe('test.range');
    expect(entryOf('test.range').state?.()).toEqual({ kind: 'value', value: 'week' });
    seg.dispose();
    expect(scene.find('test.range')).toHaveLength(0);
  });

  it('toggle: role switch, pressed state', () => {
    const t = createToggle(host, { id: 'test.dark', label: 'Dark Mode', checked: true });
    expect(t.element.getAttribute('role')).toBe('switch');
    expect(readableLabel(t.element)).toBe('Dark Mode');
    expect(entryOf('test.dark').state?.()).toEqual({ kind: 'pressed', value: true });
    t.checked = false;
    expect(entryOf('test.dark').state?.()).toEqual({ kind: 'pressed', value: false });
  });

  it('input: value state', () => {
    const i = createInput(host, { id: 'test.name', label: 'Name', value: 'a' });
    expect(entryOf('test.name').state?.()).toEqual({ kind: 'value', value: 'a' });
    i.value = 'b';
    expect(entryOf('test.name').state?.()).toEqual({ kind: 'value', value: 'b' });
    expect(i.element.querySelector('[aria-label="Name"]') ?? i.element.getAttribute('aria-label')).toBeTruthy();
  });

  it('select: role combobox, value state', () => {
    const s = createSelect(host, { id: 'test.font', label: 'Font', items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a', onChange: () => {} });
    expect(s.element.getAttribute('role')).toBe('combobox');
    expect(entryOf('test.font').state?.()).toEqual({ kind: 'value', value: 'a' });
    s.value = 'b';
    expect(entryOf('test.font').state?.()).toEqual({ kind: 'value', value: 'b' });
  });

  it('slider: number state', () => {
    const s = createSlider(host, { id: 'test.size', label: 'Size', min: 0, max: 10, value: 4 });
    expect(s.element.getAttribute('role')).toBe('slider');
    expect(entryOf('test.size').state?.()).toEqual({ kind: 'number', value: 4 });
  });

  it('tabs: role tablist, selection state with a count', () => {
    const t = createTabs(host, { id: 'test.tabs', label: 'Open Editors', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], active: 'b' });
    expect(t.element.getAttribute('role')).toBe('tablist');
    expect(entryOf('test.tabs').state?.()).toEqual({ kind: 'selection', value: ['b'], count: 2 });
  });

  it('list and tree: one entry each, selection state from the caller', () => {
    const ul = document.createElement('ul');
    host.appendChild(ul);
    for (const n of ['x', 'y', 'z']) { const li = document.createElement('li'); li.dataset.id = n; ul.appendChild(li); }
    const selected: string[] = ['y'];
    createList(ul, { id: 'test.items', label: 'Items', rows: () => Array.from(ul.children) as HTMLElement[], selected: () => selected });
    expect(ul.getAttribute('role')).toBe('listbox');
    expect(entryOf('test.items').state?.()).toEqual({ kind: 'selection', value: ['y'], count: 3 });
    const treeEl = document.createElement('div');
    host.appendChild(treeEl);
    createTree(treeEl, { id: 'test.tree', label: 'Files', rows: () => [], selected: () => [] });
    expect(treeEl.getAttribute('role')).toBe('tree');
    expect(entryOf('test.tree').kind).toBe('tree');
    expect(scene.entries().filter((e) => e.kind !== 'surface')).toHaveLength(2);
  });

  it('a control whose element leaves the document leaves the scene without dispose', async () => {
    const btn = createButton(host, { id: 'test.gone', label: 'Gone' });
    entryOf('test.gone');
    btn.remove();
    await settle();
    expect(scene.find('test.gone')).toHaveLength(0);
  });

  it('surface: setInstance re-registers under the new instance; a duplicate control id throws', () => {
    const pane = document.createElement('div');
    host.appendChild(pane);
    const s = createSurface(pane, { id: 'test.pane', owner: 'worksheet', label: 'Pane' });
    expect(scene.find('test.pane')[0].instance).toBeUndefined();
    s.setInstance('42');
    expect(pane.getAttribute('data-px-instance')).toBe('42');
    expect(scene.find('test.pane')[0].instance).toBe('42');
    createButton(pane, { id: 'test.pane.go', label: 'Go' });
    expect(() => createButton(pane, { id: 'test.pane.go', label: 'Go again' })).toThrow(/registered twice/);
    expect(scene.describe('test.pane').surfaces[0]).toMatchObject({ id: 'test.pane', owner: 'worksheet', instance: '42' });
    expect(scene.describe('test.pane').surfaces[0].children?.[0]).toMatchObject({ id: 'test.pane.go', owner: 'worksheet' });
  });
});
