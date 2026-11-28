// @vitest-environment jsdom
// moPlaces.test.ts — Atelier's places (ext/media-organizer/atelier-places.js):
// every screen an older build opened as its own tab maps to a place and back
// to what draws it; things (an album, a board, a practice run) stay things; a
// photo's detail sits over the list it was opened from (an album's crumb opens
// the album); a step inside a plan or a sheet is a crumb, and a move that only
// changes the step does not draw the page again.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { moInstanceOfPlace, moPlaceName, moPlaceOfInstance, moPlacesActivate, moRowOfPlace } from '../../ext/media-organizer/atelier-places.js';

type Loc = { place: string; params?: Record<string, string> };
type Step = { label: string; location?: Loc; open?: (o: { newTab: boolean }) => void };
interface Contribution {
  id: string; editorType: string;
  places: { id: string }[];
  formerTabs: { editorType: string; placeOf(id: string): Loc | undefined };
  titleOf(l: Loc): string;
  trailOf(l: Loc): Step[];
  createView(c: HTMLElement, host: { go(l: Loc): void; replace(l: Loc): void }): { show(l: Loc): Promise<void>; dispose(): void };
}

function activate(h: Record<string, unknown> = {}) {
  let got: Contribution | undefined;
  const api = { places: { register: (c: Contribution) => { got = c; return { dispose() { /* gone */ } }; } } };
  const albums: number[] = [];
  moPlacesActivate(api, { db: { get: async () => null }, render: () => ({ dispose() { /* gone */ } }), renderDaily: () => ({ dispose() { /* gone */ } }), openAlbum: (id: number) => albums.push(id), ...h });
  return { c: got!, albums };
}

describe('Atelier\'s places', () => {
  it('each screen an older build gave a tab of its own is a place, drawn by what drew that tab', () => {
    const screens = ['grid:all', 'grid:favorites', 'grid:recent', 'grid:untagged', 'grid:trash', 'grid:tag:5-12', 'grid:folder:3', 'grid:smart:4',
      'tag-review', 'duplicates', 'practice:setup', 'plans:list', 'colour:list', 'detail:photo:42', 'detail:video:7', 'plans:edit:9', 'colour:sheet:2'];
    for (const id of screens) {
      const at = moPlaceOfInstance(id);
      expect(at, id).toBeTruthy();
      expect(moInstanceOfPlace(at), id).toBe(id);
    }
    expect(moPlaceOfInstance('grid:home')).toEqual({ place: 'all' });
    expect(moPlaceOfInstance('grid:videos')).toEqual({ place: 'all', params: { media: 'videos' } });
  });

  it('things keep tabs of their own: an album, a board, a practice run, a new album, the bulk page', () => {
    for (const id of ['album:1', 'album:new', 'plans:board:3', 'practice:run:8', 'bulk-remove']) expect(moPlaceOfInstance(id), id).toBeUndefined();
    const { c } = activate();
    expect(c.formerTabs.editorType).toBe('media-organizer-grid');
    expect(c.editorType).not.toBe('media-organizer-grid');
    expect(c.formerTabs.placeOf('album:1')).toBeUndefined();
    expect(c.formerTabs.placeOf('grid:favorites')).toEqual({ place: 'favorites' });
  });

  it('a photo\'s detail sits over its list: All Media by default, the album it was opened from (whose crumb opens the album)', () => {
    const { c, albums } = activate();
    moPlaceName('photo', 42, 'card');
    moPlaceName('album', 1, 'Summer');
    expect(c.trailOf({ place: 'detail', params: { type: 'photo', id: '42' } }).map((s) => s.label)).toEqual(['All Media', 'card']);
    const fromAlbum = c.trailOf({ place: 'detail', params: { type: 'photo', id: '42', in: 'album:1' } });
    expect(fromAlbum.map((s) => s.label)).toEqual(['Summer', 'card']);
    expect(fromAlbum[0].location).toBeUndefined();
    fromAlbum[0].open?.({ newTab: false });
    expect(albums).toEqual([1]);
    expect(c.titleOf({ place: 'detail', params: { type: 'photo', id: '42' } })).toBe('card');
    // The column marks the list it sits over.
    expect(moRowOfPlace({ place: 'detail', params: { type: 'photo', id: '42', in: 'grid:favorites' } })).toBe('grid:favorites');
    expect(moRowOfPlace({ place: 'detail', params: { type: 'photo', id: '42', in: 'album:1' } })).toBe('album:1');
    expect(moRowOfPlace({ place: 'plan', params: { id: '9' } })).toBe('plans:list');
  });

  it('a step inside a plan is a crumb; a move to or from it does not draw the page again, it asks the page for the step', async () => {
    const drawn: string[] = [];
    const { c } = activate({ render: (_c: HTMLElement, input: { instanceId: string }) => { drawn.push(input.instanceId); return { dispose() { /* gone */ } }; } });
    moPlaceName('plan', 9, 'fractal');
    expect(c.trailOf({ place: 'plan', params: { id: '9', step: 'paints' } }).map((s) => s.label)).toEqual(['Painting Plans', 'fractal', 'My Paints']);
    const container = document.createElement('div');
    const replaced: Loc[] = [];
    const view = c.createView(container, { go() { /* not used */ }, replace: (l) => replaced.push(l) });
    void view.show({ place: 'plan', params: { id: '9' } });
    const page = document.createElement('div');
    page.dataset.moSteps = 'plan';
    const asked: string[] = [];
    page.addEventListener('mo:place-to', (e) => asked.push((e as CustomEvent).detail.step));
    container.appendChild(page);
    // The page opened My Paints: recorded, not drawn again.
    page.dispatchEvent(new CustomEvent('mo:place-step', { bubbles: true, detail: { step: 'paints' } }));
    expect(replaced.at(-1)).toEqual({ place: 'plan', params: { id: '9', step: 'paints' } });
    // The crumb before (or Back): the page is asked for the colours, not drawn again.
    void view.show({ place: 'plan', params: { id: '9' } });
    expect(asked).toEqual(['']);
    expect(drawn).toEqual(['plans:edit:9']);
    view.dispose();
  });
});
