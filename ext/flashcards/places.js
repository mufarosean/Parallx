// places.js — Flashcards' places (the core's `api.places`): its screens share
// ONE tab, named for the screen, with Flashcards' icon; the core keeps the
// tab, the trail in the bar under the tabs (`Flashcards › Exam 7 › Study`),
// the address (parallx://place/flashcards/deck?deck=3&q=mack), Back and
// Forward, and where the keys land (the page header's title). Flashcards has
// no things: a study session is drawn in the Study place, as before.
//
// The pane in main.js still draws a route ({ view: 'browse', deckId: 3 });
// this module turns a route into a place and back. A move made inside the
// page carries its whole route (an Add Card form to open, a custom session's
// filters) to the drawing; the address keeps what Back and a restart need.

export const FC_PLACES_ID = 'flashcards';

/**
 * The tool's top-level destinations, in the column's order. The column owns
 * this navigation; the trail in the bar under the tabs says where you are.
 */
export const FC_NAV_DEFS = [
  { view: 'decks', label: 'Decks', iconName: 'layers' },
  { view: 'study', label: 'Study', iconName: 'play' },
  { view: 'stats', label: 'Stats', iconName: 'chart-column' },
  { view: 'create', label: 'Make Cards', iconName: 'px-ai-mark' },
  { view: 'import', label: 'Import', iconName: 'inbox' },
];

/** Human names for EVERY route, the tab's and the trail's (and the page's title where it has no other). */
export const FC_VIEW_LABELS = {
  decks: 'Decks',
  study: 'Study',
  create: 'Make Cards',
  import: 'Import',
  stats: 'Stats',
  browse: 'Browse Cards',
  custom: 'Custom Study',
  customDeck: 'Custom Deck',
  dedup: 'Find Duplicates',
  coverage: 'Coverage Review',
};

/** Views that live UNDER one deck: the trail names the deck before them. */
export const FC_DECK_VIEWS = ['browse', 'dedup', 'coverage'];

/** Which column destination a route belongs to. Custom Study is a launcher for Study. */
export function fcNavViewFor(route) {
  const view = route?.view || 'decks';
  if (FC_DECK_VIEWS.includes(view)) return 'decks';
  if (view === 'custom') return 'study';
  if (view === 'customDeck') return 'decks';
  return view;
}

/** Each route's place: its id in the address. A deck's Browse is the deck's place. */
const PLACE_OF_VIEW = {
  decks: 'decks', browse: 'deck', study: 'study', stats: 'stats', create: 'make', import: 'import',
  custom: 'custom', customDeck: 'custom-deck', dedup: 'duplicates', coverage: 'coverage',
};
const VIEW_OF_PLACE = Object.fromEntries(Object.entries(PLACE_OF_VIEW).map(([v, p]) => [p, v]));

/** Flashcards' places; the first is where the tool opens. */
export const FC_PLACES = Object.entries(PLACE_OF_VIEW).map(([view, id]) => ({ id, title: view === 'browse' ? 'Deck' : FC_VIEW_LABELS[view] }));

const NUM = /^\d+$/;
const idOf = (v) => (NUM.test(String(v ?? '')) ? Number(v) : null);

/** The place a route is ({ place, params }). Only what an address can carry rides in it. */
export function fcPlaceOfRoute(route) {
  const view = PLACE_OF_VIEW[route?.view] ? route.view : 'decks';
  const params = {};
  if (route?.deckId != null && idOf(route.deckId) != null) params.deck = String(route.deckId);
  if (view === 'customDeck' && idOf(route.customId) != null) params.id = String(route.customId);
  if (view === 'browse' && typeof route.search === 'string' && route.search) params.q = route.search;
  if (view === 'study' && route.tag) params.tag = String(route.tag).trim().toLowerCase();
  if (view === 'study' && route.custom && typeof route.custom === 'object') params.custom = JSON.stringify(route.custom);
  const place = PLACE_OF_VIEW[view];
  return Object.keys(params).length ? { place, params } : { place };
}

/** The route a place draws (Decks for one it cannot read: a deck's place with no deck). */
export function fcRouteOfPlace(location) {
  const view = VIEW_OF_PLACE[location?.place] || 'decks';
  const p = location?.params || {};
  const route = { view };
  const deckId = idOf(p.deck);
  if (deckId != null) route.deckId = deckId;
  if ((view === 'browse' || view === 'dedup' || view === 'coverage') && deckId == null) return { view: 'decks' };
  if (view === 'customDeck') {
    const id = idOf(p.id);
    if (id == null) return { view: 'decks' };
    route.customId = id;
  }
  if (view === 'browse' && p.q) route.search = String(p.q);
  if (view === 'study' && p.tag) route.tag = String(p.tag);
  if (view === 'study' && p.custom) {
    try { const custom = JSON.parse(p.custom); if (custom && typeof custom === 'object' && typeof custom.mode === 'string') route.custom = custom; } catch { /* a session without its filters: the day's study */ }
  }
  return route;
}

/**
 * The column's row for a route: the deepest row its trail passes through. A
 * deck's screens mark the deck's row, a custom deck's (its page, its study)
 * the custom deck's row, the rest their destination ('nav:study').
 */
export function fcMarkKeyOf(route, customByTag) {
  if (!route) return '';
  if (route.view === 'customDeck' && route.customId != null) return `custom:${route.customId}`;
  if (route.view === 'study' && route.tag) {
    const custom = customByTag(String(route.tag).toLowerCase());
    if (custom) return `custom:${custom.id}`;
  }
  if (route.deckId != null) return `deck:${route.deckId}`;
  return `nav:${fcNavViewFor(route)}`;
}

// ── Names ──────────────────────────────────────────────────────────────────
// Decks' and custom decks' names, read from the database; the tab and the
// trail are named from here (titleOf is asked synchronously).

const deckNames = new Map();
const customDecks = new Map();
const customOfTag = (tag) => [...customDecks.values()].find((c) => c.tag === tag) || null;
export const fcPlaceCustomOfTag = customOfTag;

/** Take the names read ({ decks: [{ id, name }], customs: [{ id, name, tag }] }). */
function takeNames({ decks = [], customs = [] } = {}) {
  deckNames.clear();
  for (const d of decks) deckNames.set(Number(d.id), String(d.name));
  customDecks.clear();
  for (const c of customs) customDecks.set(Number(c.id), { id: Number(c.id), name: String(c.name), tag: String(c.tag || '').toLowerCase() });
}

function titleOf(location) {
  const route = fcRouteOfPlace(location);
  if (route.view === 'browse') return deckNames.get(route.deckId) || 'Deck';
  if (route.view === 'customDeck') return customDecks.get(route.customId)?.name || FC_VIEW_LABELS.customDeck;
  return FC_VIEW_LABELS[route.view] || FC_VIEW_LABELS.decks;
}

/** The trail after Flashcards: the deck (or custom deck) a screen sits under, then the screen. */
function trailOf(location) {
  const route = fcRouteOfPlace(location);
  const here = { label: titleOf(location), location };
  const steps = [];
  const custom = route.view === 'study' && route.tag ? customOfTag(String(route.tag).toLowerCase()) : null;
  if (custom) steps.push({ label: custom.name, location: fcPlaceOfRoute({ view: 'customDeck', customId: custom.id }) });
  if (route.deckId != null && route.view !== 'browse' && deckNames.has(route.deckId)) {
    steps.push({ label: deckNames.get(route.deckId), location: fcPlaceOfRoute({ view: 'browse', deckId: route.deckId }) });
  }
  return [...steps, here];
}

/** What the tab and the trail of a location say, to see when a name read later changed them. */
const wordsOf = (location) => JSON.stringify(trailOf(location).map((s) => s.label));

// ── Going there ────────────────────────────────────────────────────────────

/** The whole route of a move made by Flashcards itself, by the address it goes to (read once by the drawing). */
const carried = new Map();

function placesOn(api) {
  return !!(api && api.places && typeof api.places.open === 'function' && registered);
}
let registered = false;

/** True when Flashcards' screens are places (the host has the point and they are registered). */
export function fcPlacesOn(api) { return placesOn(api); }

/** A route's address, for a link or a row (Ctrl+click, its menu). */
export function fcPlaceAddress(api, route) {
  return placesOn(api) ? api.places.addressOf(FC_PLACES_ID, fcPlaceOfRoute(route)) : '';
}

function carry(api, route) {
  const location = fcPlaceOfRoute(route);
  carried.set(api.places.addressOf(FC_PLACES_ID, location), route);
  return location;
}

/** Go to a route's place, in Flashcards' one tab (with `newTab`, a tab of its own). No route: the tab as it is. */
export function fcOpenPlace(api, route, options) {
  if (!placesOn(api)) return Promise.resolve(false);
  const newTab = options && options.newTab ? { newTab: true } : undefined;
  if (!route) return api.places.open({ tool: FC_PLACES_ID }, newTab);
  const location = carry(api, route);
  return api.places.open({ tool: FC_PLACES_ID, place: location.place, ...(location.params ? { params: location.params } : {}) }, newTab);
}

/** Open in Its Own Tab, for a row's own menu (a deck's, a custom deck's). */
export function fcPlaceMenuItems(api, route) {
  return placesOn(api) ? [{ label: 'Open in Its Own Tab', icon: 'external-link', onSelect: () => void fcOpenPlace(api, route, { newTab: true }) }, { separator: true }] : [];
}

/** A column row that goes to a route's place: Ctrl+click opens it in a tab of its own; `menu: false` keeps the row's own menu. */
export function fcBindPlaceLink(api, element, route, options) {
  if (!element || !placesOn(api) || typeof api.ui.bindPlaceLink !== 'function') return { dispose() {} };
  return api.ui.bindPlaceLink(element, fcPlaceAddress(api, route), options);
}

/** The route of the place Flashcards' tab (in front, or last in front) shows; null with no tab. */
export function fcCurrentRoute(api) {
  if (!placesOn(api) || typeof api.places.current !== 'function') return null;
  const at = api.places.current(FC_PLACES_ID);
  return at ? fcRouteOfPlace(at) : null;
}

// ── The view ───────────────────────────────────────────────────────────────

class FlashcardsPlaceView {
  constructor(container, host, api, h) {
    this._container = container;
    this._host = host;
    this._api = api;
    this._h = h;
    this._pane = null;
    this._location = null;
    this._words = '';
    // A name read after the tab was drawn (a deck renamed, the names read at start) renames the tab and the trail.
    this._offNames = h.onNames(() => {
      const at = this._location;
      if (!at || wordsOf(at) === this._words) return;
      this._words = wordsOf(at);
      this._host.replace(at);
    });
  }

  async show(location) {
    const address = this._api.places.addressOf(FC_PLACES_ID, location);
    const route = carried.get(address) || fcRouteOfPlace(location);
    carried.delete(address);
    this._location = location;
    this._words = wordsOf(location);
    // The page's own moves go through the core, so the tab is named, the trail drawn and the move is a step of Back.
    const go = (next) => { const at = carry(this._api, next); this._host.go(at); };
    // Resolves once the page is drawn, its title with it: the core then puts the keys there.
    if (!this._pane) { this._pane = this._h.createPane(this._container, route, go); await this._pane.ready; }
    else await this._pane.show(route);
  }

  /** The page's scroll, kept by the editor area across a switch of tabs. */
  saveViewState() {
    try { return this._pane && this._pane.saveViewState ? this._pane.saveViewState() : undefined; } catch { return undefined; }
  }

  restoreViewState(state) {
    // The older build kept the screen in the tab's state ({ route }); it comes back as that place, drawn and recorded without a move.
    if (state && state.route && state.route.view && this._pane) {
      const location = fcPlaceOfRoute(state.route);
      if (this._api.places.addressOf(FC_PLACES_ID, location) !== this._api.places.addressOf(FC_PLACES_ID, this._location || { place: 'decks' })) {
        this._location = location;
        this._words = wordsOf(location);
        void this._pane.show(fcRouteOfPlace(location));
        this._host.replace(location);
      }
      return;
    }
    try { if (this._pane && this._pane.restoreViewState) this._pane.restoreViewState(state); } catch { /* drawn as it is */ }
  }

  dispose() {
    try { this._offNames.dispose(); } catch { /* gone */ }
    const pane = this._pane;
    this._pane = null;
    if (pane) { try { pane.dispose(); } catch (err) { console.warn('[Flashcards] a place failed to close:', err); } }
    this._container.replaceChildren();
  }
}

/**
 * Register Flashcards' places. h: {
 *   createPane(container, route, go) -> pane { ready, show(route), dispose(), saveViewState(), restoreViewState(state) }:
 *     the pane draws `route` (`ready` and `show` resolve once it is drawn), and sends the page's own moves to `go(route)`;
 *   readNames() -> Promise<{ decks, customs }>: the decks' and custom decks' names;
 *   onData(listener) -> disposable: hears every change to Flashcards' data;
 * }
 * Returns the disposables, or [] on a host without the places point.
 */
export function fcPlacesActivate(api, h) {
  if (!api.places || typeof api.places.register !== 'function') return [];
  const listeners = new Set();
  const onNames = (fn) => { listeners.add(fn); return { dispose: () => { listeners.delete(fn); } }; };
  const read = async () => {
    try { takeNames(await h.readNames()); } catch { return; }
    for (const fn of [...listeners]) { try { fn(); } catch { /* the rest still hear */ } }
  };
  void read();
  const offData = h.onData(() => void read());
  const registration = api.places.register({
    id: FC_PLACES_ID,
    title: 'Flashcards',
    icon: 'px-flashcards',
    // The tab keeps its editor type, so a tab the older build saved (always `main`) comes back as a place: Decks.
    editorType: 'flashcards',
    places: FC_PLACES,
    titleOf,
    trailOf,
    createView: (container, host) => new FlashcardsPlaceView(container, host, api, { ...h, onNames }),
  });
  registered = true;
  return [registration, offData, { dispose: () => { registered = false; listeners.clear(); carried.clear(); } }];
}

/** For the column: hear where Flashcards' tab is (a move, or another of its tabs in front). */
export function fcOnPlaceMove(api, listener) {
  if (!placesOn(api) || typeof api.places.onDidMove !== 'function') return { dispose() {} };
  return api.places.onDidMove((e) => { if (e.tool === FC_PLACES_ID) listener(fcRouteOfPlace(e.location)); });
}
