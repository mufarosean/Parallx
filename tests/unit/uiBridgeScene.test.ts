// @vitest-environment jsdom
// uiBridgeScene.test.ts — api.ui hands extensions the kit's declaring
// functions, and its two older widgets (createDropdown, createAiButton)
// join the scene when given an id. docs/SELF_DESCRIBING_UI_DESIGN.md 5.5.

import { describe, it, expect, beforeEach } from 'vitest';
import { scene } from '../../src/ui/scene.js';
import { createUiApi } from '../../src/api/bridges/uiBridge.js';
import { installKitCommands } from '../../src/ui/kit.js';

let host: HTMLElement;
let ui: ReturnType<typeof createUiApi>;
beforeEach(() => {
  document.body.innerHTML = '';
  scene.reset();
  ui = createUiApi();
  host = document.createElement('div');
  document.body.appendChild(host);
  ui.createSurface(host, { id: 'view.budget', owner: 'budget', label: 'Budget' });
});

describe('api.ui and the scene', () => {
  it('a kit button with an id lists under the extension view, owner inherited', () => {
    ui.createButton(host, { id: 'budget.sync', label: 'Sync Now', command: 'budget.sync' });
    const node = scene.describe('view.budget').surfaces[0];
    expect(node.children?.[0]).toMatchObject({ id: 'budget.sync', owner: 'budget', command: 'budget.sync', kind: 'button' });
  });

  it('a repeated card is a surface with an instance, its button under it', () => {
    const card = document.createElement('article');
    host.appendChild(card);
    ui.createSurface(card, { id: 'budget.account', owner: 'budget', label: 'Main', instance: 'a1' });
    ui.createButton(card, { id: 'budget.account.remove', label: 'Remove' });
    const view = scene.describe('view.budget').surfaces[0];
    expect(view.children?.[0]).toMatchObject({ id: 'budget.account', instance: 'a1' });
    expect(view.children?.[0].children?.[0].id).toBe('budget.account.remove');
  });

  it('createDropdown with an id is a select whose value is the chosen item; dispose removes it', () => {
    const dd = ui.createDropdown(host, { id: 'budget.period', ariaLabel: 'Period', items: [{ value: 'm', label: 'Month' }, { value: 'y', label: 'Year' }], selected: 'y' });
    const entry = scene.find('budget.period')[0];
    expect(entry).toMatchObject({ kind: 'select', label: 'Period' });
    expect(entry.state?.()).toEqual({ kind: 'value', value: 'y' });
    dd.dispose();
    expect(scene.find('budget.period')).toHaveLength(0);
  });

  it('createDropdown without an id registers nothing', () => {
    ui.createDropdown(host, { ariaLabel: 'Period', items: [{ value: 'm', label: 'Month' }] });
    expect(scene.entries().map((e) => e.id)).toEqual(['view.budget']);
  });

  it('createAiButton with an id records its command', () => {
    const btn = ui.createAiButton(host, { id: 'budget.ask', label: 'Ask', command: 'budget.ask' });
    expect(btn.getAttribute('data-px-id')).toBe('budget.ask');
    expect(scene.find('budget.ask')[0]).toMatchObject({ kind: 'button', command: 'budget.ask', label: 'Ask' });
  });

  it('the form controls and declareControl are the kit\'s, with their states', () => {
    ui.createToggle(host, { id: 'budget.roundUp', label: 'Round up', checked: true });
    ui.createInput(host, { id: 'budget.name', label: 'Name', value: 'x' });
    ui.createSlider(host, { id: 'budget.limit', label: 'Limit', min: 0, max: 10, value: 3 });
    const tab = document.createElement('div');
    host.appendChild(tab);
    ui.declareControl(tab, { id: 'budget.tab.accounts', label: 'Accounts', state: () => ({ kind: 'pressed', value: true }) });
    expect(scene.find('budget.roundUp')[0].state?.()).toEqual({ kind: 'pressed', value: true });
    expect(scene.find('budget.name')[0].state?.()).toEqual({ kind: 'value', value: 'x' });
    expect(scene.find('budget.limit')[0].state?.()).toEqual({ kind: 'number', value: 3 });
    expect(tab.getAttribute('role')).toBe('button');
    expect(scene.find('budget.tab.accounts')[0].state?.()).toEqual({ kind: 'pressed', value: true });
  });

  it('a slider moves from code without firing, and reports a finished move', () => {
    const changes: number[] = []; const commits: number[] = [];
    const s = ui.createSlider(host, { id: 'studio.height', label: 'Height', min: 0, max: 1, step: 0.01, value: 0.5, onChange: (v: number) => changes.push(v), onCommit: (v: number) => commits.push(v) });
    s.setValue(0.25);
    expect(s.value).toBe(0.25);
    expect(scene.find('studio.height')[0].state?.()).toEqual({ kind: 'number', value: 0.25 });
    expect(changes).toEqual([]);
    const input = s.element.querySelector('input') as HTMLInputElement;
    input.value = '0.75';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    expect(changes).toEqual([0.75]);
    expect(commits).toEqual([0.75]);
  });

  it('a choice grid is a named radio group: one tile in the tab order, arrows choose', () => {
    const picked: string[] = [];
    const g = ui.createChoiceGrid(host, { id: 'studio.hair', label: 'Hair colour', variant: 'swatch', value: 'b', onChange: (v: string) => picked.push(v),
      items: [{ value: 'a', label: 'Black', rgb: [0, 0, 0] }, { value: 'b', label: 'Brown', rgb: [0.4, 0.2, 0.1] }, { value: 'c', label: 'Blonde', rgb: [0.9, 0.7, 0.4] }] });
    const tiles = [...g.element.querySelectorAll('[role="radio"]')] as HTMLElement[];
    expect(g.element.getAttribute('role')).toBe('radiogroup');
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(['Black', 'Brown', 'Blonde']);
    expect(tiles.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(tiles[1].getAttribute('aria-checked')).toBe('true');
    tiles[1].focus();
    tiles[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(picked).toEqual(['c']);
    expect(g.value).toBe('c');
    expect(scene.find('studio.hair')[0].state?.()).toEqual({ kind: 'value', value: 'c' });
    tiles[0].click();
    expect(picked).toEqual(['c', 'a']);
    g.value = 'b';
    expect(picked).toEqual(['c', 'a']);
  });

  it('a block is layout or text only', () => {
    const b = ui.createBlock(host, 'span', { className: 'x-name', text: 'Ada', attrs: { 'aria-hidden': 'true' } });
    expect(b.tagName).toBe('SPAN');
    expect(b.textContent).toBe('Ada');
    expect(b.getAttribute('aria-hidden')).toBe('true');
    expect(b.parentElement).toBe(host);
    expect(() => ui.createBlock(host, 'button')).toThrow();
    expect(() => ui.createBlock(host, 'a')).toThrow();
    expect(() => ui.createBlock(host, 'div', { attrs: { onclick: 'x()' } })).toThrow();
  });

  it('a header action with a command and no handler runs its command with its arguments', async () => {
    const ran: unknown[][] = [];
    installKitCommands({ executeCommand: async (...a: unknown[]) => { ran.push(a); } });
    ui.createPageHeader(host, { title: 'Studio', primary: { id: 'studio.export', label: 'Export…', command: 'studio.export', args: ['c1'] } });
    (host.querySelector('[data-px-id="studio.export"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(ran).toEqual([['studio.export', 'c1']]);
  });

  it('sceneSlug is the kit one, for dynamic id segments', () => {
    expect(ui.sceneSlug('Saved So Far')).toBe('saved-so-far');
    expect(ui.sceneSlug('')).toBe('none');
  });
});
