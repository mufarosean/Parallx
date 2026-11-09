// @vitest-environment jsdom
// directions-scope.js: the kinds of direction a chat offers, scoped. The
// drawer shows the two lists with a dropdown each: Follow Settings (the
// default, nothing stored) or This Chat's Own List, which starts as a copy of
// the Settings list and is saved on the thread as it is edited; back to
// Follow clears it. An own list left empty means none of that sort here.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { mountDirectionsScope, settingsList, FOLLOW_SETTINGS, OWN_LIST } from '../../ext/creations-ai/directions-scope.js';
// @ts-expect-error — JS module with no types
import { DEFAULT_NARRATOR_DIRECTIONS } from '../../ext/creations-ai/director.js';

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

function mount(thread: Record<string, unknown>, settings: Record<string, unknown>) {
  const host = document.createElement('div');
  const saved: Record<string, unknown>[] = [];
  const saveMeta = (u: Record<string, unknown>) => { Object.assign(thread, u); saved.push(u); };
  const fields = mountDirectionsScope(host, { ui, select, fieldWrap, thread, saveMeta, settings: () => settings });
  return { host, saved, fields };
}

describe('the Settings list', () => {
  it('is the Settings text, else the shipped default', () => {
    expect(settingsList({ directionsNarrator: 'Event: lands' }, 'directionsNarrator', DEFAULT_NARRATOR_DIRECTIONS)).toBe('Event: lands');
    expect(settingsList({}, 'directionsNarrator', DEFAULT_NARRATOR_DIRECTIONS)).toBe(DEFAULT_NARRATOR_DIRECTIONS);
  });
});

describe('in the drawer', () => {
  it('follows Settings by default: the dropdown says so and the textarea is hidden; nothing is stored', () => {
    const thread = { directionsCharacter: null, directionsNarrator: null };
    const { host, saved, fields } = mount(thread, {});
    expect(fields.map((f: any) => f.key)).toEqual(['directionsCharacter', 'directionsNarrator']);
    expect(host.textContent).toContain('Directions for each character (this chat)');
    expect(host.textContent).toContain('Directions for the Narrator (this chat)');
    for (const f of fields) {
      expect(f.scope.value).toBe(FOLLOW_SETTINGS);
      expect(f.area.hidden).toBe(true);
      expect(f.scope.items.map((i: any) => i.label)).toEqual(['Follow Settings (Default)', "This Chat's Own List"]);
    }
    expect(saved).toEqual([]);
    expect(host.textContent).not.toMatch(/[—–]/);
  });

  it('an own list starts as a copy of the Settings list, saves as edited, and Follow clears it', () => {
    const thread: Record<string, unknown> = { directionsCharacter: null, directionsNarrator: null };
    const { saved, fields } = mount(thread, { directionsCharacter: 'Push: act\nStall: wait' });
    const [chars] = fields;
    chars.scope.onChange(OWN_LIST);
    expect(chars.area.hidden).toBe(false);
    expect(chars.area.value).toBe('Push: act\nStall: wait');
    expect(thread.directionsCharacter).toBe('Push: act\nStall: wait');
    chars.area.value = 'Confess: they say the thing';
    chars.area.dispatchEvent(new Event('change'));
    expect(thread.directionsCharacter).toBe('Confess: they say the thing');
    chars.scope.onChange(FOLLOW_SETTINGS);
    expect(thread.directionsCharacter).toBeNull();
    expect(chars.area.hidden).toBe(true);
    expect(saved.length).toBe(3);
    // The Narrator list was never touched.
    expect(thread.directionsNarrator).toBeNull();
  });

  it('a chat that already has its own list opens on it, an empty own list included', () => {
    const thread = { directionsCharacter: 'Confess: they say the thing', directionsNarrator: '' };
    const { fields } = mount(thread, {});
    expect(fields[0].scope.value).toBe(OWN_LIST);
    expect(fields[0].area.hidden).toBe(false);
    expect(fields[0].area.value).toBe('Confess: they say the thing');
    expect(fields[1].scope.value).toBe(OWN_LIST);
    expect(fields[1].area.value).toBe('');
    expect(fields[1].area.getAttribute('aria-label')).toBe("Directions for the Narrator, this chat's list");
  });
});
