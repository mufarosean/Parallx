// atelier-places.js — Atelier's places (the core's `api.places`): its screens
// share ONE tab, named for the screen, with Atelier's icon; the core keeps the
// tab, the trail in the bar under the tabs, the address
// (parallx://place/media-organizer/tag?path=5-12), Back and Forward, and where
// the keys land. A thing (an album, a painting plan's board, a practice
// session being run, the clip and image editors) keeps a tab of its own. A
// plan being worked on and a colour sheet are places over their lists, so the
// steps inside them (My Paints, the mix) are crumbs of the trail.
//
// Each place is drawn by the same code that drew its tab before (main.js hands
// in `h.render`, its old editor pane for an instance id), so a place and the
// tab an older build saved for it draw alike.

export const MO_PLACES_ID = 'media-organizer';
/** The editor type of the one place tab; the things keep `media-organizer-grid`. */
export const MO_PLACE_TYPE = 'media-organizer-place';
const FORMER_TYPE = 'media-organizer-grid';

/** Atelier's places; the first is where the tool opens. */
export const MO_PLACES = [
  { id: 'all', title: 'All Media' },
  { id: 'favorites', title: 'Favorites' },
  { id: 'recent', title: 'Recent' },
  { id: 'untagged', title: 'Untagged' },
  { id: 'tag-review', title: 'Tag Review' },
  { id: 'duplicates', title: 'Duplicates' },
  { id: 'daily', title: 'Daily Study' },
  { id: 'practice', title: 'Practice Session' },
  { id: 'plans', title: 'Painting Plans' },
  { id: 'colour', title: 'Colour Study' },
  { id: 'trash', title: 'Trash' },
  { id: 'tag', title: 'Tag' },
  { id: 'folder', title: 'Folder' },
  { id: 'smart', title: 'Smart Album' },
  { id: 'detail', title: 'Photo' },
  { id: 'plan', title: 'Painting Plan' },
  { id: 'sheet', title: 'Colour Sheet' },
];

/** The steps inside a place that the trail names: a panel that takes the page's place. */
const STEPS = { plan: { paints: 'My Paints' }, sheet: { bench: 'The Mix', paints: 'My Paints' } };

const FIXED_GRIDS = new Set(['all', 'favorites', 'recent', 'untagged', 'trash']);
const NUM = /^\d+$/;
const PATH = /^\d+(-\d+)*$/;

/** The place an older tab's instance id named (`grid:favorites`, `detail:photo:42`), or undefined for a thing. */
export function moPlaceOfInstance(instanceId) {
  const id = String(instanceId || '');
  if (id === 'tag-review' || id === 'duplicates' || id === 'daily') return { place: id };
  if (id === 'practice:setup') return { place: 'practice' };
  if (id === 'plans:list') return { place: 'plans' };
  if (id === 'colour:list') return { place: 'colour' };
  const plan = /^plans:edit:(\d+)$/.exec(id);
  if (plan) return { place: 'plan', params: { id: plan[1] } };
  const sheet = /^colour:sheet:(\d+)$/.exec(id);
  if (sheet) return { place: 'sheet', params: { id: sheet[1] } };
  const d = /^detail:(photo|video):(\d+)$/.exec(id);
  if (d) return { place: 'detail', params: { type: d[1], id: d[2] } };
  if (!id.startsWith('grid:')) return undefined;
  const raw = id.slice('grid:'.length);
  const at = raw.indexOf(':');
  const kind = at < 0 ? raw : raw.slice(0, at);
  const arg = at < 0 ? '' : raw.slice(at + 1);
  if (FIXED_GRIDS.has(kind)) return { place: kind };
  if (kind === '' || kind === 'home') return { place: 'all' };
  if (kind === 'photos' || kind === 'gifs' || kind === 'videos') return { place: 'all', params: { media: kind } };
  if (kind === 'duplicates') return { place: 'duplicates' };
  if (kind === 'tag' && PATH.test(arg)) return { place: 'tag', params: { path: arg } };
  if (kind === 'folder' && NUM.test(arg)) return { place: 'folder', params: { id: arg } };
  if (kind === 'smart' && NUM.test(arg)) return { place: 'smart', params: { id: arg } };
  return { place: 'all' };
}

/** The instance id the old tab of a place had: what its drawing is given. */
export function moInstanceOfPlace(location) {
  const p = (location && location.params) || {};
  switch (location && location.place) {
    case 'tag-review': case 'duplicates': return location.place;
    case 'practice': return 'practice:setup';
    case 'plans': return 'plans:list';
    case 'colour': return 'colour:list';
    case 'plan': return `plans:edit:${NUM.test(p.id || '') ? p.id : '0'}`;
    case 'sheet': return `colour:sheet:${NUM.test(p.id || '') ? p.id : '0'}`;
    case 'detail': return `detail:${p.type === 'video' ? 'video' : 'photo'}:${NUM.test(p.id || '') ? p.id : '0'}`;
    case 'tag': return PATH.test(p.path || '') ? `grid:tag:${p.path}` : 'grid:all';
    case 'folder': return NUM.test(p.id || '') ? `grid:folder:${p.id}` : 'grid:all';
    case 'smart': return NUM.test(p.id || '') ? `grid:smart:${p.id}` : 'grid:all';
    case 'all': return p.media === 'photos' || p.media === 'gifs' || p.media === 'videos' ? `grid:${p.media}` : 'grid:all';
    default: return FIXED_GRIDS.has(location && location.place) ? `grid:${location.place}` : 'grid:all';
  }
}

/** The column's row (its `data-view`) for a location: a photo's detail marks the list it sits over, a plan Painting Plans. */
export function moRowOfPlace(location) {
  if (!location) return '';
  const p = location.params || {};
  if (location.place === 'detail') {
    const from = String(p.in || '');
    if (/^album:\d+$/.test(from)) return from;
    const list = moPlaceOfInstance(from);
    return moRowOfPlace(list && list.place !== 'detail' ? list : { place: 'all' });
  }
  if (location.place === 'plan') return 'plans:list';
  if (location.place === 'sheet') return 'colour:list';
  if (location.place === 'daily') return 'daily';
  if (location.place === 'all') return 'grid:all';
  return moInstanceOfPlace(location);
}

// ── Names ──────────────────────────────────────────────────────────────────
// A tag's, folder's, smart album's, album's or item's name, once read; the tab
// and the trail are named from here (titleOf is asked synchronously).

const names = new Map();
const nameKey = (kind, id) => `${kind}:${id}`;
/** Tell the places a name already known (a sidebar row's), so a tab opened from it is named at once. */
export function moPlaceName(kind, id, name) { if (name) names.set(nameKey(kind, String(id)), String(name)); }

const ITEM_NAME = (kind) => `SELECT COALESCE(NULLIF(x.title, ''), f.basename) AS n FROM mo_${kind}s x LEFT JOIN mo_files f ON f.id = (SELECT file_id FROM mo_${kind}s_files WHERE ${kind}_id = x.id ORDER BY is_primary DESC LIMIT 1) WHERE x.id = ?`;
const NAME_SQL = {
  tag: 'SELECT name AS n FROM mo_tags WHERE id = ?',
  folder: 'SELECT path AS n FROM mo_folders WHERE id = ?',
  smart: 'SELECT name AS n FROM mo_smart_albums WHERE id = ?',
  album: 'SELECT title AS n FROM mo_albums WHERE id = ?',
  plan: 'SELECT title AS n FROM mo_plans WHERE id = ?',
  sheet: 'SELECT title AS n FROM mo_colour_sheets WHERE id = ?',
  photo: ITEM_NAME('photo'),
  video: ITEM_NAME('video'),
};
/** A thing's name as the library has it: a folder by the last part of its path. */
async function nameFromDb(db, kind, id) {
  const sql = NAME_SQL[kind];
  const row = sql ? await db.get(sql, [id]) : null;
  const n = row && row.n ? String(row.n) : '';
  return kind === 'folder' ? (n.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || n) : n;
}

function leafOf(path) { const parts = String(path || '').split('-'); return parts[parts.length - 1] || ''; }

function titleOf(location) {
  const p = location.params || {};
  switch (location.place) {
    case 'tag': return names.get(nameKey('tag', leafOf(p.path))) || 'Tag';
    case 'folder': return names.get(nameKey('folder', p.id)) || 'Folder';
    case 'smart': return names.get(nameKey('smart', p.id)) || 'Smart Album';
    case 'detail': return names.get(nameKey(p.type === 'video' ? 'video' : 'photo', p.id)) || (p.type === 'video' ? 'Video' : 'Photo');
    case 'plan': return names.get(nameKey('plan', p.id)) || 'Painting Plan';
    case 'sheet': return names.get(nameKey('sheet', p.id)) || 'Colour Sheet';
    default: return (MO_PLACES.find((x) => x.id === location.place) || MO_PLACES[0]).title;
  }
}

// The list a photo's detail sits over (`in`, the instance id of where it was opened).
function listOf(detail, h) {
  const from = String((detail.params && detail.params.in) || '');
  const album = /^album:(\d+)$/.exec(from);
  if (album) {
    const id = album[1];
    return { label: names.get(nameKey('album', id)) || 'Album', open: (o) => h.openAlbum(Number(id), o) };
  }
  const place = moPlaceOfInstance(from);
  const location = place && place.place !== 'detail' ? place : { place: 'all' };
  return { label: titleOf(location), location };
}

function trailOf(location, h) {
  const p = location.params || {};
  if (location.place === 'detail') return [listOf(location, h), { label: titleOf(location), location }];
  if (location.place === 'plan' || location.place === 'sheet') {
    const list = location.place === 'plan' ? { place: 'plans' } : { place: 'colour' };
    const base = { place: location.place, params: { id: p.id } };
    const steps = [{ label: titleOf(list), location: list }, { label: titleOf(base), location: base }];
    const step = STEPS[location.place][p.step];
    if (step) steps.push({ label: step, location });
    return steps;
  }
  return [{ label: titleOf(location), location }];
}

/** Read the names a location's tab and trail show; true when one was new. */
async function readNames(location, h) {
  const p = location.params || {};
  const want = [];
  if (location.place === 'tag') want.push(['tag', leafOf(p.path)]);
  if (location.place === 'folder') want.push(['folder', p.id]);
  if (location.place === 'smart') want.push(['smart', p.id]);
  if (location.place === 'plan' || location.place === 'sheet') want.push([location.place, p.id]);
  if (location.place === 'detail') {
    want.push([p.type === 'video' ? 'video' : 'photo', p.id]);
    const from = String(p.in || '');
    const m = /^(album):(\d+)$/.exec(from) || /^grid:(smart|folder):(\d+)$/.exec(from);
    if (m) want.push([m[1], m[2]]);
    const thing = /^(plans:edit|colour:sheet):(\d+)$/.exec(from);
    if (thing) want.push([thing[1] === 'plans:edit' ? 'plan' : 'sheet', thing[2]]);
    const t = /^grid:tag:([\d-]+)$/.exec(from);
    if (t) want.push(['tag', leafOf(t[1])]);
  }
  let fresh = false;
  for (const [kind, id] of want) {
    if (!id || !NUM.test(String(id))) continue;
    let name = '';
    try { name = await nameFromDb(h.db, kind, Number(id)); } catch { name = ''; }
    if (name && names.get(nameKey(kind, id)) !== name) { names.set(nameKey(kind, id), name); fresh = true; }
  }
  return fresh;
}

// ── The view ───────────────────────────────────────────────────────────────

/** Resolves once the page's kit title is drawn (a page drawn after its data loads), or after a while regardless. */
function titleDrawn(container, isStillWanted) {
  const has = () => !!container.querySelector('.px-page-header__title');
  if (has()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { observer.disconnect(); clearTimeout(timer); resolve(); };
    const observer = new MutationObserver(() => { if (has() || !isStillWanted()) done(); });
    observer.observe(container, { childList: true, subtree: true });
    const timer = setTimeout(done, 4000);
  });
}

/** What decides the drawing: a move that keeps it (a step inside a plan, the list a photo sits over) does not draw again. */
function drawKeyOf(location) {
  const p = location.params || {};
  return location.place === 'daily' ? `daily:${p.session || ''}` : moInstanceOfPlace(location);
}
const stepOf = (location) => (location.params && location.params.step) || '';
function withStep(location, step) {
  const params = { ...(location.params || {}) };
  if (step) params.step = step; else delete params.step;
  return Object.keys(params).length ? { place: location.place, params } : { place: location.place };
}

class AtelierPlaceView {
  constructor(container, host, h) {
    this._container = container;
    this._host = host;
    this._h = h;
    this._pane = null;
    this._shown = '';
    this._location = null;
    this._seq = 0;
    // A step inside the page (My Paints, the mix) is recorded in the address and the trail, without a redraw.
    this._onStep = (e) => {
      const at = this._location;
      const step = String((e.detail && e.detail.step) || '');
      if (!at || !STEPS[at.place] || stepOf(at) === step) return;
      const next = withStep(at, STEPS[at.place][step] ? step : '');
      this._location = next;
      this._host.replace(next);
    };
    container.addEventListener('mo:place-step', this._onStep);
  }

  async show(location) {
    const seq = ++this._seq;
    const key = drawKeyOf(location);
    if (key !== this._shown || !this._pane) {
      this._close();
      this._shown = key;
      this._location = location;
      this._pane = location.place === 'daily'
        ? this._h.renderDaily(this._container, location)
        : this._h.render(this._container, { instanceId: moInstanceOfPlace(location), place: location });
      if (stepOf(location)) this._toStep(stepOf(location));
    } else {
      const was = this._location;
      this._location = location;
      if (!was || stepOf(was) !== stepOf(location)) this._toStep(stepOf(location));
    }
    void readNames(location, this._h).then((fresh) => {
      // The tab and the trail take the names read; the page is not drawn again.
      if (fresh && seq === this._seq) this._host.replace(location);
    });
    await titleDrawn(this._container, () => seq === this._seq);
  }

  /** The drawing's own state (a grid's scroll), kept by the editor area across a switch of tabs. */
  saveViewState() {
    const pane = this._pane;
    if (!pane || typeof pane.saveViewState !== 'function') return undefined;
    try { return { key: this._shown, state: pane.saveViewState() }; } catch { return undefined; }
  }

  restoreViewState(saved) {
    const pane = this._pane;
    if (!saved || saved.key !== this._shown || !pane || typeof pane.restoreViewState !== 'function') return;
    try { pane.restoreViewState(saved.state); } catch { /* drawn as it is */ }
  }

  /** Ask the page to show a step ('' = none): each part that keeps steps listens on its own element. */
  _toStep(step) {
    for (const el of this._container.querySelectorAll('[data-mo-steps]')) el.dispatchEvent(new CustomEvent('mo:place-to', { detail: { step } }));
  }

  _close() {
    const pane = this._pane;
    this._pane = null;
    if (pane) { try { pane.dispose(); } catch (err) { console.warn('[Atelier] a place failed to close:', err); } }
    this._container.replaceChildren();
  }

  dispose() {
    this._seq++;
    this._container.removeEventListener('mo:place-step', this._onStep);
    this._close();
  }
}

/**
 * Register Atelier's places. h: {
 *   render(container, input) -> pane: the old editor pane for `input.instanceId`;
 *   renderDaily(container, location) -> pane: today's Daily Study;
 *   db: Atelier's database, to read names (a tag's, an album's, a photo's) from;
 *   openAlbum(id, { newTab }): an album's own tab (the crumb a photo opened from it sits under);
 * }
 */
export function moPlacesActivate(api, h) {
  if (!api.places || typeof api.places.register !== 'function') return [];
  return [api.places.register({
    id: MO_PLACES_ID,
    title: 'Atelier',
    icon: 'px-media',
    editorType: MO_PLACE_TYPE,
    places: MO_PLACES,
    // The older build opened a tab per screen, all of them `media-organizer-grid`.
    formerTabs: { editorType: FORMER_TYPE, placeOf: (instanceId) => moPlaceOfInstance(instanceId) },
    titleOf,
    trailOf: (location) => trailOf(location, h),
    createView: (container, host) => new AtelierPlaceView(container, host, h),
  })];
}

/** Go to one of Atelier's places, in its one tab (with `newTab`, a tab of its own). */
export function moOpenPlace(api, place, params, options) {
  const clean = {};
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') clean[k] = String(v);
  if (!api || !api.places || typeof api.places.open !== 'function') return Promise.resolve(false);
  return api.places.open({ tool: MO_PLACES_ID, place, ...(Object.keys(clean).length ? { params: clean } : {}) }, options);
}

/** Open the place an old instance id named (`grid:favorites`); false when it names a thing. */
export function moOpenInstance(api, instanceId, options) {
  const location = moPlaceOfInstance(instanceId);
  if (!location) return false;
  void moOpenPlace(api, location.place, location.params, options);
  return true;
}

/** A photo's or video's detail, over the list it was opened from (`from`: that list's instance id). */
export function moOpenItem(api, type, id, from, title) {
  if (title) moPlaceName(type === 'video' ? 'video' : 'photo', id, title);
  const fromPlace = from ? moPlaceOfInstance(from) : undefined;
  // From another photo's detail, the new one sits over the same list.
  let over = from || '';
  if (fromPlace && fromPlace.place === 'detail') {
    const here = api && api.places && typeof api.places.current === 'function' ? api.places.current(MO_PLACES_ID) : undefined;
    over = (here && here.place === 'detail' && here.params && here.params.in) || '';
  }
  return moOpenPlace(api, 'detail', { type: type === 'video' ? 'video' : 'photo', id, in: over });
}
