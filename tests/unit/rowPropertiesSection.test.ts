// @vitest-environment jsdom
// The property panel: hidden on a page in no database (no properties), shown
// on request (the header's Add Properties) or once the page has a database.
import { describe, it, expect, vi } from 'vitest';
import { mountRowPropertiesSection } from '../../src/built-in/canvas/database/rowPropertiesSection';

function fakeDb(homeId: string | null) {
  return {
    getHomeDatabaseForPage: vi.fn(async () => homeId),
    getDatabase: vi.fn(async () => ({ title: 'Study' })),
    listProperties: vi.fn(async () => []),
    getRowValues: vi.fn(async () => ({})),
    onDidChangeRows: vi.fn(() => ({ dispose() {} })),
    onDidChangeStructure: vi.fn(() => ({ dispose() {} })),
  };
}

describe('mountRowPropertiesSection', () => {
  it('hides the panel on a page in no database, and reveals it on request', async () => {
    const host = document.createElement('div');
    const changes: boolean[] = [];
    const section = await mountRowPropertiesSection(host, 'p1', fakeDb(null) as any, null, undefined, undefined, (hidden) => changes.push(hidden));
    const panel = host.querySelector<HTMLElement>('.canvas-property-bar')!;
    expect(panel.style.display).toBe('none');
    expect(changes).toEqual([true]);

    section!.reveal();
    expect(panel.style.display).toBe('');
    expect(changes).toEqual([true, false]);
    section!.dispose();
  });

  it('shows the panel on a page that belongs to a database', async () => {
    const host = document.createElement('div');
    const changes: boolean[] = [];
    const section = await mountRowPropertiesSection(host, 'p1', fakeDb('db1') as any, null, undefined, undefined, (hidden) => changes.push(hidden));
    expect(host.querySelector<HTMLElement>('.canvas-property-bar')!.style.display).toBe('');
    expect(changes).toEqual([false]);
    section!.dispose();
  });

  it('a value kept by a tool is a stop for Tab, and says who keeps it when the focus arrives or it is tapped', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const db = {
      ...fakeDb('db1'),
      listProperties: vi.fn(async () => [
        { id: 'p-kept', databaseId: 'db1', name: 'Answered', type: 'number', config: { computedBy: 'acme.gone' }, sortOrder: 1 },
        { id: 'p-own', databaseId: 'db1', name: 'Weight', type: 'number', config: {}, sortOrder: 2 },
      ]),
      getRowValues: vi.fn(async () => ({ 'p-kept': 3, 'p-own': 10 })),
    };
    const section = await mountRowPropertiesSection(host, 'p1', db as any, null);
    const kept = host.querySelector<HTMLElement>('.canvas-prop-readonly')!;
    expect(kept.textContent).toContain('3');
    expect(kept.tabIndex).toBe(0);
    const shown = (): string => [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((t) => t.style.display !== 'none').map((t) => t.textContent).join('|');
    expect(shown()).toBe('');
    kept.focus();
    expect(document.activeElement).toBe(kept);
    expect(shown()).toBe('Kept by a tool that is off');
    kept.blur();
    await new Promise((r) => setTimeout(r, 0));
    expect(shown()).toBe('');
    kept.click();
    expect(shown()).toBe('Kept by a tool that is off');
    kept.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(shown()).toBe('');
    section!.dispose();
    host.remove();
  });
});
