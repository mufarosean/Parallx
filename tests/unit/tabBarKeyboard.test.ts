// @vitest-environment jsdom
// tabBarKeyboard.test.ts — editor tabs from the keyboard: the active tab is
// in the Tab order, the arrows move along the strip, Enter opens, Delete
// closes, Ctrl+Shift+arrows move a tab (what dragging does), Shift+F10 opens
// its menu, and a rebuild keeps focus on the same tab. docs/ACCESSIBILITY.md, section 2.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { TabBar } from '../../src/ui/tabBar.js';

const key = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}) =>
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, bubbles: true, cancelable: true }));
const tab = (id: string) => document.querySelector(`.ui-tab[data-tab-id="${id}"]`) as HTMLElement;

afterEach(() => { document.body.innerHTML = ''; });

describe('tab bar from the keyboard', () => {
  it('moves, opens, closes, reorders and opens the menu', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bar = new TabBar(host);
    bar.setItems([{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }]);
    bar.setActive('b');
    expect(tab('b').tabIndex).toBe(0);
    expect(tab('a').tabIndex).toBe(-1);
    const selected = vi.fn(), closed = vi.fn(), moved = vi.fn(), menu = vi.fn();
    bar.onDidSelect(selected); bar.onDidClose(closed); bar.onDidReorder(moved); bar.onDidContextMenu(menu);
    tab('b').focus();
    key('ArrowRight');
    expect(document.activeElement).toBe(tab('c'));
    key('Home');
    expect(document.activeElement).toBe(tab('a'));
    key('Enter');
    expect(selected).toHaveBeenCalledWith('a');
    key('Delete');
    expect(closed).toHaveBeenCalledWith('a');
    key('ArrowRight', { ctrl: true, shift: true });
    expect(moved).toHaveBeenCalledWith({ fromId: 'a', targetId: 'b', position: 'after' });
    key('F10', { shift: true });
    expect(menu.mock.calls[0][0].id).toBe('a');
    // A rebuild (new items) keeps focus on the same tab.
    bar.setItems([{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }, { id: 'd', label: 'Delta' }]);
    expect(document.activeElement).toBe(tab('a'));
    bar.dispose();
  });
});
