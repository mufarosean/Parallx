// @acceptance: Home, the page the app opens on: a greeting, a place to ask, today from the tools, the work, and Welcome to Parallx on a new workspace
// Written from the request (the owner's words of 2026-11-27 and his picks on
// the mock-up page: 1A, 2A, 3B, and 4A titled "Welcome to Parallx") before the
// build, by a verifier that did not build it, and seen to fail on the app as it
// was (019070c). The builder does not edit this file: a check that is wrong is
// reported, not changed.
//
// What a person must be able to do when the piece is done (PARALLX_PROBE_ONLY
// takes these numbers):
//
//    0  is the ground the rest stands on, and holds today: Home is a tab that
//       `home.open` and the mark in the title bar open, one of it, that closes
//       like any tab and stays closed; a page and a file last worked on are on
//       it by their titles and a click opens one
//    1  The title (2A): one sentence in the display face, "Good morning, Ada",
//       "Good afternoon, Ada" or "Good evening, Ada" by the hour, the name the
//       one italic word; an italic line under it with today's date. Home asks
//       "What should Home call you?" once, keeps the answer as a setting, and
//       does not ask again, after a restart either
//    2  One wide field to ask. Enter hands the words to the chat, which opens
//       with them; Home stays as it was; an empty field sends nothing
//    3  "Today, from your tools" (3B): a tool that is on puts ONE card there
//       through `home.registerCard` (its name, a number with a unit, a line,
//       one action that runs its command). Taken back, turned off, turned on
//       again, after a restart: the card and the tool's things in the feed
//       follow at once. Flashcards with cards due has its own card
//    4  The feed (1A): each thing last worked on is an entry with a picture of
//       the thing, its title in the display face, where it is, two lines of
//       its own opening text, tags, and a number or time at the right; newest
//       first; it opens by a click and by Enter
//    5  The filter words over the feed: "picked up", "pinned", and "this
//       week", "this month", "all"; a thing can be pinned
//    6  A workspace with nothing in it (4A): the app opens on Home by itself,
//       titled "Welcome to Parallx", with the first steps Open a Folder…, New
//       Page and Turn On Tools…, each doing its work; with something made,
//       Home is the greeting again
//    7  The old Welcome is gone: no Welcome tab, command or Help entry
//    8  Settings: opening on Home, per workspace; the width of the content
//    9  Everyone can use it: the keys reach every control, each has a name and
//       shows its focus, a finger works, no uppercase labels, light and dark
//   10  No page error in the whole run
//
// On the app as it was (019070c, 2026-11-27, Linux, one run of about five
// minutes): 76 checks. The 6 of the ground pass (phase 0's five and 10.1).
// The 70 of the new behaviour all fail, each for what is missing. No page
// error.
//
// How it runs. Every phase gets its own app, profile and workspace under the
// out dir, so one failure hides nothing. Phases 0 to 5, 8 and 9 start by
// making a page ("Reserving Notes", through the chat's own tool
// canvas_create_page) and opening a file (Readings/Clark Notes.md, written to
// disk before launch), so the workspace is not an empty one. Phase 6 starts on
// a folder with nothing in it but the probe's .parallx/ai-config.json (which
// only keeps indexing and the heartbeat quiet). The mouse, the keys and the
// finger are real. No model is called.
//
//   xvfb-run -a node tests/probes/home-acceptance.mjs [outDir]
//   PARALLX_PROBE_ONLY=0,3,5-7   only those phases
//
// The clock. Checks 1.6, 1.7 and all of phase 5 fix the page's Date with
// Playwright's clock (page.clock.setFixedTime: timers run on) and then close
// and open Home, so the hour and the date are known. The hours used are 08:00,
// 14:00 and 20:00, far from any boundary a build may choose. Phase 5 fixes the
// 20th of the month at 14:00 and its things were touched 1 hour, 10 days and
// 40 days before: inside and outside "this week" and "this month" whether a
// build counts calendar weeks and months or the last 7 and 30 days.
//
// Where a result is read from. From the page on screen (words, roles, the
// names controls speak, computed faces and sizes, where things sit), from the
// tab strip, from the chat's part of the window, from the settings registry
// (ISettingsRegistryService: what is registered under `home.` and its value),
// from the command service (which commands exist), from Electron's own folder
// dialog (replaced for the run by one that records the call and cancels) and
// from the probe's own tool, which counts how often the app ran its command
// and opened its thing. Never from what the probe itself typed alone.
//
// The probe's own tool. "Probe Almanac" (id probe.home-almanac) is written
// into <appRoot>/ext beside a link to ext/flashcards. It is an ordinary
// extension: it calls, when the function exists,
//     api.home.registerCard({ id: 'entries', number: '7',
//       unit: 'entries waiting',
//       line: 'Autumn entries are waiting in the almanac.',
//       action: { label: 'Open Entries', command: 'almanac.openEntries' } })
// which must return a disposable, and it always calls api.home.registerSource
// (as it exists today) with three things carrying tags, a place and opening
// words. The app must take the card's "where it is from" from the tool
// (its manifest name, "Probe Almanac"); the call does not pass it.
//
// What the probe holds on to (the builder keeps these, or the check fails):
//   - the words of the request and the mock-up, exactly: "Good morning,",
//     "Good afternoon,", "Good evening," then the name; "What should Home call
//     you?"; "Today, from your tools"; the filter words "picked up", "pinned",
//     "this week", "this month", "all" (any letter case); "Welcome to
//     Parallx"; "Open a Folder…", "New Page", "Turn On Tools…" (the
//     one-character ellipsis)
//   - `home.open` stays the command that opens Home, and its tab says "Home"
//   - THE HOOKS (the few things that are not the request's words):
//       1. Home's title is the one level-1 heading on the page (h1, or
//          role=heading with aria-level=1); the italic word is an element
//          inside it whose computed font-style is italic
//       2. the date line is an italic element under the title holding the
//          weekday, the day's number and the month in English words
//          ("Friday 27 November", in any order)
//       3. the question is a text field named "What should Home call you?"
//          (label, aria-label or placeholder), or those words on screen with
//          a text field in the same box; Enter in it keeps the name. It may be
//          on Home or in a dialog
//       4. the name, opening on Home and the width are registered settings
//          whose keys begin `home.`: the name is a string setting whose key,
//          label or description has "name" or "call"; opening on Home is a
//          boolean, workspace scope, default on, with "open", "start" or
//          "launch" in it; the width has "width" in it (an enum, a number or
//          a boolean)
//       5. the ask field is a text field on Home whose placeholder or name
//          begins "Ask"; Enter submits it
//       6. the cards sit in an element named "Today, from your tools" for a
//          screen reader (aria-label or aria-labelledby; a section, list,
//          region or group); each card is a list item, an article or a group
//          inside it, with exactly one button, named by the action's label
//       7. a feed entry is a list item, an article or a row (li, article,
//          role listitem, article or row) holding an element whose own text
//          is the thing's title; its picture is an img, canvas, svg, role=img
//          or an element with a background image, at least 48 px each way;
//          the entry, or one control in it, takes focus and Enter opens it
//       8. a filter word is a control (button, radio, tab, option, checkbox)
//          named by the word; the chosen one says so (aria-pressed,
//          aria-checked or aria-selected "true", or a checked radio)
//       9. a thing is pinned by a button in its entry whose name begins "Pin",
//          or by "Pin…" in the entry's context menu; unpinned by the same
//          control (then pressed, or named "Unpin…")
//      10. a first step is a button whose name is, or begins with, the step's
//          words (a line of explanation may follow in the same button)
//      11. Flashcards' card: its name "Flashcards", the number Flashcards'
//          own page gives as due today, a unit with the word "due", and one
//          action that starts its study session (`flashcards.study` today)
//
// What is not checked, and why: that the picture is a true likeness of the
// thing (a probe cannot judge it; the screenshots are for that); a tab left
// open on the old Welcome by an older build (this run has one build); the
// second line of the mock-up's subtitle ("Three things are waiting…"), the
// tools' own first steps on an empty workspace and the workspace setup he is
// still thinking on (none of them is in what he agreed to).

import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, setToolEnabled, screenshot, menuRows, pickMenu } from './scene.mjs';

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'test-results', 'home-acceptance');
const ONLY = (() => {
  const raw = (process.env.PARALLX_PROBE_ONLY || '').trim();
  if (!raw) return null;
  const set = new Set();
  for (const part of raw.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (m) for (let i = Number(m[1]); i <= Number(m[2] ?? m[1]); i++) set.add(i);
  }
  return set;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Asks until the answer is truthy or the time is up; resolves the last answer. */
async function until(fn, ms = 4000, step = 150) {
  const t0 = Date.now(); let v;
  for (;;) { v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); }
}

const results = [];
const pageErrors = [];
function record(id, name, ok, got) {
  results.push({ id, ok: !!ok });
  const said = got === undefined || got === null ? '' : `: ${typeof got === 'string' ? got : JSON.stringify(got)}`.slice(0, 700);
  console.log(`${ok ? '  ok ' : ' FAIL'} ${id} ${name}${ok ? '' : said}`);
}

// ── What the probe puts in a workspace ──────────────────────────────────────
const NAME = 'Ada';
const PAGE = { title: 'Reserving Notes', opening: 'Fewer parameters means more degrees of freedom', body: 'Fewer parameters means more degrees of freedom and a smaller parameter variance. Premium carries information about immature years that the development factors alone do not. The whole triangle is then fit with only three parameters, and the expected loss ratio is read from the fit and not chosen by hand. Each accident year leans on the others through the premium, which is why the youngest years move least when one diagonal is restated.' };
const FILE = { name: 'Clark Notes.md', folder: 'Readings', opening: 'The Cape Cod method assumes that the expected', body: '# Clark\n\nThe Cape Cod method assumes that the expected ultimate loss for each year is a constant expected loss ratio applied to the on-level premium. The growth curve is fit to the whole triangle at once, so a thin year borrows from the full ones. Truncation matters: the curve never quite reaches one, and the tail beyond the last age has to be cut somewhere and said out loud.\n' };
const TOOL = { id: 'probe.home-almanac', name: 'Probe Almanac', unit: 'entries waiting', line: 'Autumn entries are waiting in the almanac.', action: 'Open Entries' };
const THINGS = { one: 'Almanac Entry One', ten: 'Almanac Entry Ten Days', forty: 'Almanac Entry Forty Days', where: 'Almanac / Autumn', tag: 'harvest', opening: 'First frost came early this year' };
const FLASHCARDS = 'parallx-community.flashcards';
const STEPS = ['Open a Folder…', 'New Page', 'Turn On Tools…'];
const QUESTION = 'What should Home call you?';
const ROW = 'Today, from your tools';
const FILTERS = ['picked up', 'pinned', 'this week', 'this month', 'all'];

const TOOL_MANIFEST = {
  manifestVersion: 1, id: TOOL.id, name: TOOL.name, version: '0.0.1', publisher: 'probe',
  description: 'The Home acceptance probe\'s own tool: one card and three things for the feed.',
  main: 'main.js', activationEvents: ['onStartupFinished'], engines: { parallx: '^0.1.0' },
  contributes: { commands: [
    { id: 'almanac.openEntries', title: 'Open Entries', category: TOOL.name },
    { id: 'almanac.takeCardBack', title: 'Take Card Back', category: TOOL.name },
    { id: 'almanac.putCard', title: 'Put Card', category: TOOL.name },
  ] },
};
const TOOL_MAIN = `// Written by tests/probes/home-acceptance.mjs. An ordinary extension.
export function activate(api, context) {
  const g = (globalThis.__homeAlmanac ??= { ran: 0, opened: [], activations: 0 });
  g.activations++;
  g.cardApi = typeof api.home?.registerCard === 'function';
  g.cardError = '';
  g.disposable = null;
  let card = null;
  const take = () => { try { card?.dispose?.(); } catch (e) { g.cardError = String(e?.message || e); } card = null; };
  const put = (number) => {
    take();
    if (!g.cardApi) return;
    try {
      card = api.home.registerCard({ id: 'entries', number: String(number), unit: ${JSON.stringify(TOOL.unit)}, line: ${JSON.stringify(TOOL.line)}, action: { label: ${JSON.stringify(TOOL.action)}, command: 'almanac.openEntries' } });
      g.disposable = typeof card?.dispose === 'function';
    } catch (e) { g.cardError = String(e?.message || e); }
  };
  context.subscriptions.push(api.commands.registerCommand('almanac.openEntries', () => { g.ran++; }));
  context.subscriptions.push(api.commands.registerCommand('almanac.takeCardBack', () => take()));
  context.subscriptions.push(api.commands.registerCommand('almanac.putCard', (n) => put(n ?? 7)));
  const HOUR = 3600e3; const DAY = 24 * HOUR;
  const thing = (id, title, ago, tags) => ({ id, title, kind: 'Entry', summary: ${JSON.stringify(THINGS.opening)} + ' and the late apples were picked in a single afternoon (' + id + ').', tags, where: ${JSON.stringify(THINGS.where)}, touchedAt: Date.now() - ago, open: () => { g.opened.push(id); } });
  context.subscriptions.push(api.home.registerSource({
    id: 'entries', label: ${JSON.stringify(TOOL.name)},
    listRecent: async () => [thing('one', ${JSON.stringify(THINGS.one)}, HOUR, [${JSON.stringify(THINGS.tag)}]), thing('ten', ${JSON.stringify(THINGS.ten)}, 10 * DAY, ['orchard']), thing('forty', ${JSON.stringify(THINGS.forty)}, 40 * DAY, ['orchard'])],
  }));
  put(7);
}
export function deactivate() {}
`;

/** A new app root and workspace for a phase. `things`: the file on disk; `ext`: the probe's tool and Flashcards. */
async function newRoot(name, { things = true, ext = true } = {}) {
  const dir = path.join(OUT, 'runs', name);
  await fs.rm(dir, { recursive: true, force: true });
  const appRoot = path.join(dir, 'app');
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  if (ext) {
    await fs.mkdir(path.join(appRoot, 'ext', 'home-almanac'), { recursive: true });
    await fs.writeFile(path.join(appRoot, 'ext', 'home-almanac', 'parallx-manifest.json'), JSON.stringify(TOOL_MANIFEST, null, 2));
    await fs.writeFile(path.join(appRoot, 'ext', 'home-almanac', 'main.js'), TOOL_MAIN);
    await fs.symlink(path.join(PROJECT_ROOT, 'ext', 'flashcards'), path.join(appRoot, 'ext', 'flashcards'), 'junction');
  }
  const workspace = await newWorkspace(dir, 'workspace', things);
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  return { dir, appRoot, workspace };
}
async function newWorkspace(dir, name, things) {
  const workspace = path.join(dir, name);
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
  if (things) {
    await fs.mkdir(path.join(workspace, FILE.folder), { recursive: true });
    await fs.writeFile(path.join(workspace, FILE.folder, FILE.name), FILE.body);
  }
  return workspace;
}

// ── What runs in the page: how the probe reads Home, by role, name and words ──
function LIB() {
  if (window.__hp) return;
  const hp = (window.__hp = {});
  const ED = '[data-part-id="workbench.parts.editor"]';
  const ws = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  hp.ws = ws;
  /** On screen. `aria`: also not hidden from a screen reader. */
  hp.vis = (e, aria = true) => {
    if (!e || !e.getClientRects || !e.getClientRects().length) return false;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    if (aria && e.closest('[aria-hidden="true"]')) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  hp.root = () => document.querySelector(ED);
  /** Inside the editor area and not in its tab strip: Home's own page when Home is in front. */
  hp.inHome = (e) => { const r = hp.root(); return !!r && r.contains(e) && !e.closest('[role="tablist"]'); };
  hp.all = (sel, aria = true) => Array.from(hp.root()?.querySelectorAll(sel) ?? []).filter((e) => hp.inHome(e) && hp.vis(e, aria));
  hp.own = (e) => ws(Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
  hp.text = (e) => ws(e?.innerText ?? e?.textContent ?? '');
  /** The name a screen reader speaks. */
  hp.name = (e) => {
    const by = ws((e.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    if (by) return by;
    const al = ws(e.getAttribute('aria-label'));
    if (al) return al;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || e.isContentEditable) {
      const l = e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`) : null;
      if (l) return ws(l.textContent);
      const wrap = e.closest('label');
      if (wrap) return ws(wrap.textContent);
      return ws(e.getAttribute('placeholder') || e.getAttribute('aria-placeholder') || e.getAttribute('title'));
    }
    return ws(e.textContent) || ws(e.getAttribute('title'));
  };
  /** Where to click it. Scrolls it into view, so nothing measured before this call is compared with anything after. */
  hp.pt = (e) => { e.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; };
  hp.face = (e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/['"]/g, '').trim();
  hp.px = (e) => parseFloat(getComputedStyle(e).fontSize);
  const FIELDS = 'input:not([type]), input[type="text"], input[type="search"], textarea, [role="textbox"], [role="searchbox"], [contenteditable="true"]';

  /** The level-1 headings on Home. */
  hp.titles = () => hp.all('h1, [role="heading"][aria-level="1"]').map((h) => {
    const parts = [h, ...h.querySelectorAll('*')].filter((n) => hp.own(n));
    const r = h.getBoundingClientRect();
    return {
      text: hp.text(h), face: hp.face(h), px: hp.px(h), top: Math.round(r.top), bottom: Math.round(r.bottom),
      italic: parts.filter((n) => getComputedStyle(n).fontStyle === 'italic').map(hp.own),
      upright: parts.filter((n) => getComputedStyle(n).fontStyle !== 'italic').map(hp.own),
    };
  });
  /** Italic lines of Home that are not in the title, top to bottom. */
  hp.italicLines = () => hp.all('*').filter((e) => hp.own(e) && getComputedStyle(e).fontStyle === 'italic' && !e.closest('h1, [role="heading"][aria-level="1"]'))
    .map((e) => ({ text: hp.text(e), top: Math.round(e.getBoundingClientRect().top), face: hp.face(e) }));

  /** The field of "What should Home call you?", wherever it is. */
  hp.question = (q) => {
    const boxes = Array.from(document.querySelectorAll(FIELDS)).filter((b) => hp.vis(b) && !/^ask/i.test(hp.name(b)));
    const named = boxes.find((b) => hp.name(b).includes(q));
    if (named) return { how: 'a field named so', pt: hp.pt(named) };
    const said = Array.from(document.querySelectorAll('body *')).filter((e) => hp.vis(e) && hp.own(e).includes(q));
    for (const e of said) {
      let a = e;
      for (let i = 0; i < 4 && a && a !== document.body; i++, a = a.parentElement) {
        const b = boxes.find((x) => a.contains(x));
        if (b) return { how: 'the words with a field beside them', pt: hp.pt(b) };
      }
    }
    return said.length ? { how: 'the words, with no field to answer in', pt: null } : null;
  };
  /** The field to ask in. */
  hp.askEl = () => hp.all(FIELDS).find((b) => /^ask\b/i.test(hp.name(b)) || /^ask\b/i.test(b.getAttribute('placeholder') || ''));
  hp.ask = () => {
    const b = hp.askEl();
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const others = hp.all(FIELDS).filter((x) => x !== b).map((x) => Math.round(x.getBoundingClientRect().width));
    return { name: hp.name(b), placeholder: b.getAttribute('placeholder') || '', value: b.value ?? hp.text(b), width: Math.round(r.width), top: Math.round(r.top), others };
  };
  /** Whether the words are in the chat: anywhere on screen outside the editor area. */
  hp.outside = (words) => {
    const parts = Array.from(document.querySelectorAll('[data-part-id]')).filter((p) => p !== hp.root() && hp.vis(p));
    for (const p of parts) {
      if (hp.text(p).includes(words)) return p.getAttribute('data-part-id');
      if (Array.from(p.querySelectorAll('input, textarea')).some((i) => hp.vis(i) && String(i.value || '').includes(words))) return p.getAttribute('data-part-id');
    }
    return '';
  };
  hp.partWidth = (id) => { const p = document.querySelector(`[data-part-id="${id}"]`); return p && hp.vis(p, false) ? Math.round(p.getBoundingClientRect().width) : 0; };
  hp.chatText = () => hp.text(document.querySelector('[data-part-id="workbench.parts.auxiliarybar"]'));

  // ── the cards ──
  hp.rowLabel = (label) => hp.all('*').filter((e) => hp.own(e) === label).map((e) => ({ transform: getComputedStyle(e).textTransform, top: Math.round(e.getBoundingClientRect().top) }));
  hp.rowEl = (label) => hp.all('section, ul, ol, div, nav, [role]').find((e) => (e.hasAttribute('aria-label') || e.hasAttribute('aria-labelledby')) && hp.name(e) === label);
  hp.cardEls = (label) => {
    const row = hp.rowEl(label);
    if (!row) return [];
    const c = Array.from(row.querySelectorAll('li, article, [role="listitem"], [role="article"], [role="group"]')).filter((e) => hp.vis(e));
    return c.filter((e) => !c.some((o) => o !== e && o.contains(e)));
  };
  hp.cards = (label) => hp.cardEls(label).map((c) => ({
    text: hp.text(c),
    buttons: Array.from(c.querySelectorAll('button, [role="button"], a[href]')).filter((b) => hp.vis(b)).map(hp.name),
    texts: [c, ...c.querySelectorAll('*')].filter((n) => hp.vis(n) && hp.own(n)).map((n) => ({ t: hp.own(n), px: hp.px(n), face: hp.face(n) })),
  }));
  hp.cardButton = (label, from) => {
    const c = hp.cardEls(label).find((x) => hp.text(x).includes(from));
    const b = c && Array.from(c.querySelectorAll('button, [role="button"], a[href]')).find((x) => hp.vis(x));
    return b ? hp.pt(b) : null;
  };
  hp.focusCardButton = (label, from) => {
    const c = hp.cardEls(label).find((x) => hp.text(x).includes(from));
    const b = c && Array.from(c.querySelectorAll('button, [role="button"], a[href]')).find((x) => hp.vis(x));
    if (!b) return false;
    b.focus();
    return document.activeElement === b;
  };

  // ── the feed ──
  const ENTRY = 'li, article, [role="listitem"], [role="article"], [role="row"]';
  hp.titleEls = (title) => hp.all('*').filter((e) => hp.own(e) === title);
  hp.entryEl = (title) => { for (const e of hp.titleEls(title)) { const box = e.closest(ENTRY); if (box && hp.inHome(box)) return box; } return null; };
  hp.entry = (title, opening) => {
    const t = hp.titleEls(title)[0];
    if (!t) return null;
    const box = hp.entryEl(title);
    const out = { titleFace: hp.face(t), titlePx: hp.px(t), top: Math.round(t.getBoundingClientRect().top), box: !!box };
    if (!box) return out;
    const r = box.getBoundingClientRect();
    out.text = hp.text(box);
    out.pictures = Array.from(box.querySelectorAll('*')).filter((e) => hp.vis(e, false) && (/^(IMG|CANVAS|svg)$/.test(e.tagName) || e.getAttribute('role') === 'img' || /url\(/.test(getComputedStyle(e).backgroundImage)))
      .map((e) => { const q = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), w: Math.round(q.width), h: Math.round(q.height) }; })
      .filter((p) => p.w >= 48 && p.h >= 48 && p.w < r.width * 0.6);
    out.right = Array.from(box.querySelectorAll('*')).filter((e) => hp.vis(e) && hp.own(e) && !e.contains(t) && e.getBoundingClientRect().left >= r.left + r.width * 0.6).map(hp.own);
    const ex = opening ? Array.from(box.querySelectorAll('*')).filter((e) => hp.vis(e) && hp.own(e).includes(opening))[0] : null;
    if (ex) {
      const cs = getComputedStyle(ex);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
      out.excerpt = { lines: Math.round((ex.getBoundingClientRect().height / lh) * 10) / 10, chars: hp.own(ex).length };
    }
    return out;
  };
  /** Focus the entry, or the first control in it, for the keys. */
  hp.focusEntry = (title) => {
    const box = hp.entryEl(title);
    if (!box) return false;
    const stops = [box, ...box.querySelectorAll('*')].filter((e) => hp.vis(e) && e.tabIndex >= 0 && !/^(pin|unpin)\b/i.test(hp.name(e)));
    if (!stops.length) return false;
    stops[0].focus();
    return document.activeElement === stops[0];
  };
  hp.shown = (titles) => titles.filter((t) => hp.titleEls(t).length > 0);
  /** Where each part of the page starts, read in one go with nothing scrolled in between. */
  hp.tops = (label, titles) => {
    const top = (e) => (e ? Math.round(e.getBoundingClientRect().top) : null);
    return { title: top(hp.all('h1, [role="heading"][aria-level="1"]')[0]), ask: top(hp.askEl()), row: top(hp.all('*').find((e) => hp.own(e) === label)), things: titles.map((t) => top(hp.entryEl(t) ?? hp.titleEls(t)[0])) };
  };
  /** Where to click: the field to ask in, a filter word, a thing's title. */
  hp.at = (what, arg) => { const e = what === 'ask' ? hp.askEl() : what === 'filter' ? hp.filterEl(arg) : what === 'title' ? hp.titleEls(arg)[0] : null; return e ? hp.pt(e) : null; };

  // ── the filter words, the pin ──
  const CONTROLS = 'button, [role="button"], [role="radio"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"], [role="menuitemradio"], input[type="radio"], input[type="checkbox"]';
  hp.filterEl = (word) => hp.all(CONTROLS).find((e) => hp.name(e).toLowerCase() === word);
  hp.filter = (word) => {
    const e = hp.filterEl(word);
    if (!e) return null;
    const on = ['aria-pressed', 'aria-checked', 'aria-selected'].some((a) => e.getAttribute(a) === 'true') || e.checked === true;
    return { on, transform: getComputedStyle(e).textTransform, shown: hp.own(e) || hp.text(e), top: Math.round(e.getBoundingClientRect().top) };
  };
  hp.pin = (title, un) => {
    const box = hp.entryEl(title);
    if (!box) return null;
    const buttons = Array.from(box.querySelectorAll('button, [role="button"], [role="switch"], [role="checkbox"]')).filter((b) => hp.vis(b));
    const b = un
      ? buttons.find((x) => /^unpin\b/i.test(hp.name(x)) || (/^pin/i.test(hp.name(x)) && (x.getAttribute('aria-pressed') === 'true' || x.getAttribute('aria-checked') === 'true')))
      : buttons.find((x) => /^pin\b/i.test(hp.name(x)) && x.getAttribute('aria-pressed') !== 'true' && x.getAttribute('aria-checked') !== 'true');
    return b ? { name: hp.name(b), pt: hp.pt(b) } : null;
  };

  // ── any button on Home, by name ──
  hp.buttonEl = (label) => hp.all('button, [role="button"], a[href]').find((b) => { const n = hp.name(b); return n === label || n.startsWith(label + ' ') || n.startsWith(label); });
  hp.button = (label) => { const b = hp.buttonEl(label); return b ? { name: hp.name(b), pt: hp.pt(b) } : null; };

  // ── the keys, the names, the focus ──
  const STOPS = 'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="radio"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"], [role="textbox"], [tabindex]:not([tabindex="-1"])';
  const describe = (e) => `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''} "${hp.name(e).slice(0, 40)}"`;
  const settle = () => { for (const a of document.getAnimations()) { try { a.finish(); } catch { /* an endless one */ } } };
  const look = (e) => { settle(); return [e, e.parentElement, e.parentElement?.parentElement].filter(Boolean).map((n) => { const cs = getComputedStyle(n); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.borderBottomColor, cs.backgroundColor, cs.textDecorationLine].join('|'); }).join('||'); };
  hp.controls = () => hp.all(STOPS).filter((e) => !e.disabled && e.getAttribute('aria-disabled') !== 'true');
  hp.walk = {
    start() { this.reached = new Set(); this.looks = new Map(); const first = hp.controls()[0]; let a = document.getElementById('__hp_start'); if (!a) { a = document.createElement('div'); a.id = '__hp_start'; a.tabIndex = -1; a.style.cssText = 'position:absolute;width:1px;height:1px;outline:none'; } (first?.parentElement ?? hp.root()).insertBefore(a, first ?? null); a.focus(); return !!first; },
    step() { const a = document.activeElement; if (!a || a === document.body || !hp.inHome(a)) return 'out'; if (this.reached.has(a)) return 'seen'; this.reached.add(a); this.looks.set(a, look(a)); return 'in'; },
    end() {
      document.getElementById('__hp_start')?.remove();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const roving = '[role="radiogroup"], [role="tablist"], [role="toolbar"], [role="listbox"], [role="menubar"], [role="grid"]';
      const all = hp.controls();
      const reached = Array.from(this.reached);
      const missed = all.filter((e) => !this.reached.has(e) && !reached.some((r) => r.contains(e) || e.contains(r)) && !(e.closest(roving) && reached.some((r) => r.closest(roving) === e.closest(roving))));
      return {
        controls: all.length, reached: reached.map(describe), missed: missed.map(describe),
        unnamed: all.filter((e) => !hp.name(e)).map(describe),
        noRing: reached.filter((e) => hp.vis(e) && look(e) === this.looks.get(e)).map(describe),
      };
    },
  };
  hp.upper = () => hp.all('*').filter((e) => hp.own(e).length > 1 && (getComputedStyle(e).textTransform === 'uppercase' || /^[A-Z][A-Z ,]{5,}$/.test(hp.own(e)))).map((e) => hp.own(e).slice(0, 40));

  // ── colour ──
  const rgb = (css) => { const c = (hp._cv ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })); c.clearRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillStyle = css; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1);
  const ground = (e) => { const layers = []; for (let p = e; p; p = p.parentElement) { const c = rgb(getComputedStyle(p).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; } let g = getComputedStyle(document.documentElement).colorScheme.includes('light') ? [255, 255, 255, 1] : [0, 0, 0, 1]; for (const l of layers.reverse()) g = over(l, g); return g; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  hp.contrast = (e) => { const g = ground(e); const ink = over(rgb(getComputedStyle(e).color), g); const a = lum(ink); const b = lum(g); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
  hp.inks = (label) => {
    const out = {};
    const h = hp.all('h1, [role="heading"][aria-level="1"]')[0];
    if (h) out.title = hp.contrast(h);
    const line = hp.all('*').find((e) => hp.own(e) && getComputedStyle(e).fontStyle === 'italic' && !e.closest('h1'));
    if (line) out.line = hp.contrast(line);
    const rowLabel = hp.all('*').find((e) => hp.own(e) === label);
    if (rowLabel) out.rowLabel = hp.contrast(rowLabel);
    return out;
  };
}

// ── One app on one root ─────────────────────────────────────────────────────
function makeSession(root) {
  const S = { ...root, app: null, page: null, cdp: null, shots: 0 };
  S.open = async () => {
    const { app, page, errors } = await launchApp(S.appRoot);
    Object.assign(S, { app, page, cdp: null, _errors: errors });
    await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
    await page.evaluate(LIB);
  };
  S.close = async () => {
    if (!S.app) return;
    for (const e of S._errors ?? []) if (!/Ollama|EmbeddingService|ERR_CONNECTION_REFUSED/.test(e)) pageErrors.push(e);
    await S.app.close().catch(() => {});
    S.app = null; S.page = null;
  };
  S.restart = async () => { await sleep(600); await S.close(); await S.open(); };
  /** Runs `fn(arg)` in the page, with window.__hp there. */
  S.ev = async (fn, arg) => { await S.page.evaluate(LIB); return S.page.evaluate(fn, arg); };
  S.shot = async (name) => { await fs.mkdir(path.join(OUT, 'shots'), { recursive: true }); await screenshot(S.app, S.page, path.join(OUT, 'shots', `${name}.png`)).catch(() => false); };
  S.tabs = () => S.page.evaluate(() => Array.from(document.querySelectorAll('[data-part-id="workbench.parts.editor"] [role="tab"]')).filter((t) => t.getClientRects().length).map((t) => ({ label: t.textContent.replace(/×\s*$/, '').trim(), front: t.getAttribute('aria-selected') === 'true' })));
  S.front = async () => (await S.tabs()).find((t) => t.front)?.label ?? '';
  S.homeTabs = async () => (await S.tabs()).filter((t) => t.label === 'Home').length;
  S.click = async (pt) => { await S.page.mouse.move(pt.x, pt.y); await sleep(80); await S.page.mouse.click(pt.x, pt.y); };
  S.tap = async (pt) => {
    S.cdp ??= await S.page.context().newCDPSession(S.page);
    await S.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
    await sleep(60);
    await S.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  /** Answers "What should Home call you?" when it is asked. Resolves how it was asked, or ''. */
  S.answerName = async (name = NAME) => {
    const q = await S.ev((q) => window.__hp.question(q), QUESTION);
    if (!q?.pt) return q ? q.how : '';
    await S.click(q.pt);
    await S.page.keyboard.press('Control+A');
    await S.page.keyboard.type(name);
    await S.page.keyboard.press('Enter');
    await until(async () => !(await S.ev((q) => window.__hp.question(q), QUESTION)), 3000);
    await sleep(400);
    return q.how;
  };
  /** Home in front; the name answered when asked. */
  S.home = async ({ answer = true } = {}) => { await cmd(S.page, 'home.open'); await sleep(1200); if (answer) await S.answerName(); };
  S.closeHome = async () => { if (!(await S.homeTabs())) return; await cmd(S.page, 'home.open'); await sleep(300); await cmd(S.page, 'workbench.action.closeActiveEditor'); await sleep(500); };
  S.reopenHome = async () => { await S.closeHome(); await S.home(); };
  S.at = (what, arg) => S.ev(({ what, arg }) => window.__hp.at(what, arg), { what, arg });
  S.title = async () => (await S.ev(() => window.__hp.titles()))[0] ?? null;
  /** The page and the file every phase but the empty one starts with, made and opened through the app. */
  S.makePage = async () => {
    const made = await S.page.evaluate(async ({ title, body }) => {
      const t = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' })?.getTool?.('canvas_create_page');
      if (!t) return 'no canvas_create_page';
      const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
      return String((await t.handler({ title, markdown: body }, token))?.content ?? '');
    }, { title: PAGE.title, body: PAGE.body });
    if (!/Created page/.test(made)) throw new Error(`the page could not be made: ${made.slice(0, 160)}`);
    await sleep(1500);
  };
  S.things = async () => {
    await S.makePage();
    const opened = await cmd(S.page, 'file.openFile', path.join(S.workspace, FILE.folder, FILE.name));
    if (opened !== true) throw new Error(`the file could not be opened: ${opened}`);
    await sleep(900);
  };
  S.tool = async (id, on) => {
    const r = await setToolEnabled(S.page, id, on);
    if (r !== true) throw new Error(`the tool ${id} could not be turned ${on ? 'on' : 'off'}: ${r}`);
    await sleep(on ? 2200 : 300);
  };
  S.almanac = () => S.page.evaluate(() => (globalThis.__homeAlmanac ? { ...globalThis.__homeAlmanac, opened: [...globalThis.__homeAlmanac.opened] } : null));
  S.settings = () => S.page.evaluate(() => {
    const reg = window.__parallx_workbench__._services.get({ id: 'ISettingsRegistryService' });
    return reg.getAllSchemas().filter((s) => /^home\./.test(s.key)).map((s) => ({ key: s.key, type: s.type, scope: s.scope, default: s.default, words: `${s.key} ${s.label ?? ''} ${s.description ?? ''}`, enumValues: s.enumValues ?? null, min: s.min ?? null, max: s.max ?? null, value: reg.getValue(s.key) }));
  });
  S.set = (key, value) => S.page.evaluate(async ({ key, value }) => { try { await window.__parallx_workbench__._services.get({ id: 'ISettingsRegistryService' }).setValue(key, value); return true; } catch (e) { return String(e?.message || e); } }, { key, value });
  /** Fixes the page's Date at a local day and hour of this month; timers run on. */
  S.clock = async (hour, day) => {
    const now = new Date();
    const at = new Date(now.getFullYear(), now.getMonth(), day ?? now.getDate(), hour, 0, 0);
    await S.page.clock.setFixedTime(at);
    return at;
  };
  /** Both side areas closed or open, by the title bar's own buttons. */
  S.sides = async (open) => {
    for (const [part, button] of [['workbench.parts.sidebar', 'Toggle Left Area'], ['workbench.parts.auxiliarybar', 'Toggle Right Area']]) {
      const w = await S.ev((id) => window.__hp.partWidth(id), part);
      if ((w > 0) !== open) { await S.page.locator(`[data-part-id="workbench.parts.titlebar"] [aria-label="${button}"]`).first().click(); await sleep(500); }
    }
  };
  return S;
}

const findSetting = (list, words, type) => list.find((s) => words.test(s.words) && (!type || type.test(s.type)));
const display = (face) => face === 'Newsreader';
const greeting = (word, name) => new RegExp(`^Good ${word}, ?${name}[.!]?$`);

// ── The phases ──────────────────────────────────────────────────────────────
const PHASES = [];
const phase = (n, title, opts, checks, fn) => PHASES.push({ n, title, opts, checks, fn });

phase(0, 'The ground: Home is a tab like any other (holds today)', {}, {
  '0.1': '`home.open` opens a tab named Home, in front',
  '0.2': 'run again, there is still one Home tab',
  '0.3': 'the mark in the title bar, a button named Home, opens it by a click',
  '0.4': 'it closes by its own × like any tab, and stays closed',
  '0.5': 'a page and a file last worked on are on Home by their titles, and a click on a title opens the thing',
}, async (S, c) => {
  await S.things();
  await cmd(S.page, 'home.open'); await sleep(1200);
  c('0.1', (await S.front()) === 'Home', await S.tabs());
  await cmd(S.page, 'home.open'); await sleep(600);
  c('0.2', (await S.homeTabs()) === 1 && (await S.front()) === 'Home', await S.tabs());
  await S.answerName();
  // 0.4 first: the tab's own close.
  const x = await S.page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll('[data-part-id="workbench.parts.editor"] [role="tab"]')).find((t) => t.textContent.replace(/×\s*$/, '').trim() === 'Home');
    const close = tab && Array.from(tab.querySelectorAll('*')).find((e) => /close/i.test(e.getAttribute('aria-label') || '') || e.textContent.trim() === '×');
    if (!close) return null;
    const r = close.getBoundingClientRect(); const t = tab.getBoundingClientRect();
    return { tab: { x: t.left + 20, y: t.top + t.height / 2 }, close: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
  });
  if (x) { await S.page.mouse.move(x.tab.x, x.tab.y); await sleep(150); await S.page.mouse.click(x.close.x, x.close.y); }
  await sleep(2000);
  c('0.4', !!x && (await S.homeTabs()) === 0, { close: x, tabs: await S.tabs() });
  await S.page.locator('[data-part-id="workbench.parts.titlebar"] button[aria-label="Home"]').first().click();
  await sleep(1200);
  c('0.3', (await S.front()) === 'Home' && (await S.homeTabs()) === 1, await S.tabs());
  await S.answerName();
  const seen = await S.ev((titles) => window.__hp.shown(titles), [PAGE.title, FILE.name]);
  const at = await S.at('title', PAGE.title);
  if (at) { await S.click(at); await sleep(1200); }
  c('0.5', seen.length === 2 && (await S.front()) === PAGE.title, { onHome: seen, front: await S.front() });
});

phase(1, 'The title: a greeting by the hour and by name, asked once (2A)', {}, {
  '1.1': 'Home has one title, a level-1 heading, in the display face (Newsreader) and large',
  '1.2': 'with no name known, Home asks "What should Home call you?" and there is a field to answer in',
  '1.3': 'a name typed and Enter: the title is "Good morning, Ada", "Good afternoon, Ada" or "Good evening, Ada" and the question is gone',
  '1.4': 'the name is the one italic word of the title; the rest stands upright',
  '1.5': 'by the hour: 08:00 says Good morning, 14:00 Good afternoon, 20:00 Good evening',
  '1.6': 'one italic line under the title carries today\'s date: the weekday, the day and the month',
  '1.7': 'the name is kept as a setting (a string under `home.`), and the setting changed, the title follows',
  '1.8': 'Home closed and opened again: the name is not asked a second time',
  '1.9': 'the app closed and opened again: still not asked, the title still has the name',
}, async (S, c) => {
  await S.things();
  await S.home({ answer: false });
  const before = await S.ev(() => window.__hp.titles());
  c('1.1', before.length === 1 && display(before[0].face) && before[0].px >= 28, before.length ? before : 'no level-1 heading on Home');
  const q = await S.ev((q) => window.__hp.question(q), QUESTION);
  c('1.2', !!q?.pt, q ?? `"${QUESTION}" is nowhere on screen`);
  await S.shot('1-name-asked');
  await S.answerName(NAME);
  const t = await S.title();
  const asked = await S.ev((q) => window.__hp.question(q), QUESTION);
  c('1.3', !!q?.pt && !!t && /^Good (morning|afternoon|evening), ?Ada[.!]?$/.test(t.text) && !asked, { title: t?.text ?? null, stillAsked: !!asked });
  c('1.4', !!t && t.italic.length === 1 && t.italic[0].replace(/[.,!]/g, '') === NAME && t.upright.length > 0 && t.upright.every((u) => !u.includes(NAME)), t ? { italic: t.italic, upright: t.upright } : 'no title');
  const said = {};
  for (const [hour, word] of [[8, 'morning'], [14, 'afternoon'], [20, 'evening']]) {
    await S.clock(hour);
    await S.reopenHome();
    said[word] = (await S.title())?.text ?? null;
    if (word === 'morning') await S.shot('1-good-morning');
  }
  c('1.5', ['morning', 'afternoon', 'evening'].every((w) => greeting(w, NAME).test(said[w] ?? '')), said);
  const day = await S.clock(8, 20);
  await S.reopenHome();
  const names = { weekday: day.toLocaleDateString('en-US', { weekday: 'long' }), month: day.toLocaleDateString('en-US', { month: 'long' }) };
  const lines = await S.ev(() => window.__hp.italicLines());
  const head = await S.title();
  const dated = lines.filter((l) => l.text.includes(names.weekday) && l.text.includes(names.month) && /\b20\b/.test(l.text));
  c('1.6', !!head && dated.length >= 1 && dated[0].top >= head.bottom - 4, { want: `${names.weekday} 20 ${names.month}`, italicLines: lines.slice(0, 6), titleBottom: head?.bottom ?? null });
  const settings = await S.settings();
  const nameSetting = findSetting(settings, /name|call/i, /string|text/);
  let followed = null;
  if (nameSetting) { await S.set(nameSetting.key, 'Grace'); await S.reopenHome(); followed = (await S.title())?.text ?? null; }
  c('1.7', !!nameSetting && nameSetting.value === NAME && /^Good morning, ?Grace[.!]?$/.test(followed ?? ''), { underHome: settings.map((s) => `${s.key}=${JSON.stringify(s.value)}`), afterGrace: followed });
  await S.closeHome(); await S.home({ answer: false });
  const again = await S.ev((q) => window.__hp.question(q), QUESTION);
  c('1.8', !!q?.pt && !again && /Grace|Ada/.test((await S.title())?.text ?? ''), { asked: !!again, title: (await S.title())?.text ?? null });
  await S.restart();
  await S.home({ answer: false });
  const third = await S.ev((q) => window.__hp.question(q), QUESTION);
  const kept = (await S.title())?.text ?? null;
  c('1.9', !!q?.pt && !third && /^Good (morning|afternoon|evening), ?(Grace|Ada)[.!]?$/.test(kept ?? ''), { asked: !!third, title: kept });
});

phase(2, 'One wide field to ask, and the words go to the chat (1A)', {}, {
  '2.1': 'under the title there is one wide field to ask in (its placeholder or name begins "Ask"), the widest field on Home',
  '2.2': 'Enter in the empty field sends nothing to the chat',
  '2.3': 'words typed and Enter: the chat opens (it was closed) and has the words',
  '2.4': 'nothing else on Home changed: Home is still in front with the same title',
  '2.5': 'a second question reaches the chat too',
}, async (S, c) => {
  await S.things();
  await S.home();
  const ask = await S.ev(() => window.__hp.ask());
  const head = await S.title();
  c('2.1', !!ask && ask.width >= 400 && ask.others.every((w) => w <= ask.width) && (!head || ask.top >= head.bottom - 4), ask ?? 'no field on Home whose placeholder or name begins "Ask"');
  await S.shot('2-ask');
  await S.sides(false);
  const closed = (await S.ev((id) => window.__hp.partWidth(id), 'workbench.parts.auxiliarybar')) === 0;
  let empty = null;
  const a1 = await S.ev(() => window.__hp.ask());
  if (a1) { await S.click(await S.at('ask')); await S.page.keyboard.press('Enter'); await sleep(1500); empty = { chatOpen: (await S.ev((id) => window.__hp.partWidth(id), 'workbench.parts.auxiliarybar')) > 0, front: await S.front() }; }
  c('2.2', !!a1 && closed && !empty.chatOpen && empty.front === 'Home', a1 ? { chatWasClosed: closed, ...empty } : 'no field to ask in');
  const titleBefore = (await S.title())?.text ?? null;
  const words = 'which paper covers the tail beyond the last age';
  let where = '';
  if (a1) {
    await S.click(await S.at('ask')); await S.page.keyboard.type(words); await S.page.keyboard.press('Enter');
    where = await until(() => S.ev((w) => window.__hp.outside(w), words), 6000);
  }
  const chatWidth = await S.ev((id) => window.__hp.partWidth(id), 'workbench.parts.auxiliarybar');
  c('2.3', !!a1 && closed && !!where && chatWidth > 0, a1 ? { wordsIn: where || 'nowhere outside Home', chatWidth } : 'no field to ask in');
  await S.shot('2-asked');
  c('2.4', !!a1 && (await S.front()) === 'Home' && !!titleBefore && (await S.title())?.text === titleBefore, { front: await S.front(), before: titleBefore, after: (await S.title())?.text ?? null });
  const second = 'and what did I leave open yesterday';
  let where2 = '';
  const a2 = await S.ev(() => window.__hp.ask());
  if (a2) { await S.click(await S.at('ask')); await S.page.keyboard.press('Control+A'); await S.page.keyboard.type(second); await S.page.keyboard.press('Enter'); where2 = await until(() => S.ev((w) => window.__hp.outside(w), second), 6000); }
  c('2.5', !!a2 && !!where2, a2 ? { wordsIn: where2 || 'nowhere outside Home' } : 'no field to ask in');
});

phase(3, 'Today, from your tools: one card a tool, through home.registerCard (3B)', {}, {
  '3.1': 'the row is labelled "Today, from your tools", in those words, and a screen reader hears them as the row\'s name',
  '3.2': 'the `home` API has registerCard, it returns a disposable, and the tool that called it has its card in the row',
  '3.3': 'the card says where it is from (the tool\'s name), the number with its unit, the line, and has exactly one button, the action',
  '3.4': 'the number is the card\'s largest text, in the display face',
  '3.5': 'a click on the action runs the tool\'s command, once',
  '3.6': 'Enter on the action runs it too',
  '3.7': 'the tool takes its card back and the card leaves at once; put again with another number, it shows that number',
  '3.8': 'Flashcards with cards due has its card: its name, the number its own page gives as due today, a unit with "due", one action',
  '3.9': 'that action starts Flashcards\' study session',
  '3.10': 'the tool turned off: its card and its things in the feed leave within 3 seconds, no restart, and Home says its name nowhere',
  '3.11': 'turned on again: the card and the things are back',
  '3.12': 'Flashcards turned off, its card leaves; turned on, it is back',
  '3.13': 'the app closed and opened again: both cards are there without anything being done',
}, async (S, c) => {
  await S.things();
  await S.tool(TOOL.id, true);
  await S.tool(FLASHCARDS, true);
  const deck = await S.page.evaluate(async () => { const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' }); try { return await svc.executeCommand('flashcards.addCards', { deckName: 'Probe Deck', cards: [{ front: 'Tail factor', back: '1' }, { front: 'Growth curve', back: '2' }, { front: 'On-level premium', back: '3' }] }); } catch (e) { return String(e?.message || e); } });
  await cmd(S.page, 'flashcards.open'); await sleep(1500);
  const due = Number((/(\d+) cards? due today/.exec(await S.ev(() => window.__hp.text(window.__hp.root()))) || [])[1] || 0);
  if (!due) throw new Error(`Flashcards shows no cards due after ${JSON.stringify(deck)}`);
  await S.home();
  const cards = () => S.ev((l) => window.__hp.cards(l), ROW);
  const mine = async () => (await cards()).find((x) => x.text.includes(TOOL.name)) ?? null;
  const label = await S.ev((l) => ({ words: window.__hp.rowLabel(l), named: !!window.__hp.rowEl(l) }), ROW);
  c('3.1', label.words.length === 1 && label.named && label.words[0].transform !== 'uppercase', label.words.length ? label : `"${ROW}" is not on Home`);
  const g = await S.almanac();
  const card = await mine();
  c('3.2', !!g?.cardApi && g.disposable === true && !g.cardError && !!card, { tool: g ? { registerCard: g.cardApi, disposable: g.disposable, error: g.cardError } : 'the probe\'s tool is not running', card: card?.text ?? 'no card' });
  await S.shot('3-cards');
  const has = (t) => !!card && card.texts.some((x) => x.t === t || x.t.includes(t));
  c('3.3', !!card && has(TOOL.name) && card.texts.some((x) => x.t === '7') && has(TOOL.unit) && has(TOOL.line) && card.buttons.length === 1 && card.buttons[0] === TOOL.action, card ? { text: card.text, buttons: card.buttons } : 'no card');
  const num = card?.texts.find((x) => x.t === '7');
  c('3.4', !!num && display(num.face) && card.texts.every((x) => x === num || x.px < num.px), card ? card.texts : 'no card');
  const at = await S.ev(({ l, n }) => window.__hp.cardButton(l, n), { l: ROW, n: TOOL.name });
  if (at) { await S.click(at); await sleep(700); }
  const ran1 = (await S.almanac())?.ran ?? 0;
  c('3.5', !!at && ran1 === 1, { button: !!at, commandRan: ran1 });
  const focused = await S.ev(({ l, n }) => window.__hp.focusCardButton(l, n), { l: ROW, n: TOOL.name });
  if (focused) { await S.page.keyboard.press('Enter'); await sleep(700); }
  const ran2 = (await S.almanac())?.ran ?? 0;
  c('3.6', focused && ran2 === ran1 + 1, { focused, commandRan: ran2 });
  await cmd(S.page, 'almanac.takeCardBack');
  const gone = !!card && !!(await until(async () => !(await mine()), 3000));
  await cmd(S.page, 'almanac.putCard', 12);
  const back = await until(async () => { const m = await mine(); return m?.texts.some((x) => x.t === '12') ? m : null; }, 3000);
  c('3.7', gone && !!back, { leftWhenTakenBack: gone, after: back?.text ?? (await mine())?.text ?? 'no card' });
  const fc = (await cards()).find((x) => x.text.includes('Flashcards')) ?? null;
  c('3.8', !!fc && fc.texts.some((x) => x.t === String(due)) && /\bdue\b/i.test(fc.text) && fc.buttons.length === 1, { dueOnFlashcardsOwnPage: due, card: fc ? { text: fc.text, buttons: fc.buttons } : 'no card from Flashcards' });
  const fcAt = await S.ev(({ l, n }) => window.__hp.cardButton(l, n), { l: ROW, n: 'Flashcards' });
  let study = null;
  if (fcAt) { await S.click(fcAt); await sleep(1800); study = { front: await S.front(), pane: (await S.ev(() => window.__hp.text(window.__hp.root()))).slice(0, 200) }; }
  c('3.9', !!study && study.front === 'Flashcards' && new RegExp(`\\b1 / ${due}\\b`).test(study.pane) && !/cards? due today/.test(study.pane), study ?? 'no action on a Flashcards card');
  await S.home();
  // Off and on, with Home open.
  const things = () => S.ev((t) => window.__hp.shown(t), [THINGS.one, THINGS.ten, THINGS.forty]);
  const hadThings = (await things()).length;
  const t0 = Date.now();
  await S.tool(TOOL.id, false);
  const left = await until(async () => !(await mine()) && (await things()).length === 0, 3000, 100);
  const ms = Date.now() - t0;
  const named = (await S.ev(() => window.__hp.text(window.__hp.root()))).includes(TOOL.name);
  c('3.10', !!card && hadThings > 0 && !!left && !named, { cardWasThere: !!card, thingsWereThere: hadThings, left: !!left, ms, nameStillOnHome: named });
  await S.shot('3-tool-off');
  await S.tool(TOOL.id, true);
  const returned = await until(async () => (await mine()) && (await things()).length > 0, 4000);
  c('3.11', !!card && !!returned, { card: (await mine())?.text ?? 'no card', things: await things() });
  const hasFc = async () => (await cards()).some((x) => x.text.includes('Flashcards'));
  const fcBefore = await hasFc();
  await S.tool(FLASHCARDS, false);
  await S.home();
  const fcLeft = await until(async () => !(await hasFc()), 3000);
  await S.tool(FLASHCARDS, true);
  await S.home();
  const fcBack = await until(hasFc, 5000);
  c('3.12', fcBefore && !!fcLeft && !!fcBack, { before: fcBefore, leftWhenOff: !!fcLeft, backWhenOn: !!fcBack });
  await S.restart();
  await S.home();
  const after = await until(async () => { const all = await cards(); return all.some((x) => x.text.includes(TOOL.name)) && all.some((x) => x.text.includes('Flashcards')) ? all : null; }, 6000);
  c('3.13', !!after, (await cards()).map((x) => x.text));
});

phase(4, 'The feed: each thing last worked on, shown as itself (1A)', {}, {
  '4.1': 'the page and the file last worked on are each an entry (a list item or article), its title in the display face',
  '4.2': 'each says where it is: the file its folder, the page that it is a page',
  '4.3': 'each has its own opening text, in two lines at most',
  '4.4': 'each has a picture of the thing (48 px or more each way), not an icon',
  '4.5': 'each has one number or time at its right',
  '4.6': 'a tool\'s own thing is an entry among them, with its place, its opening words and its tag',
  '4.7': 'newest first: the page and the file of just now stand over the tool\'s thing of an hour ago, and that over its older ones',
  '4.8': 'top to bottom the page is: the title, the field to ask, today from the tools, the feed',
  '4.9': 'focus on an entry and Enter opens it: the file',
  '4.10': 'the tool\'s thing opens through the tool: a click on it calls the tool\'s own open',
}, async (S, c) => {
  await S.things();
  await S.tool(TOOL.id, true);
  await S.home();
  const read = () => S.ev(({ page, file, one }) => ({ page: window.__hp.entry(page.title, page.opening), file: window.__hp.entry(file.name, file.opening), one: window.__hp.entry(one.title, one.opening) }), { page: PAGE, file: FILE, one: { title: THINGS.one, opening: THINGS.opening } });
  await until(async () => { const e = await read(); return e.page && e.file && e.one; }, 4000);
  const e = await read();
  const both = [e.page, e.file];
  const boxed = both.every((x) => x?.box);
  const brief = (x) => (x ? { box: x.box, face: x.titleFace, text: (x.text ?? '').slice(0, 200), pictures: x.pictures, right: x.right, excerpt: x.excerpt } : 'not on Home');
  c('4.1', boxed && both.every((x) => display(x.titleFace)), { page: e.page ? { entry: e.page.box, face: e.page.titleFace } : 'not on Home', file: e.file ? { entry: e.file.box, face: e.file.titleFace } : 'not on Home' });
  await S.shot('4-feed');
  c('4.2', boxed && e.file.text.includes(FILE.folder) && /\b(Page|Canvas)\b/.test(e.page.text.replace(PAGE.title, '')), { page: brief(e.page), file: brief(e.file) });
  c('4.3', boxed && both.every((x) => x.excerpt && x.excerpt.lines <= 2.3), { page: e.page?.excerpt ?? 'opening words not in the entry', file: e.file?.excerpt ?? 'opening words not in the entry' });
  c('4.4', boxed && both.every((x) => x.pictures.length >= 1), { page: e.page?.pictures ?? null, file: e.file?.pictures ?? null });
  c('4.5', boxed && both.every((x) => x.right.length >= 1 && x.right.some((t) => /\d|now|today|yesterday|ago/i.test(t))), { page: e.page?.right ?? null, file: e.file?.right ?? null });
  c('4.6', !!e.one?.box && display(e.one.titleFace) && e.one.text.includes(THINGS.where) && e.one.text.includes(THINGS.opening) && e.one.text.includes(THINGS.tag), brief(e.one));
  const tops = await S.ev(({ l, titles }) => window.__hp.tops(l, titles), { l: ROW, titles: [FILE.name, PAGE.title, THINGS.one, THINGS.ten, THINGS.forty] });
  const [fileTop, pageTop, oneTop, tenTop, fortyTop] = tops.things;
  const older = [oneTop, tenTop, fortyTop].filter((v) => v !== null);
  c('4.7', boxed && !!e.one?.box && fileTop < oneTop && pageTop < oneTop && older.every((v, i) => i === 0 || older[i - 1] < v), { file: fileTop, page: pageTop, anHourAgo: oneTop, tenDaysAgo: tenTop, fortyDaysAgo: fortyTop });
  const feedTop = Math.min(fileTop ?? Infinity, pageTop ?? Infinity);
  c('4.8', boxed && [tops.title, tops.ask, tops.row].every((v) => v !== null) && tops.title < tops.ask && tops.ask < tops.row && tops.row < feedTop, { title: tops.title, ask: tops.ask, row: tops.row, feed: Number.isFinite(feedTop) ? feedTop : null });
  const focused = await S.ev((t) => window.__hp.focusEntry(t), FILE.name);
  if (focused) { await S.page.keyboard.press('Enter'); await sleep(1200); }
  c('4.9', focused && (await S.front()).endsWith(FILE.name), { focused, front: await S.front() });
  await S.home();
  const at = (await S.ev((t) => !!window.__hp.entryEl(t), THINGS.one)) ? await S.at('title', THINGS.one) : null;
  if (at) { await S.click(at); await sleep(700); }
  c('4.10', !!at && ((await S.almanac())?.opened ?? []).join() === 'one', { entry: !!at, toolOpened: (await S.almanac())?.opened ?? null });
});

phase(5, 'The filter words over the feed, and a thing pinned (1A)', {}, {
  '5.1': 'over the feed are the words "picked up", "pinned", "this week", "this month" and "all", each a control named so, none in capitals',
  '5.2': '"all" shows the things of an hour, ten days and forty days ago',
  '5.3': '"this month" shows those of an hour and ten days ago, not the one of forty days',
  '5.4': '"this week" shows the one of an hour ago only',
  '5.5': 'the word chosen says so to a screen reader, and the other two ranges do not',
  '5.6': 'a thing can be pinned, from its entry',
  '5.7': '"pinned" shows the pinned thing only; "picked up" shows them all again',
  '5.8': 'Home closed and opened: "pinned" still shows it',
  '5.9': 'unpinned, it leaves "pinned"',
}, async (S, c) => {
  await S.things();
  await S.tool(TOOL.id, true);
  await S.clock(14, 20);
  await S.home();
  const ALL = [THINGS.one, THINGS.ten, THINGS.forty];
  const shown = () => S.ev((t) => window.__hp.shown(t), ALL);
  const filters = () => S.ev((words) => Object.fromEntries(words.map((w) => [w, window.__hp.filter(w)])), FILTERS);
  const pick = async (word) => { const at = await S.at('filter', word); if (!at) return false; await S.click(at); await sleep(700); return true; };
  const f0 = await filters();
  const there = FILTERS.every((w) => f0[w]);
  c('5.1', there && FILTERS.every((w) => f0[w].transform !== 'uppercase' && f0[w].shown !== f0[w].shown.toUpperCase()), Object.fromEntries(FILTERS.map((w) => [w, f0[w] ? f0[w].shown : 'no control named so'])));
  await S.shot('5-filters');
  const got = {};
  for (const w of ['all', 'this month', 'this week']) got[w] = (await pick(w)) ? await shown() : null;
  const same = (a, b) => !!a && a.length === b.length && b.every((x) => a.includes(x));
  c('5.2', same(got.all, ALL), got.all ?? 'no control named "all"');
  c('5.3', same(got['this month'], [THINGS.one, THINGS.ten]), got['this month'] ?? 'no control named "this month"');
  c('5.4', same(got['this week'], [THINGS.one]), got['this week'] ?? 'no control named "this week"');
  const f1 = await filters();
  c('5.5', there && f1['this week'].on && !f1['this month'].on && !f1.all.on, there ? Object.fromEntries(['this week', 'this month', 'all'].map((w) => [w, f1[w].on])) : 'the filter words are not there');
  await pick('all'); await pick('picked up');
  // Pin the thing of ten days ago: a button in its entry, or its context menu.
  const pinIt = async (title, un) => {
    const b = await S.ev(({ t, un }) => window.__hp.pin(t, un), { t: title, un });
    if (b) { await S.click(b.pt); await sleep(600); return `the entry's button "${b.name}"`; }
    const at = (await S.ev((t) => !!window.__hp.entryEl(t), title)) ? await S.at('title', title) : null;
    if (!at) return '';
    await S.page.mouse.click(at.x, at.y, { button: 'right' }); await sleep(500);
    const picked = await pickMenu(S.page, un ? /^Unpin\b/ : /^Pin\b/).catch(() => false);
    if (!picked) { await S.page.keyboard.press('Escape'); return ''; }
    await sleep(600);
    return 'the entry\'s context menu';
  };
  const how = await pinIt(THINGS.ten, false);
  c('5.6', !!how, how || 'no button named "Pin…" in the entry, and no "Pin…" in its context menu');
  const pinned = (await pick('pinned')) ? await shown() : null;
  await S.shot('5-pinned');
  const picked = (await pick('picked up')) ? await shown() : null;
  c('5.7', !!how && same(pinned, [THINGS.ten]) && same(picked, ALL), { pinned, pickedUp: picked });
  await S.reopenHome();
  await pick('all');
  const later = (await pick('pinned')) ? await shown() : null;
  c('5.8', !!how && same(later, [THINGS.ten]), later ?? 'no control named "pinned"');
  const off = how ? await pinIt(THINGS.ten, true) : '';
  await pick('pinned');
  const none = await shown();
  c('5.9', !!how && !!off && none.length === 0, { unpinnedBy: off || 'nothing to unpin with', pinnedShows: none });
});

phase(6, 'A workspace with nothing in it: Welcome to Parallx, with first steps (4A)', { things: false, ext: false }, {
  '6.1': 'the app opens on Home by itself: Home is the tab in front at the first launch',
  '6.2': 'its title is "Welcome to Parallx", in the display face, with one italic word',
  '6.3': 'the first steps are three buttons: Open a Folder…, New Page, Turn On Tools…',
  '6.4': 'the app closed and opened, the workspace still empty: Home in front, Welcome to Parallx still',
  '6.5': 'Open a Folder… asks for a folder: the computer\'s folder dialog opens',
  '6.6': 'Turn On Tools…, by Enter, opens Tools and Extensions',
  '6.7': 'New Page makes a page and opens it',
  '6.8': 'with something in the workspace, Home is no longer the welcome: the title greets, and the page is on it',
}, async (S, c) => {
  await sleep(1500);
  const first = await S.tabs();
  c('6.1', first.find((t) => t.front)?.label === 'Home', first);
  if (!(await S.homeTabs())) { await cmd(S.page, 'home.open'); await sleep(1200); }
  const t = await S.title();
  c('6.2', !!t && t.text === 'Welcome to Parallx' && display(t.face) && t.italic.length === 1, t ?? 'no level-1 heading on Home');
  const steps = () => S.ev((labels) => labels.map((l) => { const b = window.__hp.buttonEl(l); return b ? { name: window.__hp.name(b) } : null; }), STEPS);
  const stepAt = (i) => S.ev((l) => window.__hp.button(l)?.pt ?? null, STEPS[i]);
  const s = await steps();
  c('6.3', s.every(Boolean), Object.fromEntries(STEPS.map((l, i) => [l, s[i]?.name ?? 'no button named so'])));
  await S.shot('6-welcome');
  await S.answerName();
  await S.restart();
  await sleep(1500);
  const frontAgain = await S.front();
  const again = await S.title();
  c('6.4', frontAgain === 'Home' && again?.text === 'Welcome to Parallx', { front: frontAgain, title: again?.text ?? null });
  if (frontAgain !== 'Home') { await cmd(S.page, 'home.open'); await sleep(1200); }
  // The folder dialog, replaced by one that records the call and cancels.
  await S.app.evaluate(({ dialog }) => { globalThis.__homeProbeDialogs = []; dialog.showOpenDialog = async (...args) => { globalThis.__homeProbeDialogs.push(args[args.length - 1]?.properties ?? []); return { canceled: true, filePaths: [] }; }; });
  const s2 = await steps();
  if (s2[0]) { await S.click(await stepAt(0)); await sleep(1000); }
  const dialogs = await S.app.evaluate(() => globalThis.__homeProbeDialogs);
  c('6.5', !!s2[0] && dialogs.length === 1 && dialogs[0].includes('openDirectory'), { button: !!s2[0], dialogs });
  const focusedTools = await S.ev((l) => { const b = window.__hp.buttonEl(l); if (!b) return false; b.focus(); return document.activeElement === b; }, STEPS[2]);
  if (focusedTools) { await S.page.keyboard.press('Enter'); await sleep(1500); }
  c('6.6', focusedTools && (await S.front()) === 'Tools and Extensions', { focused: focusedTools, front: await S.front() });
  await cmd(S.page, 'home.open'); await sleep(1000);
  const s3 = await steps();
  const tabsBefore = (await S.tabs()).length;
  if (s3[1]) { await S.click(await stepAt(1)); await sleep(1800); }
  const canvas = await S.page.evaluate(() => Array.from(document.querySelectorAll('[data-part-id="workbench.parts.editor"] [data-px-surface="canvas"]')).some((e) => e.getClientRects().length));
  c('6.7', !!s3[1] && canvas && (await S.front()) !== 'Home' && (await S.tabs()).length === tabsBefore + 1, { button: !!s3[1], front: await S.front(), aPageIsOpen: canvas });
  await S.makePage();
  await S.closeHome(); await S.home();
  const later = await S.title();
  const onHome = await S.ev((t) => window.__hp.shown(t), [PAGE.title]);
  c('6.8', !!later && /^Good (morning|afternoon|evening)\b/.test(later.text) && onHome.length === 1, { title: later?.text ?? null, pageOnHome: onHome.length === 1 });
  await S.shot('6-after-first-page');
});

phase(7, 'The old Welcome is gone', { ext: false }, {
  '7.1': 'at a first launch no tab says Welcome, and Home is among the tabs',
  '7.2': 'no command opens a Welcome page: none has Welcome in its id or title',
  '7.3': 'the Help menu opens and has no Welcome entry',
}, async (S, c) => {
  await sleep(1500);
  const tabs = await S.tabs();
  c('7.1', !tabs.some((t) => /welcome/i.test(t.label)) && tabs.some((t) => t.label === 'Home'), tabs.map((t) => t.label));
  const commands = await S.page.evaluate(() => Array.from(window.__parallx_workbench__._services.get({ id: 'ICommandService' }).getCommands().values()).filter((d) => /welcome/i.test(`${d.id} ${d.title ?? ''}`)).map((d) => `${d.id} (${d.title ?? ''})`));
  c('7.2', commands.length === 0, commands);
  await S.page.locator('[data-part-id="workbench.parts.titlebar"]').getByText('Help', { exact: true }).first().click();
  await sleep(500);
  const rows = (await menuRows(S.page)) ?? [];
  await S.shot('7-help-menu');
  await S.page.keyboard.press('Escape');
  c('7.3', rows.length > 0 && !rows.some((r) => /welcome/i.test(`${r.label} ${r.id}`)), rows.map((r) => r.label));
});

phase(8, 'Settings: opening on Home, per workspace; the width of the content', { ext: false }, {
  '8.1': 'there is a setting for opening on Home: a boolean under `home.`, kept per workspace, on to begin with',
  '8.2': 'with it on and another tab in front, the app closed and opened: Home is in front',
  '8.3': 'with it off, closed and opened: the tab that was in front is in front, not Home',
  '8.4': 'it is per workspace: a second workspace, in the same profile, opens on Home',
  '8.5': 'turned on again in the first workspace, closed and opened: Home is in front',
  '8.6': 'there is a setting for the width of Home\'s content, under `home.`',
  '8.7': 'changed, the content\'s width changes: the field to ask in is measured at each value, in a 1400 px window with both sides closed',
}, async (S, c) => {
  await S.things();
  await S.home();
  await cmd(S.page, 'file.openFile', path.join(S.workspace, FILE.folder, FILE.name)); await sleep(800);
  const all = await S.settings();
  const open = findSetting(all, /open|start|launch/i, /boolean/);
  c('8.1', !!open && open.scope === 'workspace' && open.default === true && open.value === true, { underHome: all.map((s) => `${s.key} (${s.type}, ${s.scope}, default ${JSON.stringify(s.default)})`) });
  const wasFront = await S.front();
  await S.restart(); await sleep(1500);
  c('8.2', wasFront.endsWith(FILE.name) && (await S.front()) === 'Home', { before: wasFront, after: await S.front() });
  let off = null;
  if (open) {
    await S.set(open.key, false);
    await cmd(S.page, 'file.openFile', path.join(S.workspace, FILE.folder, FILE.name)); await sleep(800);
    await S.restart(); await sleep(1500);
    off = await S.front();
  }
  c('8.3', !!open && !!off && off.endsWith(FILE.name), open ? { front: off } : 'no such setting to turn off');
  // A second workspace on the same profile.
  await S.close();
  const second = await newWorkspace(S.dir, 'workspace-two', true);
  await fs.writeFile(path.join(S.appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: second }));
  await S.open(); await sleep(1500);
  const there = await S.front();
  const valueThere = open ? (await S.settings()).find((s) => s.key === open.key)?.value : undefined;
  c('8.4', !!open && off !== null && there === 'Home' && valueThere === true, open ? { front: there, settingThere: valueThere } : { front: there, setting: 'none' });
  await S.close();
  await fs.writeFile(path.join(S.appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: S.workspace }));
  await S.open(); await sleep(1500);
  let on = null;
  if (open) {
    const stillOff = (await S.settings()).find((s) => s.key === open.key)?.value;
    await S.set(open.key, true);
    await cmd(S.page, 'file.openFile', path.join(S.workspace, FILE.folder, FILE.name)); await sleep(800);
    await S.restart(); await sleep(1500);
    on = { wasStillOffHere: stillOff === false, front: await S.front() };
  }
  c('8.5', !!on && on.wasStillOffHere && on.front === 'Home', on ?? 'no such setting to turn on');
  const width = findSetting(await S.settings(), /width/i);
  c('8.6', !!width, width ? `${width.key} (${width.type})` : { underHome: (await S.settings()).map((s) => s.key) });
  const measured = {};
  if (width) {
    await S.home(); await S.sides(false);
    const values = width.type === 'enum' ? width.enumValues ?? [] : width.type === 'boolean' ? [false, true] : width.type === 'number' ? [width.min ?? 600, width.max ?? 1600] : [];
    for (const v of values) { await S.set(width.key, v); await sleep(700); measured[String(v)] = (await S.ev(() => window.__hp.ask()))?.width ?? null; }
    await S.shot('8-widest');
  }
  const widths = Object.values(measured);
  c('8.7', !!width && widths.length >= 2 && widths.every((w) => w !== null) && new Set(widths).size >= 2, width ? measured : 'no such setting to change');
});

phase(9, 'Everyone can use it: the keys, a name, the focus shown, a finger, the words, light and dark', {}, {
  '9.1': 'Tab alone reaches the field to ask, a card\'s action, a filter word and a feed entry, and no control of Home is left out',
  '9.2': 'every control of Home has a name for a screen reader',
  '9.3': 'every control Tab stops on shows that it has the focus',
  '9.4': 'a finger works: a tap on the card\'s action runs the tool\'s command',
  '9.5': 'no label of Home is in capitals, the row\'s label and the filter words among them',
  '9.6': 'in dark and in light the title, the line under it and the row\'s label can be read (contrast 4.5 or more)',
}, async (S, c) => {
  await S.things();
  await S.tool(TOOL.id, true);
  await S.home();
  await until(async () => (await S.ev((l) => window.__hp.cards(l), ROW)).length > 0, 3000);
  // The walk: Tab from the first control of Home until the focus leaves it.
  await S.ev(() => window.__hp.walk.start());
  for (let i = 0; i < 120; i++) {
    await S.page.keyboard.press('Tab');
    const r = await S.page.evaluate(() => window.__hp.walk.step());
    if (r === 'out' && i > 0) break;
  }
  const marks = await S.ev(({ l, n, f, t }) => {
    const hp = window.__hp; const reached = Array.from(hp.walk.reached);
    const hit = (e) => !!e && reached.some((r) => r === e || e.contains(r) || r.contains(e));
    return { ask: hit(hp.askEl()), action: hit(hp.cardEls(l).find((x) => hp.text(x).includes(n))), filter: hit(hp.filterEl(f)), entry: hit(hp.entryEl(t)) };
  }, { l: ROW, n: TOOL.name, f: 'pinned', t: THINGS.one });
  const walk = await S.ev(() => window.__hp.walk.end());
  const newOnes = marks.ask && marks.action && marks.filter && marks.entry;
  c('9.1', newOnes && walk.missed.length === 0, { reachedTheNewControls: marks, leftOut: walk.missed, stops: walk.reached.length });
  c('9.2', newOnes && walk.unnamed.length === 0, { reachedTheNewControls: marks, unnamed: walk.unnamed });
  c('9.3', newOnes && walk.noRing.length === 0, { reachedTheNewControls: marks, noFocusShown: walk.noRing });
  const before = (await S.almanac())?.ran ?? 0;
  const at = await S.ev(({ l, n }) => window.__hp.cardButton(l, n), { l: ROW, n: TOOL.name });
  if (at) { await S.tap(at); await sleep(800); }
  const after = (await S.almanac())?.ran ?? 0;
  c('9.4', !!at && after === before + 1, { button: !!at, commandRan: after - before });
  const copy = await S.ev(({ l, words }) => ({ row: window.__hp.rowLabel(l).length, filters: words.filter((w) => window.__hp.filter(w)).length, upper: window.__hp.upper() }), { l: ROW, words: FILTERS });
  c('9.5', copy.row === 1 && copy.filters === FILTERS.length && copy.upper.length === 0, copy);
  const inks = {};
  for (const mode of ['dark', 'light']) {
    await S.page.evaluate((mode) => { const r = document.documentElement; if (mode === 'light') r.setAttribute('data-px-mode', 'light'); else r.removeAttribute('data-px-mode'); r.style.colorScheme = mode; }, mode);
    await sleep(500);
    inks[mode] = await S.ev((l) => window.__hp.inks(l), ROW);
    await S.shot(`9-home-${mode}`);
  }
  const readable = (m) => ['title', 'line', 'rowLabel'].every((k) => (m[k] ?? 0) >= 4.5);
  c('9.6', readable(inks.dark) && readable(inks.light), inks);
});

async function main() {
  await fs.rm(path.join(OUT, 'shots'), { recursive: true, force: true });
  await fs.mkdir(path.join(OUT, 'shots'), { recursive: true });
  await fs.rm(path.join(OUT, 'runs'), { recursive: true, force: true });
  const t0 = Date.now();
  for (const p of PHASES) {
    if (ONLY && !ONLY.has(p.n)) continue;
    console.log(`\n── ${p.n}. ${p.title}`);
    const tp = Date.now();
    const done = new Set();
    const c = (id, ok, got) => { if (done.has(id)) return; done.add(id); record(id, p.checks[id] ?? '(unnamed check)', ok, got); };
    let S = null;
    let stopped = '';
    try {
      S = makeSession(await newRoot(`phase-${String(p.n).padStart(2, '0')}`, p.opts));
      await S.open();
      await p.fn(S, c);
    } catch (err) {
      stopped = String((err && err.message) || err).split('\n')[0].slice(0, 320);
      if (S?.page) await S.shot(`${String(p.n).padStart(2, '0')}-stopped`).catch(() => {});
    } finally {
      if (S) await S.close();
    }
    // A check the phase never reached has not passed.
    for (const id of Object.keys(p.checks)) if (!done.has(id)) c(id, false, stopped ? `not reached: ${stopped}` : 'not reached');
    console.log(`   (${Math.round((Date.now() - tp) / 1000)} s)`);
  }
  if (!ONLY || ONLY.has(10)) {
    console.log('\n── 10. No page error');
    record('10.1', 'no page error and no error on the console in the whole run (holds today)', pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 6));
  }
  const failed = results.filter((r) => !r.ok);
  const isGround = (r) => r.id.startsWith('0.') || r.id === '10.1';
  const ground = results.filter(isGround); const fresh = results.filter((r) => !isGround(r));
  console.log(`\n[probe] page errors: ${pageErrors.length}`);
  for (const e of [...new Set(pageErrors)].slice(0, 8)) console.log(`   ${e}`);
  console.log(`[probe] ${results.length} checks: ${results.length - failed.length} ok, ${failed.length} FAIL${failed.length ? ` (${failed.map((r) => r.id).join(' ')})` : ''}`);
  console.log(`[probe] of them the ground (phase 0 and 10.1): ${ground.filter((r) => r.ok).length} of ${ground.length} ok; the new behaviour: ${fresh.filter((r) => r.ok).length} of ${fresh.length} ok`);
  console.log(`[probe] ${Math.round((Date.now() - t0) / 1000)} s; screenshots in ${path.join(OUT, 'shots')}`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((err) => { console.log(`[probe] FAIL the probe itself stopped: ${err && err.stack ? err.stack : err}`); process.exitCode = 1; });
