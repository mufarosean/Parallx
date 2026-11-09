// @vitest-environment jsdom
// directions-scope.js: the kinds of direction a chat offers, scoped. The
// drawer shows one list per character in the chat and one for the Narrator,
// each with a dropdown: Follow Settings (the default, nothing stored) or
// This Chat's Own List, which starts as a copy of the Settings list and is
// saved on the thread as it is edited; back to Follow clears it. An own
// list left empty means none of that sort here.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { mountDirectionsScope, directionLists, settingsList, FOLLOW_SETTINGS, OWN_LIST } from '../../ext/creations-ai/directions-scope.js';
// @ts-expect-error — JS module with no types
import { DEFAULT_NARRATOR_DIRECTIONS, DEFAULT_CHARACTER_DIRECTIONS } from '../../ext/creations-ai/director.js';

const ui = {
  createBlock(container: HTMLElement | null, tag: string, o: { className?: string; text?: string; attrs?: Record<string, string> } = {}) {
    const e = document.createElement(tag);
    if (o.className) e.className = o.className;
    if (o.text != null) e.textContent = o.text;
    for (const [k, v] of Object.entries(o.attrs || {})) e.setAttribute(k, v);
    container?.appendChild(e);
    return e;
  },
};
type Sel = { element: HTMLElement; value: string; onChange: (v: string) => void; items: { value: string; label: string }[] };
const select = (o: { items: Sel['items']; value: string; onChange: (v: string) => void }): Sel => ({ element: document.createElement('span'), value: o.value, onChange: o.onChange, items: o.items });
const fieldWrap = (label: string, control: HTMLElement) => {
  const wrap = document.createElement('div');
  const l = document.createElement('label');
  l.textContent = label;
  wrap.append(l, control);
  return wrap;
};
const cast = [{ file: 'henrik.json', name: 'Henrik Voss' }, { file: 'mia.json', name: 'Mia Voss' }];

function mount(thread: Record<string, unknown>, settings: Record<string, unknown>, characters = cast) {
  const host = document.createElement('div');
  const saved: Record<string, unknown>[] = [];
  const saveMeta = (u: Record<string, unknown>) => { Object.assign(thread, u); saved.push(u); };
  const fields = mountDirectionsScope(host, { ui, select, fieldWrap, thread, saveMeta, settings: () => settings, characters });
  return { host, saved, fields };
}

describe('the lists', () => {
  it('the Settings list is the Settings text, else the shipped default', () => {
    expect(settingsList({ directionsNarrator: 'Event: lands' }, 'directionsNarrator', DEFAULT_NARRATOR_DIRECTIONS)).toBe('Event: lands');
    expect(settingsList({}, 'directionsNarrator', DEFAULT_NARRATOR_DIRECTIONS)).toBe(DEFAULT_NARRATOR_DIRECTIONS);
  });
  it('one per character in the chat, then the Narrator, each reading and writing its own place on the thread', () => {
    const thread: Record<string, any> = { directionsByCharacter: { 'mia.json': 'Confess: she says it' }, directionsNarrator: null };
    const saved: any[] = [];
    const lists = directionLists(thread, cast, (u: any) => { Object.assign(thread, u); saved.push(u); });
    expect(lists.map((l: any) => l.label)).toEqual(['Directions for Henrik Voss', 'Directions for Mia Voss', 'Directions for the Narrator']);
    expect(lists[0].get()).toBeUndefined();
    expect(lists[1].get()).toBe('Confess: she says it');
    lists[0].set('Push: he acts');
    expect(thread.directionsByCharacter).toEqual({ 'mia.json': 'Confess: she says it', 'henrik.json': 'Push: he acts' });
    lists[1].set(null);
    expect(thread.directionsByCharacter).toEqual({ 'henrik.json': 'Push: he acts' });
    lists[2].set('');
    expect(thread.directionsNarrator).toBe('');
    expect(lists[0].fallback).toBe(DEFAULT_CHARACTER_DIRECTIONS);
  });
});

describe('in the drawer', () => {
  it('follows Settings by default: every dropdown says so, every textarea is hidden; nothing is stored', () => {
    const thread = { directionsByCharacter: {}, directionsNarrator: null };
    const { host, saved, fields } = mount(thread, {});
    expect(fields.map((f: any) => f.key)).toEqual(['directionsByCharacter.henrik.json', 'directionsByCharacter.mia.json', 'directionsNarrator']);
    expect(host.textContent).toContain('Directions for Henrik Voss (this chat)');
    expect(host.textContent).toContain('Directions for Mia Voss (this chat)');
    expect(host.textContent).toContain('Directions for the Narrator (this chat)');
    for (const f of fields) {
      expect(f.scope.value).toBe(FOLLOW_SETTINGS);
      expect(f.area.hidden).toBe(true);
      expect(f.scope.items.map((i: any) => i.label)).toEqual(['Follow Settings (Default)', "This Chat's Own List"]);
    }
    expect(saved).toEqual([]);
    expect(host.textContent).not.toMatch(/[—–]/);
  });

  it("one character's own list starts as a copy of the Settings list, saves as edited, leaves the others alone, and Follow clears it", () => {
    const thread: Record<string, any> = { directionsByCharacter: {}, directionsNarrator: null };
    const { saved, fields } = mount(thread, { directionsCharacter: 'Push: act\nStall: wait' });
    const [henrik, mia] = fields;
    mia.scope.onChange(OWN_LIST);
    expect(mia.area.hidden).toBe(false);
    expect(mia.area.value).toBe('Push: act\nStall: wait');
    expect(thread.directionsByCharacter).toEqual({ 'mia.json': 'Push: act\nStall: wait' });
    mia.area.value = 'Confess: she says the thing';
    mia.area.dispatchEvent(new Event('change'));
    expect(thread.directionsByCharacter).toEqual({ 'mia.json': 'Confess: she says the thing' });
    expect(henrik.area.hidden).toBe(true);
    mia.scope.onChange(FOLLOW_SETTINGS);
    expect(thread.directionsByCharacter).toEqual({});
    expect(mia.area.hidden).toBe(true);
    expect(saved.length).toBe(3);
    expect(thread.directionsNarrator).toBeNull();
  });

  it('a chat that already has own lists opens on them, an empty one included', () => {
    const thread = { directionsByCharacter: { 'henrik.json': 'Push: he acts' }, directionsNarrator: '' };
    const { fields } = mount(thread, {});
    expect(fields[0].scope.value).toBe(OWN_LIST);
    expect(fields[0].area.value).toBe('Push: he acts');
    expect(fields[1].scope.value).toBe(FOLLOW_SETTINGS);
    expect(fields[2].scope.value).toBe(OWN_LIST);
    expect(fields[2].area.value).toBe('');
    expect(fields[2].area.getAttribute('aria-label')).toBe("Directions for the Narrator, this chat's list");
  });
});
