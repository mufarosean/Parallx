// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 68: PLACES — Study's screens in ONE tab (the core's api.places)
// ═══════════════════════════════════════════════════════════════════════════════
//
// A place is a screen of Study: Home, a subject, its Progress, its Plan, a
// unit (a place inside its subject), Weak Spots, Marked. They share ONE tab,
// named for the place with Study's icon; the core keeps the tab, the trail in
// the bar under the tabs (`Study › Exam 7 › Mack`), the address
// (parallx://place/study/unit?subject=3&unit=r7), Back and Forward, and where
// the keys land (the page header's title). A thing keeps a tab of its own: a
// session (its making, its questions, results and review stay inside it) and
// a chapter read in Learn. The sheets (New Session, New Subject, New Plan) are
// dialogs, each in a tab of its own that closes when it is done, as before.
//
// Each place is drawn by the pane that drew its tab before (createEditorPane,
// given the place's route), so a place and a tab an older build saved draw
// alike; that build's tabs (editor type 'study', 'home', 'progress-3',
// 'unit-3-r7', 'plan-2') come back as the place in the one tab (formerTabs).

const ST_PLACES_ID = 'study';
/** The editor type of the one place tab; the things keep 'study'. */
const ST_PLACE_TYPE = 'study-place';

/** Study's places; the first is where the tool opens. */
const ST_PLACES = [
  { id: 'home', title: 'Home' },
  { id: 'subject', title: 'Subject' },
  { id: 'progress', title: 'Progress' },
  { id: 'plan', title: 'Plan' },
  { id: 'unit', title: 'Unit' },
  { id: 'weak', title: 'Weak Spots' },
  { id: 'marked', title: 'Marked' },
];

/** The places are registered (Study runs on a host with the places point). */
let _stPlacesOn = false;

function stPlacesOn() {
  return _stPlacesOn && !!(_api && _api.places && typeof _api.places.open === 'function');
}

const ST_PLACE_NUM = /^\d+$/;
const stPlaceId = (v) => String(Number(v) || 0);

/** The place a route is ({ place, params }), or null for a thing or a sheet. */
function stPlaceOfRoute(route) {
  if (!route) return null;
  switch (route.view) {
    case 'home': return { place: 'home' };
    case 'weak': return { place: 'weak' };
    case 'marked': return { place: 'marked' };
    case 'subject': return { place: 'subject', params: { subject: stPlaceId(route.subjectId) } };
    case 'progress': return { place: 'progress', params: { subject: stPlaceId(route.subjectId) } };
    case 'plan': return { place: 'plan', params: { plan: stPlaceId(route.planId) } };
    case 'unit': return { place: 'unit', params: { subject: stPlaceId(route.subjectId), unit: String(route.rowId || '') } };
    default: return null;
  }
}

/** The route the pane draws a place by (Home for an address it cannot read). */
function stRouteOfPlace(location) {
  const p = (location && location.params) || {};
  const num = (v) => (ST_PLACE_NUM.test(String(v || '')) ? Number(v) : 0);
  switch (location && location.place) {
    case 'weak': return { view: 'weak' };
    case 'marked': return { view: 'marked' };
    case 'subject': return num(p.subject) ? { view: 'subject', subjectId: num(p.subject) } : { view: 'home' };
    case 'progress': return num(p.subject) ? { view: 'progress', subjectId: num(p.subject) } : { view: 'home' };
    case 'plan': return num(p.plan) ? { view: 'plan', planId: num(p.plan) } : { view: 'home' };
    case 'unit': return num(p.subject) && p.unit ? { view: 'unit', subjectId: num(p.subject), rowId: String(p.unit) } : { view: 'home' };
    default: return { view: 'home' };
  }
}

/** The place an older build's tab named ('home', 'progress-3', 'unit-3-r7', 'plan-2'), or undefined for a thing or a sheet. */
function stPlaceOfInstance(instanceId) {
  const id = String(instanceId || '');
  if (!/^(home|progress-\d+|unit-\d+-.+|plan-\d+)$/.test(id)) return undefined;
  return stPlaceOfRoute(stRouteFromInstanceId(id)) || undefined;
}

// ── Names ──────────────────────────────────────────────────────────────────
// Read from what Study holds (its subjects and plans): titleOf is asked synchronously.

const stPlaceSubject = (id) => stSubjectsShown().find((s) => s.id === Number(id)) || null;
const stPlacePlan = (id) => { const st = _stPlans.get(Number(id)); return st ? st.plan : null; };

function stPlaceTitle(location) {
  const p = (location && location.params) || {};
  switch (location && location.place) {
    case 'subject': { const s = stPlaceSubject(p.subject); return s ? s.name : 'Subject'; }
    case 'unit': {
      const s = stPlaceSubject(p.subject);
      const u = s ? s.units.find((x) => x.rowId === String(p.unit)) : null;
      return u ? u.name : 'Unit';
    }
    case 'plan': { const plan = stPlacePlan(p.plan); return plan ? String(plan.name) : 'Plan'; }
    default: return (ST_PLACES.find((x) => x.id === (location && location.place)) || ST_PLACES[0]).title;
  }
}

/** The trail after Study: the subject, then the place inside it (Progress, its plan, a unit). */
function stPlaceTrail(location) {
  const p = (location && location.params) || {};
  const here = { label: stPlaceTitle(location), location };
  const subjectStep = (id) => {
    const s = stPlaceSubject(id);
    return { label: s ? s.name : 'Subject', location: { place: 'subject', params: { subject: stPlaceId(id) } } };
  };
  switch (location && location.place) {
    case 'progress': case 'unit': return [subjectStep(p.subject), here];
    case 'plan': {
      const plan = stPlacePlan(p.plan);
      return plan && Number(plan.subjectId) ? [subjectStep(plan.subjectId), here] : [here];
    }
    default: return [here];
  }
}

/** What the tab and the trail of a location say, to see when a name read later changed them. */
const stPlaceWords = (location) => JSON.stringify([stPlaceTitle(location), stPlaceTrail(location).map((s) => s.label)]);

// ── Going there ────────────────────────────────────────────────────────────

/** A place's address, for a link or a row (Ctrl+click, its menu). */
function stPlaceAddress(route) {
  const location = stPlaceOfRoute(route);
  return location && stPlacesOn() ? _api.places.addressOf(ST_PLACES_ID, location) : '';
}

/** Go to a place's route, in Study's one tab (with `newTab`, a tab of its own). */
function stOpenPlace(route, options) {
  const location = stPlaceOfRoute(route);
  if (!location || !stPlacesOn()) return Promise.resolve(false);
  return _api.places.open({ tool: ST_PLACES_ID, place: location.place, ...(location.params ? { params: location.params } : {}) }, options && options.newTab ? { newTab: true } : undefined);
}

/**
 * A column row or a link that goes to a place: Ctrl+click (Cmd+click) opens
 * it in a tab of its own. With `menu`, the row's context menu offers Open and
 * Open in Its Own Tab (the kit's place link); a row with a menu of its own
 * keeps it, and the menu adds Open in Its Own Tab (stPlaceMenuItem).
 */
function stPlaceLink(element, route, { menu = true } = {}) {
  const address = stPlaceAddress(route);
  if (!element || !address) return;
  element.dataset.stPlace = JSON.stringify(stPlaceOfRoute(route));
  if (typeof _api.ui.bindPlaceLink === 'function') _api.ui.bindPlaceLink(element, address, { menu });
}

/** Open in Its Own Tab, for a row's own menu (a subject's, a unit's). */
function stPlaceMenuItem(route) {
  return stPlacesOn() ? [{ label: 'Open in Its Own Tab', icon: 'external-link', onSelect: () => void stOpenPlace(route, { newTab: true }) }] : [];
}

/**
 * The one mark for where he is, on the column's rows: a session's own tab in
 * front marks its row; else the place of Study's tab marks its row.
 */
function stMarkColumn(root) {
  if (!root || !_api || typeof _api.ui.markCurrent !== 'function') return;
  let active = '';
  try { const a = (_api.editors.openEditors || []).find((e) => e.isActive); active = a ? String(a.id || '') : ''; } catch { active = ''; }
  const session = /:study:session-(\d+)$/.exec(active);
  const here = !session && stPlacesOn() ? _api.places.current(ST_PLACES_ID) : undefined;
  const key = here ? JSON.stringify(stPlaceOfRoute(stRouteOfPlace(here))) : '';
  for (const row of root.querySelectorAll('[data-st-place]')) _api.ui.markCurrent(row, !!key && row.dataset.stPlace === key);
  for (const row of root.querySelectorAll('[data-session-id]')) _api.ui.markCurrent(row, !!session && row.dataset.sessionId === session[1]);
}

/** Keep the column's mark where he is: on a move, and when another tab comes to the front. */
function stFollowMarks(root) {
  const subs = [];
  if (stPlacesOn()) subs.push(_api.places.onDidMove((e) => { if (e.tool === ST_PLACES_ID) stMarkColumn(root); }));
  if (_api.editors && typeof _api.editors.onDidChangeOpenEditors === 'function') subs.push(_api.editors.onDidChangeOpenEditors(() => stMarkColumn(root)));
  return { dispose: () => { for (const s of subs) { try { s.dispose(); } catch { /* gone */ } } } };
}

// ── The view ───────────────────────────────────────────────────────────────

/** Resolves once the page's kit title is drawn (a page drawn after its data loads), or after a while regardless. */
function stPlaceTitleDrawn(container, isStillWanted) {
  const has = () => !!container.querySelector('.px-page-header__title');
  if (has()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { observer.disconnect(); clearTimeout(timer); resolve(); };
    const observer = new MutationObserver(() => { if (has() || !isStillWanted()) done(); });
    observer.observe(container, { childList: true, subtree: true });
    const timer = setTimeout(done, 4000);
  });
}

class StudyPlaceView {
  constructor(container, host) {
    this._container = container;
    this._host = host;
    this._pane = null;
    this._shown = '';
    this._location = null;
    this._words = '';
    this._seq = 0;
    // A name read after the tab was drawn (Study reads its subjects and plans at start) renames the tab and the trail.
    this._offData = onDataChanged(() => {
      const at = this._location;
      if (!at || stPlaceWords(at) === this._words) return;
      this._words = stPlaceWords(at);
      this._host.replace(at);
    });
  }

  async show(location) {
    const seq = ++this._seq;
    const route = stRouteOfPlace(location);
    const key = JSON.stringify(route);
    this._location = location;
    this._words = stPlaceWords(location);
    if (key !== this._shown || !this._pane) {
      this._close();
      this._shown = key;
      this._pane = createEditorPane(this._container, { instanceId: stRouteInstanceId(route), route });
    }
    await stPlaceTitleDrawn(this._container, () => seq === this._seq);
  }

  _close() {
    const pane = this._pane;
    this._pane = null;
    if (pane) { try { pane.dispose(); } catch (err) { console.warn('[Study] a place failed to close:', err); } }
    this._container.replaceChildren();
  }

  dispose() {
    this._seq++;
    stOff(this._offData);
    this._close();
  }
}

/** Register Study's places with the core. */
function registerPlaces(context) {
  if (!_api.places || typeof _api.places.register !== 'function') return;
  context.subscriptions.push(_api.places.register({
    id: ST_PLACES_ID,
    title: 'Study',
    icon: 'px-study',
    editorType: ST_PLACE_TYPE,
    places: ST_PLACES,
    // The older build opened a tab per screen, all of them 'study'; a session's and a sheet's stay theirs.
    formerTabs: { editorType: 'study', placeOf: (instanceId) => stPlaceOfInstance(instanceId) },
    titleOf: (location) => stPlaceTitle(location),
    trailOf: (location) => stPlaceTrail(location),
    createView: (container, host) => new StudyPlaceView(container, host),
  }));
  _stPlacesOn = true;
  context.subscriptions.push({ dispose: () => { _stPlacesOn = false; } });
}

// ── The screens each view draws ────────────────────────────────────────────

/** The drawing of a route's view (the pane's render), or null for none. */
function stViewRenderer(view) {
  const views = {
    home: renderHome, setup: renderSetup, newSubject: renderNewSubject, progress: renderProgress, unit: renderUnit,
    newPlan: renderNewPlan, plan: renderPlan, generating: renderGenerating, session: renderSession, results: renderResults,
    review: renderReview, learn: renderLearn, subject: renderSubject, weak: renderWeakSpots, marked: renderMarked,
  };
  return Object.prototype.hasOwnProperty.call(views, view) ? views[view] : null;
}

/** Open Subject…: the subject's place (it had no screen before). */
function registerPlaceCommands(context) {
  const cmds = [
    ['study.openSubject', async (subject) => { const s = await stPickSubject(subject, 'Open which subject?'); return s ? stOpenPane({ view: 'subject', subjectId: s.id }) : null; }],
  ];
  for (const [id, handler] of cmds) context.subscriptions.push(_api.commands.registerCommand(id, handler));
}
