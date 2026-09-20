// @vitest-environment jsdom
// Creations AI: the Tables page (ext/creations-ai/tables.js): the rail,
// the source editor with its errors, Roll and its results, autosave, a new
// table from the starter, and the Roll A Table control beside a text field.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// @ts-expect-error — JS module with no types
import { renderTablesPage, attachTableRoll } from '../../ext/creations-ai/tables.js';
// @ts-expect-error — JS module with no types
import { STARTER_TABLE } from '../../ext/creations-ai/tables-core.js';

function el(tag: string, className?: string | null, attrs?: Record<string, string>) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); }
  return e;
}
function dropdownStub(host: HTMLElement, { items = [], selected = '' }: any) {
  let value = selected;
  const listeners: ((v: string) => void)[] = [];
  host.setAttribute('data-dropdown', 'true');
  const dd = { get value() { return value; }, set value(v: string) { value = v; }, setItems(list: any[]) { items = list; }, onDidChange(fn: (v: string) => void) { listeners.push(fn); }, _fire(v: string) { value = v; listeners.forEach((fn) => fn(v)); }, get items() { return items; } };
  (host as any).__dd = dd;
  return dd;
}
function tgSelect(parallx: any, { layout = 'full', title = '', items = [], value = '', onChange = null }: any = {}) {
  const host = el('span', `tg-dd tg-dd--${layout}`);
  if (title) host.title = title;
  const dd = parallx.ui.createDropdown(host, { items, selected: value });
  if (onChange) dd.onDidChange(onChange);
  return { element: host, get value() { return dd.value ?? ''; }, set value(v: string) { dd.value = v; }, setItems(list: any[]) { dd.setItems(list); } };
}

function makeWorld() {
  const files = new Map<string, string>([
    ['names.txt', 'output\n  [first] [last]\nfirst\n  Ada\nlast\n  Lovelace\n'],
    ['bad.txt', 'output\n  [missing] here\n'],
    ['uses.txt', 'output\n  [n] of the rock\nn = {import:names}\n'],
  ]);
  const fs = {
    readFile: async (uri: string) => { const name = uri.split('/').pop()!; if (!files.has(name)) throw new Error(`no ${name}`); return { content: files.get(name) }; },
    writeFile: async (uri: string, content: string) => { files.set(uri.split('/').pop()!, content); },
    readdir: async () => [...files.keys()].map((name) => ({ name, type: 1 })),
    delete: async (uri: string) => { files.delete(uri.split('/').pop()!); },
  };
  const parallx = {
    window: { showInputBox: vi.fn(async () => 'My Table'), showWarningMessage: async () => ({ title: 'Delete' }) },
    ui: { createDropdown: dropdownStub },
    workspace: { fs, workspaceFolders: [{ uri: 'ws' }] },
  };
  let ids = 0;
  const deps = { el, icon: (n: string) => `<i data-icon="${n}"></i>`, tgSelect, generateId: () => `id${++ids}`, resolveUri: (b: string, p: string) => `${b}/${p}`, extRoot: '.parallx/extensions/text-generator', extFolder: 'text-generator', ensureNestedDirs: async () => {}, injectStyles: () => {} };
  return { fs, parallx, deps, files };
}

const flush = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };
const buttonNamed = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
const results = (root: HTMLElement) => [...root.querySelectorAll('.tb-result-text')].map((e) => e.textContent);

let container: HTMLElement;
beforeEach(() => { vi.useFakeTimers(); container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { vi.useRealTimers(); container.remove(); });

describe('Tables', () => {
  it('lists the tables, opens one, shows its source and rolls it five times', async () => {
    const w = makeWorld();
    renderTablesPage(container, w.parallx, { instanceId: 'tables' }, w.deps);
    await flush();
    expect([...container.querySelectorAll('.tg-cc-row-name')].map((r) => r.textContent)).toEqual(['bad', 'names', 'uses']);
    ([...container.querySelectorAll('.tg-cc-row')][1] as HTMLElement).click();
    await flush();
    const root = container.querySelector('.cs') as HTMLElement;
    expect(root.querySelector('.tb-name')?.textContent).toBe('names');
    expect((root.querySelector('.tb-editor') as HTMLTextAreaElement).value).toBe(w.files.get('names.txt'));
    expect(results(root)).toEqual(['Ada Lovelace', 'Ada Lovelace', 'Ada Lovelace', 'Ada Lovelace', 'Ada Lovelace']);
    expect([...root.querySelectorAll('.cs-section-meta')].some((m) => m.textContent === '5 results from output')).toBe(true);
    expect(root.querySelector('select')).toBeNull();
    expect(root.textContent).not.toMatch(/[—–]/);
    const listDd = ([...root.querySelectorAll('.tb-controls [data-dropdown]')][1] as any).__dd;
    expect(listDd.items.map((i: any) => i.value)).toEqual(['output', 'first', 'last']);
  });

  it('says what it cannot resolve, resolves imports from other tables, and autosaves an edit', async () => {
    const w = makeWorld();
    renderTablesPage(container, w.parallx, { instanceId: 'bad.txt' }, w.deps);
    await flush();
    let root = container.querySelector('.cs') as HTMLElement;
    expect((root.querySelector('.cs-error') as HTMLElement).textContent).toContain('No list named "missing"');
    expect(results(root)).toEqual(['[missing] here', '[missing] here', '[missing] here', '[missing] here', '[missing] here']);
    ([...container.querySelectorAll('.tg-cc-row')][2] as HTMLElement).click();
    await flush();
    root = container.querySelector('.cs') as HTMLElement;
    expect(results(root)[0]).toBe('Ada Lovelace of the rock');
    const editor = root.querySelector('.tb-editor') as HTMLTextAreaElement;
    editor.value = 'output\n  changed\n';
    editor.dispatchEvent(new Event('input'));
    expect(root.querySelector('.cs-chip')?.textContent).toBe('Saving');
    await flush(900);
    expect(w.files.get('uses.txt')).toBe('output\n  changed\n');
    expect(root.querySelector('.cs-chip')?.textContent).toBe('Saved');
    buttonNamed(root, 'Roll').click();
    await flush();
    expect(results(root)).toEqual(['changed', 'changed', 'changed', 'changed', 'changed']);
  });

  it('makes a new table from the starter and opens it', async () => {
    const w = makeWorld();
    renderTablesPage(container, w.parallx, { instanceId: 'new' }, w.deps);
    await flush();
    expect(w.files.get('my-table.txt')).toBe(STARTER_TABLE);
    const root = container.querySelector('.cs') as HTMLElement;
    expect(root.querySelector('.tb-name')?.textContent).toBe('my-table');
    expect(results(root)).toHaveLength(5);
    for (const r of results(root)) expect(r).not.toMatch(/[[\]{}]/);
  });

  it('drops one roll into a text field from the Roll A Table control', async () => {
    const w = makeWorld();
    const area = document.createElement('textarea');
    area.value = 'A keeper.';
    const seen: string[] = [];
    area.addEventListener('input', () => seen.push(area.value));
    const control = attachTableRoll(w.parallx, w.deps, w.fs, 'ws', area);
    container.appendChild(control);
    await flush();
    const dd = (control.querySelector('[data-dropdown]') as any).__dd;
    expect(dd.items.map((i: any) => i.label)).toEqual(['Roll A Table', 'bad', 'names', 'uses']);
    dd._fire('names');
    await flush();
    expect(area.value).toBe('A keeper. Ada Lovelace');
    expect(seen).toEqual(['A keeper. Ada Lovelace']);
    expect(dd.value).toBe('');
  });
});
