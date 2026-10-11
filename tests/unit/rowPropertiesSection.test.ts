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
});
