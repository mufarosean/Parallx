// navigationHistory.test.ts — Back and Forward's one record
// (src/services/navigationHistory.ts): steps as a browser keeps them, its own
// moves not recorded, closed steps reopened or skipped; and Alt+ArrowLeft in a
// binding meeting the "alt+left" a key press gives.

import { describe, it, expect, beforeEach } from 'vitest';
import { NavigationHistory, MAX_STEPS, type NavigationHost, type NavigationStep } from '../../src/services/navigationHistory.js';
import { normalizeKeybinding } from '../../src/services/keybindingUtils.js';

/** A stand-in editor area: open tabs by id, one in front; a place tab carries its address. */
function makeWorld() {
  const open = new Map<string, NavigationStep>();
  let front: string | undefined;
  const reopenable = new Set<string>();
  let titleFocus = 0;
  let history!: NavigationHistory;
  const show = (s: NavigationStep) => { open.set(s.editorId, s); front = s.editorId; history.note(); };
  const host: NavigationHost = {
    current: () => (front ? open.get(front) : undefined),
    isOpen: (id) => open.has(id),
    async focus(id) { if (!open.has(id)) return false; front = id; history.note(); return true; },
    async reopen(r) {
      const id = String(r.data?.id);
      if (!reopenable.has(id)) return false;
      show({ editorId: id, label: id, reopen: r });
      return true;
    },
    async openPlace(address, editorId) {
      const id = editorId ?? 'tool:main';
      show({ editorId: id, label: address.split('/').pop()!, place: address });
      return true;
    },
    focusTitle() { titleFocus += 1; },
  };
  history = new NavigationHistory();
  history.setHost(host);
  const thing = (id: string) => { reopenable.add(id); show({ editorId: id, label: id, reopen: { typeId: 'file', data: { id } } }); };
  const place = (p: string, tab = 'tool:main') => show({ editorId: tab, label: p, place: `parallx://place/tool/${p}` });
  const close = (id: string) => { open.delete(id); if (front === id) { front = [...open.keys()].pop(); history.note(); } };
  return { history, thing, place, close, reopenable, at: () => host.current()?.label, titles: () => titleFocus };
}

describe('NavigationHistory', () => {
  let w: ReturnType<typeof makeWorld>;
  beforeEach(() => { w = makeWorld(); w.history.start(); });

  it('goes back and forward through tabs and places, focusing the title each time', async () => {
    w.thing('a.txt'); w.place('today'); w.place('calendar');
    expect(w.history.previous?.label).toBe('today');
    await w.history.back();
    expect(w.at()).toBe('today');
    await w.history.back();
    expect(w.at()).toBe('a.txt');
    expect(w.history.canGoBack).toBe(false);
    await w.history.forward();
    await w.history.forward();
    expect(w.at()).toBe('calendar');
    expect(w.history.canGoForward).toBe(false);
    expect(w.titles()).toBe(4);
  });

  it('does not record its own moves, and a new step drops the steps ahead', async () => {
    w.thing('a.txt'); w.thing('b.txt'); w.thing('c.txt');
    await w.history.back();
    await w.history.back();
    expect(w.history.snapshot()).toEqual({ labels: ['a.txt', 'b.txt', 'c.txt'], index: 0 });
    w.place('today');
    expect(w.history.snapshot()).toEqual({ labels: ['a.txt', 'today'], index: 1 });
    expect(w.history.canGoForward).toBe(false);
  });

  it('keeps the same step twice in a row as one', () => {
    w.place('today'); w.place('today'); w.thing('a.txt'); w.thing('a.txt');
    expect(w.history.snapshot().labels).toEqual(['today', 'a.txt']);
  });

  it('reopens a closed thing, and skips one that cannot be opened again', async () => {
    w.thing('a.txt'); w.thing('gone.txt'); w.thing('c.txt');
    w.close('gone.txt');
    w.reopenable.delete('gone.txt');
    w.close('a.txt');
    await w.history.back();
    expect(w.at()).toBe('a.txt');
    expect(w.history.snapshot().labels).not.toContain('gone.txt');
  });

  it('lists the last steps each way and jumps to one', async () => {
    w.place('today'); w.place('calendar'); w.place('tasks');
    expect(w.history.list('back').map((s) => s.step.label)).toEqual(['calendar', 'today']);
    await w.history.go(-2);
    expect(w.at()).toBe('today');
    expect(w.history.list('forward').map((s) => s.step.label)).toEqual(['calendar', 'tasks']);
  });

  it('keeps at most MAX_STEPS steps', () => {
    for (let i = 0; i < MAX_STEPS + 10; i++) w.thing(`f${i}.txt`);
    expect(w.history.snapshot().labels.length).toBe(MAX_STEPS);
    expect(w.history.snapshot().index).toBe(MAX_STEPS - 1);
  });

  it('records nothing before start (the last session\'s tabs coming back)', () => {
    const v = makeWorld();
    v.thing('a.txt'); v.thing('b.txt');
    v.history.start();
    expect(v.history.snapshot()).toEqual({ labels: ['b.txt'], index: 0 });
  });
});

describe('normalizeKeybinding', () => {
  it('reads the arrows as a key press names them', () => {
    expect(normalizeKeybinding('Alt+ArrowLeft')).toBe('alt+left');
    expect(normalizeKeybinding('Alt+Left')).toBe('alt+left');
    expect(normalizeKeybinding('Ctrl+Shift+ArrowDown')).toBe('ctrl+shift+down');
  });
});
