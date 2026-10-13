// @vitest-environment jsdom
// openEditorsView.test.ts — the Open Editors list from the keyboard: the
// active row is in the Tab order, the arrows move, Enter opens, Delete closes
// that row's editor (as does its ×), and a re-render keeps focus on the row.
// docs/ACCESSIBILITY.md, section 2.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createOpenEditorsView, type IOpenEditorsHost } from '../../src/built-in/explorer/openEditorsView.js';
import { scene } from '../../src/ui/scene.js';

const key = (k: string) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

afterEach(() => { document.body.innerHTML = ''; scene.reset(); });

function host(): IOpenEditorsHost & { fire(): void } {
  const listeners: (() => void)[] = [];
  return {
    openEditors: [
      { id: 'e1', name: 'alpha.md', description: '', isDirty: false, isActive: false, groupId: 'g1' },
      { id: 'e2', name: 'beta.md', description: '', isDirty: false, isActive: true, groupId: 'g1' },
      { id: 'e3', name: 'gamma.md', description: '', isDirty: false, isActive: false, groupId: 'g1' },
    ],
    onDidChangeOpenEditors: (l) => { listeners.push(l); return { dispose() {} }; },
    focusEditor: vi.fn(async () => true),
    closeEditor: vi.fn(async () => true),
    fire: () => listeners.forEach((l) => l()),
  };
}

describe('Open Editors from the keyboard', () => {
  it('walks, opens, closes, and keeps focus across a re-render', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const h = host();
    const count = vi.fn();
    const view = createOpenEditorsView(container, h, count);
    expect(count).toHaveBeenCalledWith(3);
    const row = (id: string) => container.querySelector(`[data-editor-id="${id}"]`) as HTMLElement;
    expect(row('e2').tabIndex).toBe(0);
    expect(row('e2').getAttribute('role')).toBe('option');
    row('e2').focus();
    key('ArrowDown');
    expect(document.activeElement).toBe(row('e3'));
    key('Enter');
    expect(h.focusEditor).toHaveBeenCalledWith('e3');
    key('Delete');
    expect(h.closeEditor).toHaveBeenCalledWith('e3');
    (row('e1').querySelector('.open-editors-close') as HTMLElement).click();
    expect(h.closeEditor).toHaveBeenCalledWith('e1');
    h.fire();
    expect(document.activeElement).toBe(row('e3'));
    view.dispose();
  });
});
