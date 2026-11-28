// @vitest-environment jsdom
// places.test.ts — the core's places (src/services/places.ts): a tool's
// places share one tab, named for the place, with a trail and an address;
// a crumb moves in the same tab; Open in Its Own Tab and newTab open
// another; the tool going takes its places with it.

import { describe, it, expect, beforeEach } from 'vitest';
import { Emitter } from '../../src/platform/events.js';
import { PlacesService, parsePlaceAddress, placeAddress, type PlaceLocation, type PlaceTabInput, type PlacesEditorHost } from '../../src/services/places.js';
import type { IEditorTrailCrumb } from '../../src/editor/editorTrail.js';

class FakeInput implements PlaceTabInput {
  place: string | undefined;
  openInOwnTab: (() => void) | undefined;
  name = '';
  trail: readonly IEditorTrailCrumb[] | undefined;
  readonly dispose = new Emitter<void>();
  readonly onWillDispose = this.dispose.event;
  constructor(readonly id: string) {}
  setName(n: string): void { this.name = n; }
  setIconHtml(): void { /* drawn by the tab bar */ }
  setTrail(t: readonly IEditorTrailCrumb[] | undefined): void { this.trail = t; }
}

/** A stand-in for the editor area: tabs by id, one in front; opening one draws its pane. */
function makeHost(svc: () => PlacesService) {
  const tabs = new Map<string, { input: FakeInput; container: HTMLElement }>();
  let active: string | undefined;
  const host: PlacesEditorHost = {
    async openEditor(o) {
      const id = `tool:${o.typeId}:${o.instanceId}`;
      if (!tabs.has(id)) {
        const input = new FakeInput(id);
        input.name = o.title;
        const container = document.createElement('div');
        document.body.appendChild(container);
        tabs.set(id, { input, container });
        active = id;
        svc().createPane('demo', container, input);
      }
      active = id;
    },
    async focusEditor(id) { if (!tabs.has(id)) return false; active = id; return true; },
    openEditorIds: () => [...tabs.keys()].map((id) => ({ id, isActive: id === active })),
    editorIdOf: (type, instance) => `tool:${type}:${instance}`,
  };
  return { host, tabs, active: () => active };
}

const shown: PlaceLocation[] = [];

describe('places', () => {
  let svc: PlacesService;
  let h: ReturnType<typeof makeHost>;
  beforeEach(() => {
    document.body.innerHTML = '';
    shown.length = 0;
    svc = new PlacesService();
    h = makeHost(() => svc);
    svc.register('tool', {
      id: 'demo', title: 'Demo', icon: 'calendar',
      places: [{ id: 'home', title: 'Home' }, { id: 'stats', title: 'Stats' }],
      createView: (container) => ({
        show(loc) {
          shown.push(loc);
          container.innerHTML = `<header class="px-page-header"><h1 class="px-page-header__title" tabindex="-1">${loc.place}</h1></header>`;
        },
        dispose() { /* nothing */ },
      }),
    }, h.host);
  });

  it('an address names a tool, a place and what it was given, and reads back', () => {
    const address = placeAddress('demo', { place: 'stats', params: { year: '2026' } });
    expect(address).toBe('parallx://place/demo/stats?year=2026');
    expect(parsePlaceAddress(address)).toEqual({ tool: 'demo', location: { place: 'stats', params: { year: '2026' } } });
    expect(parsePlaceAddress('parallx://canvas/page/x')).toBeNull();
  });

  it('places share one tab, named for the place, with a trail from the tool', async () => {
    await svc.open('demo', { place: 'home' });
    await svc.open('demo', { place: 'stats' });
    expect(h.tabs.size).toBe(1);
    const tab = [...h.tabs.values()][0].input;
    expect(tab.name).toBe('Stats');
    expect(tab.trail?.map((c) => c.label)).toEqual(['Demo', 'Stats']);
    expect(tab.trail?.[0].icon).toBeTruthy();
    expect(tab.trail?.[1].current).toBe(true);
    expect(tab.place).toBe('parallx://place/demo/stats');
    expect(svc.current('demo')).toEqual({ place: 'stats' });
  });

  it('a crumb goes to its place in the same tab; with newTab, in a tab of its own', async () => {
    await svc.open('demo', { place: 'stats' });
    const tab = [...h.tabs.values()][0].input;
    tab.trail![0].open!({ newTab: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.tabs.size).toBe(1);
    expect(tab.name).toBe('Home');
    tab.trail![1].open!({ newTab: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.tabs.size).toBe(2);
  });

  it('Open in Its Own Tab opens the same place in a second tab', async () => {
    await svc.open('demo', { place: 'stats' });
    const first = [...h.tabs.values()][0].input;
    first.openInOwnTab!();
    await new Promise((r) => setTimeout(r, 0));
    expect([...h.tabs.values()].map((t) => t.input.name)).toEqual(['Stats', 'Stats']);
  });

  it('after a move the keys are on the new page title', async () => {
    // jsdom lays nothing out, and a title not on screen yet is waited for: give every element a box.
    const rects = HTMLElement.prototype.getClientRects;
    HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
    try {
      await svc.open('demo', { place: 'home' });
      await svc.open('demo', { place: 'stats' });
      const { container } = [...h.tabs.values()][0];
      expect(document.activeElement).toBe(container.querySelector('.px-page-header__title'));
      expect(document.activeElement?.textContent).toBe('stats');
    } finally {
      HTMLElement.prototype.getClientRects = rects;
    }
  });

  it('another of the tool\'s tabs coming to the front says the tool moved (the column follows it)', async () => {
    await svc.open('demo', { place: 'stats' });
    const first = [...h.tabs.keys()][0];
    await svc.open('demo', { place: 'home' }, { newTab: true });
    const moves: string[] = [];
    svc.onDidMove((m) => moves.push(m.location.place));
    await h.host.focusEditor(first); // the editor area puts it in front, then says so
    svc.noteActiveEditor(first);
    expect(moves).toEqual(['stats']);
    expect(svc.current('demo')).toEqual({ place: 'stats' });
  });

  it('a view that moves itself while it is being made keeps that place', async () => {
    const svc2 = new PlacesService();
    const h2 = makeHost(() => svc2);
    svc2.register('tool', {
      id: 'demo', title: 'Demo', icon: 'calendar',
      places: [{ id: 'home', title: 'Home' }, { id: 'stats', title: 'Stats' }],
      createView: (_c, host) => { host.replace({ place: 'stats' }); return { show() { /* drawn */ }, dispose() { /* nothing */ } }; },
    }, h2.host);
    await svc2.open('demo');
    expect([...h2.tabs.values()][0].input.name).toBe('Stats');
  });

  it('a place opens with what it was given (a list), carried in its address and the trail', async () => {
    await svc.open('demo', { place: 'stats', params: { list: 'overdue' } });
    const tab = [...h.tabs.values()][0].input;
    expect(svc.current('demo')).toEqual({ place: 'stats', params: { list: 'overdue' } });
    expect(shown.at(-1)).toEqual({ place: 'stats', params: { list: 'overdue' } });
    expect(tab.place).toBe('parallx://place/demo/stats?list=overdue');
    expect(tab.trail?.at(-1)?.address).toBe('parallx://place/demo/stats?list=overdue');
  });

  it('an unknown place opens the tool\'s first, and a tool that went opens nothing', async () => {
    expect(await svc.openAddress('parallx://place/demo/nowhere')).toBe(true);
    expect([...h.tabs.values()][0].input.name).toBe('Home');
    expect(await svc.openAddress('parallx://place/other/home')).toBe(false);
  });
  it('a step that is a thing, not a place, opens what it names from its crumb, and the tab stays where it is', async () => {
    const svc2 = new PlacesService();
    const h2 = makeHost(() => svc2);
    const opened: boolean[] = [];
    svc2.register('tool', {
      id: 'demo', title: 'Demo', icon: 'calendar',
      places: [{ id: 'home', title: 'Home' }, { id: 'stats', title: 'Stats' }],
      trailOf: (loc) => [{ label: 'Summer', open: (o) => { opened.push(o.newTab); } }, { label: 'Stats', location: loc }],
      createView: () => ({ show() { /* drawn */ }, dispose() { /* nothing */ } }),
    }, h2.host);
    await svc2.open('demo', { place: 'stats' });
    const tab = [...h2.tabs.values()][0].input;
    expect(tab.trail?.map((c) => c.label)).toEqual(['Demo', 'Summer', 'Stats']);
    expect(tab.trail?.[1].address).toBeUndefined();
    tab.trail?.[1].open?.({ newTab: false });
    tab.trail?.[1].open?.({ newTab: true });
    expect(opened).toEqual([false, true]);
    expect(svc2.current('demo')).toEqual({ place: 'stats' });
    expect(h2.tabs.size).toBe(1);
  });

  it('a place tab keeps its view\'s own state across a switch of tabs', () => {
    const svc2 = new PlacesService();
    const h2 = makeHost(() => svc2);
    const restored: unknown[] = [];
    svc2.register('tool', {
      id: 'demo', title: 'Demo', icon: 'calendar',
      places: [{ id: 'home', title: 'Home' }],
      createView: () => ({ show() { /* drawn */ }, dispose() { /* nothing */ }, saveViewState: () => ({ scrollTop: 120 }), restoreViewState: (st) => { restored.push(st); } }),
    }, h2.host);
    const pane = svc2.createPane('demo', document.createElement('div'), new FakeInput('tool:demo:main'));
    expect(pane.saveViewState?.()).toEqual({ scrollTop: 120 });
    pane.restoreViewState?.({ scrollTop: 120 });
    pane.restoreViewState?.(undefined);
    expect(restored).toEqual([{ scrollTop: 120 }]);
  });
});
