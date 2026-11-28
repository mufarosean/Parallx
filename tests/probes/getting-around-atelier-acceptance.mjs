// getting-around-atelier-acceptance.mjs — @acceptance for "Getting around",
// piece 4, Atelier (ext/media-organizer) onto the core's places point
// (docs/MASTER_LIST.md, "Getting around: one way to move in every tool",
// "The order of work" item 4; his picks 1A, 2A, 3A).
//
// Written from the request before the build, by a verifier who is not the
// builder. The builder does not edit this file. The checks for the new
// behaviour failed on the app as it was when it was written (dev at 95ea6841);
// the ones marked [guard] test what is already true and must stay true.
// On that app 17 of 114 passed: the eight [guard]s (R2, G2, T1-T5, X1), W1 for
// All Media (the first row pressed makes one tab on any build) and W2 for the
// eight grid screens that already had the kit's title and no back link (All
// Media, Favorites, Recent, Untagged, Duplicates, the smart collection, the
// folder, the tag); each is part of the walk and must stay true.
//
// What it holds the piece to:
//   R. Tabs the older build saved (typeId media-organizer-grid, instance ids
//      grid:favorites, grid:recent, detail:photo:2 and album:1, written into the
//      workspace's saved state before launch) come back: the three screens as
//      ONE Atelier place tab (not lost, not doubled) showing one of them with
//      the trail "Atelier › …"; the album as a tab of its own.
//   W. A walk down Atelier's column (All Media, Favorites, Recent, Untagged,
//      Tag Review, Duplicates, the smart collection, Daily Study, Practice
//      Session, Painting Plans, Colour Study, a folder, a tag) leaves
//      exactly ONE Atelier tab, named for the row, with the tool's icon; no kit
//      back link; the trail in the bar under the tabs is "Atelier › <place>";
//      the keys land on the page's kit title (h1.px-page-header__title,
//      tabindex -1); the column marks the row (aria-current="page" + px-current)
//      and only it. Each has an address parallx://place/media-organizer/<place>?…
//      (the trail's last crumb's data-address), a different one per row.
//   B. Alt+Left / Alt+Right across Atelier places in the same tab.
//   P. A smart collection and a filter ride in the address: the smart
//      collection's carries its id, a tag's its id; the smart collection's
//      address clicked as a link in a page opens it in the one tab.
//   D. A photo's and a video's detail is a place over its list: opened from All
//      Media in the same tab (not a tab per photo), named for the item, the trail
//      "Atelier › All Media › <item>", keys on its kit title, the item in the
//      address; Back returns to All Media; the "All Media" crumb goes there in
//      the same tab. From an album, two photos opened one after another make at
//      most one more tab, with the album as the crumb before the photo.
//   H. The All Media feed's Daily Study card ("Home's feed"): its picture opens
//      that photo's detail in the one tab; its Start lands on Daily Study there.
//   G. A page's Media Gallery block, "Open in Atelier": with no album, Recent in
//      the one tab; with an album, the album in a tab of its own.
//   L. The deep links parallx://media-organizer/photo/2 and /video/1, clicked in
//      a page: that photo's (video's) detail, in the one Atelier tab.
//   K. The hand-made "Back to Rows" (a colour sheet's mix bench) and "Back To
//      Colours" (a plan's My Paints) are gone; the trail carries that step and
//      its crumb before goes back.
//   T. Things keep tabs of their own: an album, a plan's board, the image
//      editor, the clip editor, a practice session being run; the place tab
//      stays one.
//   C. The manifest's commands (openGrid, paintingPlans, colourStudy,
//      openTagReview, findDuplicates, practiceSession, dailyStudy) each land in
//      the one place tab, named for the place.
//   O. Ctrl+click on a column row, and the tab menu's Open in Its Own Tab, give
//      a second tab on the place.
//   S. After the app is closed and opened, the one place tab comes back at its
//      place.
//   X. Turned off, Atelier's tabs and column go; on again, its commands work.
// Screenshots (shots/) of a place and a detail, dark and light, are taken for a
// person to look at, not judged here.
// Read as the builder's choice, not checked: which place ids and parameter names
// are used; whether a plan being edited or a colour sheet is a place or a thing
// (only their inner back buttons are held to the request); which Atelier tab
// the album's photo detail lands in. Not checked: Study's links into Atelier
// (Study has none today) and the chat's tools; the Media Gallery block on the
// dashboard.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/getting-around-atelier-acceptance.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, launchApp, cmd, screenshot, toolList, setToolEnabled } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-getting-around-atelier');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

let passed = 0; const failed = []; const guards = [];
const check = (name, ok, got, { guard = false } = {}) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${guard ? '[guard] ' : ''}${name}${ok ? '' : `: ${JSON.stringify(got)}`}`);
  if (guard) guards.push(name);
  if (ok) passed += 1; else failed.push(name);
};

const manifest = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'ext', 'media-organizer', 'parallx-manifest.json'), 'utf8'));
const TOOL = manifest.id; // parallx-community.media-organizer: the prefix of every Atelier tab's id
const OLD_TYPE = 'media-organizer-grid';
/** A place's address: parallx://place/media-organizer/<place>?<params>. */
const PLACE_ADDR = /^parallx:\/\/place\/media-organizer\/[^?/]+/i;
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const nodeEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

// ── The library: four photos and a video (ffmpeg), built as the app builds it (tag-review-seed.cjs), plus an album and a smart collection ──
const photos = path.join(ws, 'photos');
await fs.mkdir(photos, { recursive: true });
const gen = [['boxing.jpg', 'testsrc2=size=1200x800', 1200, 800], ['card.jpg', 'testsrc2=size=1600x1200', 1600, 1200], ['fractal.jpg', 'mandelbrot=size=1200x900', 1200, 900], ['bars.jpg', 'smptehdbars=size=1280x720', 1280, 720]];
for (const [name, src] of gen) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)], { windowsHide: true });
  if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${String(r.stderr).slice(0, 200)}`);
}
const videoPath = path.join(photos, 'clip.mp4');
{
  const v = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '4', '-pix_fmt', 'yuv420p', videoPath], { windowsHide: true });
  if (v.status !== 0) throw new Error(`ffmpeg clip: ${String(v.stderr).slice(0, 200)}`);
}
const specPath = path.join(root, 'spec.json');
await fs.writeFile(specPath, JSON.stringify([...gen.map(([basename, , width, height]) => ({ basename, width, height })), { basename: 'clip.mp4', width: 640, height: 360, video: true, duration: 4, frameRate: 24 }]));
const extraSeed = path.join(root, 'extra-seed.cjs');
await fs.writeFile(extraSeed, `
const Database = require(${JSON.stringify(path.join(PROJECT_ROOT, 'node_modules', 'better-sqlite3'))});
const db = new Database(process.argv[2]);
const a = db.prepare("INSERT INTO mo_albums (title) VALUES ('Probe Album')").run().lastInsertRowid;
db.prepare('INSERT INTO mo_albums_photos (album_id, photo_id, position) VALUES (?, 1, 0), (?, 2, 1)').run(a, a);
db.prepare('INSERT INTO mo_albums_videos (album_id, video_id, position) VALUES (?, 1, 2)').run(a);
const s = db.prepare("INSERT INTO mo_smart_albums (name, query_json) VALUES ('Probe Smart', ?)").run(JSON.stringify({ query: 'boxing', filters: {} })).lastInsertRowid;
db.close();
console.log(JSON.stringify({ album: Number(a), smart: Number(s) }));
`);
let seeded = null; let extra = null;
for (const id of ['media-organizer', TOOL]) {
  const db = path.join(ws, '.parallx', 'extensions', id, 'data.db');
  const r = spawnSync(ELECTRON, [path.join(PROJECT_ROOT, 'tests', 'probes', 'tag-review-seed.cjs'), 'seed', db, photos, specPath], { env: nodeEnv, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`media seed: ${r.stderr || r.stdout}`);
  seeded = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  const x = spawnSync(ELECTRON, [extraSeed, db], { env: nodeEnv, encoding: 'utf8', windowsHide: true });
  if (x.status !== 0) throw new Error(`album seed: ${x.stderr || x.stdout}`);
  extra = JSON.parse(x.stdout.trim().split(/\r?\n/).pop());
}
console.log(`[seed] library ${JSON.stringify(seeded.photo)} video ${JSON.stringify(seeded.video)}; ${JSON.stringify(extra)}`);
const PHOTO2 = 'card'; const PHOTO2_ID = seeded.photo['card.jpg']; const VIDEO_ID = seeded.video['clip.mp4'];

// The names a place tab can have in this workspace (the rows walked, and the items' details).
const PLACE_LABELS = ['All Media', 'Favorites', 'Recent', 'Untagged', 'Tag Review', 'Duplicates', 'Probe Smart', 'Daily Study', 'Practice Session', 'Painting Plans', 'Colour Study', 'photos', 'PATTERNS', 'boxing', 'card', 'fractal', 'bars', 'clip'];

let app; let page; let errors = [];
const wait = (ms) => page.waitForTimeout(ms);

/** What a person sees: the tabs, the trail under them, the page, Atelier's column, the focus. */
const read = () => page.evaluate(({ TOOL }) => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  // The editor area's tabs (not tabs drawn inside a page, as Duplicates' Exact / Look-alike).
  const tabs = [...document.querySelectorAll('.editor-group .ui-tab')].filter((t) => !t.classList.contains('ui-tab--leaving') && vis(t) && !t.closest('.editor-pane-container')).map((t) => {
    const icon = t.querySelector('.ui-tab-icon');
    return {
      id: t.dataset.tabId ?? '', label: (t.querySelector('.ui-tab-label')?.textContent ?? '').trim(), active: t.classList.contains('ui-tab--active'),
      icon: !!icon && vis(icon) && !!icon.querySelector('svg, img'),
      group: t.closest('.editor-group')?.getAttribute('data-editor-group-id') ?? null,
    };
  });
  const act = tabs.find((t) => t.active) ?? null;
  const group = act ? document.querySelector(`.editor-group[data-editor-group-id="${act.group}"]`) : null;
  const ribbon = group?.querySelector('.editor-ribbon');
  const crumbs = ribbon && vis(ribbon) && !ribbon.classList.contains('hidden')
    ? [...ribbon.querySelectorAll('.parallx-breadcrumb-item')].filter(vis).map((c) => ({
      label: ((c.querySelector('.breadcrumb-label, [class*="label"]') ?? c).textContent ?? '').trim(),
      icon: !!c.querySelector('svg, img'), address: c.dataset.address ?? '',
    }))
    : [];
  const panes = group?.querySelector('.editor-pane-container');
  const title = [...(panes?.querySelectorAll('.px-page-header__title') ?? [])].find(vis);
  const back = [...(panes?.querySelectorAll('.px-page-header__back') ?? [])].find(vis);
  const view = document.querySelector('.view[data-view-id="mediaOrganizer.browser"]');
  const nameOf = (e) => ((e.querySelector('.mo-sidebar-item-label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
  const marked = view ? [...view.querySelectorAll('[aria-current="page"]')].map((e) => ({ name: nameOf(e), pxCurrent: e.classList.contains('px-current') })) : null;
  const ae = document.activeElement;
  const atelier = tabs.filter((t) => t.id.startsWith(`${TOOL}:`));
  return {
    count: tabs.length, labels: tabs.map((t) => t.label), active: act?.label ?? null, activeId: act?.id ?? null, activeIcon: act?.icon ?? false,
    activeIsAt: !!act && act.id.startsWith(`${TOOL}:`),
    at: atelier.map((t) => t.label), atIds: atelier.map((t) => t.id),
    crumbs, address: crumbs.length ? crumbs[crumbs.length - 1].address : '',
    title: title ? (title.textContent ?? '').trim() : null,
    back: back ? (back.textContent ?? '').trim() || '(a back link)' : null,
    column: !!view && vis(view), marked,
    focus: ae ? { tag: ae.tagName, cls: String(ae.className ?? ''), tabindex: ae.getAttribute('tabindex'), text: (ae.textContent ?? '').trim().slice(0, 40), inEditor: !!panes?.contains(ae) } : null,
  };
}, { TOOL });
const titleFocused = (s) => !!s.focus && s.focus.tag === 'H1' && /\bpx-page-header__title\b/.test(s.focus.cls) && s.focus.tabindex === '-1' && s.focus.inEditor;
const short = (s) => ({ active: s.active, activeId: s.activeId, at: s.at, crumbs: s.crumbs.map((c) => c.label), address: s.address, title: s.title });
const trailIs = (s, place) => s.crumbs.length >= 2 && s.crumbs[0].label === 'Atelier' && s.crumbs[0].icon && s.crumbs[s.crumbs.length - 1].label === place;
/** On this place, in the one Atelier tab. */
const onePlace = (s, place) => s.at.length === 1 && s.activeIsAt && s.active === place;
const placeTabs = (s) => s.at.filter((l) => PLACE_LABELS.includes(l));

const centre = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
async function showColumn() {
  const shown = await page.evaluate(() => { const v = document.querySelector('.view[data-view-id="mediaOrganizer.browser"]'); return !!v && v.getClientRects().length > 0; });
  if (shown) return;
  const at = await centre('.activity-bar-item[data-icon-id="media-organizer-container"]');
  if (at) { await page.mouse.click(at.x, at.y); await wait(1_200); }
}
/** A row in Atelier's column named exactly `label` (its label, not its count), scrolled into view: its centre, or null. */
async function columnControl(label) {
  await showColumn();
  return page.evaluate((label) => {
    const view = document.querySelector('.view[data-view-id="mediaOrganizer.browser"]');
    if (!view) return null;
    const nameOf = (e) => ((e.querySelector('.mo-sidebar-item-label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim();
    const all = [...view.querySelectorAll('.mo-sidebar-item, a[href], [role="link"], [role="button"], [role="treeitem"], button')];
    const e = all.find((x) => x.getClientRects().length && nameOf(x) === label);
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
  }, label);
}
/** The column's Browse switch (Folders / Tags), by the mouse. */
async function browseBy(label) {
  await showColumn();
  const at = await page.evaluate((label) => {
    const view = document.querySelector('.view[data-view-id="mediaOrganizer.browser"]');
    const b = [...(view?.querySelectorAll('[role="tab"], button') ?? [])].find((x) => x.getClientRects().length && (x.textContent ?? '').trim().startsWith(label));
    if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (at) { await page.mouse.click(at.x, at.y); await wait(900); }
  return !!at;
}
async function pressColumn(label, { ctrl = false, ms = 2_000 } = {}) {
  const at = await columnControl(label);
  if (!at) return false;
  if (ctrl) await page.keyboard.down('Control');
  await page.mouse.click(at.x, at.y);
  if (ctrl) await page.keyboard.up('Control');
  await wait(ms);
  return true;
}
/** A visible control in the active editor whose text (or name) starts with `text`: pressed by the mouse. */
async function pressInPage(text, { ms = 1_800, sel = 'button, [role="button"]', exact = false } = {}) {
  const at = await page.evaluate(({ text, sel, exact }) => {
    const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
    const panes = act?.closest('.editor-group')?.querySelector('.editor-pane-container');
    const nm = (x) => (x.textContent ?? '').replace(/\s+/g, ' ').trim() || (x.getAttribute('aria-label') ?? '');
    const e = [...(panes?.querySelectorAll(sel) ?? [])].find((x) => x.getClientRects().length && (exact ? nm(x) === text : nm(x).startsWith(text)));
    if (!e) return null;
    e.scrollIntoView({ block: 'nearest' });
    const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { text, sel, exact });
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
/** Whether a visible control (or text) in the active editor reads `text`. */
const pageHas = (text, sel = 'button, [role="button"], a') => page.evaluate(({ text, sel }) => {
  const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
  const panes = act?.closest('.editor-group')?.querySelector('.editor-pane-container');
  return [...(panes?.querySelectorAll(sel) ?? [])].some((x) => x.getClientRects().length && ((x.textContent ?? '').replace(/\s+/g, ' ').trim() === text || x.getAttribute('aria-label') === text));
}, { text, sel });
/** An item of a list (feed tile, grid card, album card) named `name`: opened as a person does (double-click; an album's card, one click). */
async function openItem(name, { ms = 2_600 } = {}) {
  const at = await page.evaluate((name) => {
    const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
    const panes = act?.closest('.editor-group')?.querySelector('.editor-pane-container');
    const nm = (x) => [x.getAttribute('aria-label'), x.querySelector('img')?.getAttribute('alt'), x.querySelector('.mo-feed-cap-title, [class*="title"]')?.textContent].map((v) => (v ?? '').trim());
    const e = [...(panes?.querySelectorAll('.mo-feed-card, .mo-card, .mo-album-mini-card, .mo-list-row') ?? [])].find((x) => x.getClientRects().length && nm(x).includes(name));
    if (!e) return null;
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 40), single: e.classList.contains('mo-album-mini-card') };
  }, name);
  if (!at) return false;
  if (at.single) await page.mouse.click(at.x, at.y); else await page.mouse.dblclick(at.x, at.y);
  await wait(ms);
  return true;
}
/** A crumb of the trail under the tabs, by its label: pressed by the mouse. */
async function pressCrumb(label, { ms = 2_000 } = {}) {
  const at = await page.evaluate((label) => {
    const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
    const ribbon = act?.closest('.editor-group')?.querySelector('.editor-ribbon');
    const c = [...(ribbon?.querySelectorAll('.parallx-breadcrumb-item') ?? [])].find((x) => x.getClientRects().length && ((x.querySelector('.breadcrumb-label, [class*="label"]') ?? x).textContent ?? '').trim() === label);
    if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (!at) return false;
  await page.mouse.click(at.x, at.y); await wait(ms);
  return true;
}
/** The tab with this label (the last, if several; the active one when label is null), by the mouse. */
async function pressTab(label, { right = false, ms = 1_400 } = {}) {
  const at = await page.evaluate((label) => {
    const t = [...document.querySelectorAll('.editor-group .ui-tab')].filter((x) => x.getClientRects().length && !x.closest('.editor-pane-container') && !x.classList.contains('ui-tab--leaving') && (label === null ? x.classList.contains('ui-tab--active') : (x.querySelector('.ui-tab-label')?.textContent ?? '').trim() === label)).pop();
    if (!t) return null; const l = (t.querySelector('.ui-tab-label') ?? t).getBoundingClientRect(); return { x: l.x + Math.min(20, l.width / 2), y: l.y + l.height / 2 };
  }, label);
  if (!at) return false;
  await page.mouse.click(at.x, at.y, { button: right ? 'right' : 'left' });
  await wait(ms);
  return true;
}
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('.context-menu')].filter((m) => m.getClientRects().length).flatMap((m) => [...m.querySelectorAll('.context-menu-item')].map((r) => (r.querySelector('.context-menu-item-label')?.textContent ?? r.textContent ?? '').trim())));
async function pickMenuItem(text) {
  const at = await page.evaluate((text) => {
    const r = [...document.querySelectorAll('.context-menu .context-menu-item')].filter((x) => x.getClientRects().length).find((x) => (x.textContent ?? '').includes(text));
    if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, text);
  if (!at) { await page.keyboard.press('Escape'); await wait(300); return false; }
  await page.mouse.click(at.x, at.y); await wait(1_800);
  return true;
}
async function closeAllEditors() {
  for (let i = 0; i < 40 && (await read()).count > 0; i++) { await cmd(page, 'workbench.action.closeActiveEditor'); await wait(250); }
  await wait(500);
}
const key = async (k, ms = 1_900) => { await page.keyboard.press(k); await wait(ms); };
const runTool = (name, args) => page.evaluate(async ({ name, args }) => {
  const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
  const t = tools.getTool(name); if (!t) return `no tool ${name}`;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const out = String((await t.handler(args, token))?.content ?? '');
  return (/id: ([0-9a-f-]{20,})/i.exec(out) || [])[1] ?? `no id: ${out.slice(0, 160)}`;
}, { name, args });
const runCmd = (id, ...args) => page.evaluate(async ({ id, args }) => {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
  try { return await svc.executeCommand(id, ...args); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { id, args });
/** The column's mark: exactly one marked control, named `label`, with px-current. */
async function markRight(label) {
  const has = !!(await columnControl(label));
  const after = (await read()).marked ?? [];
  return { ok: has && after.length === 1 && after[0].name === label && after[0].pxCurrent, has, marked: after };
}
const artToolsOn = () => page.evaluate(async () => { await window.__parallx_workbench__._services.get({ id: 'IConfigurationService' }).getConfiguration('mediaOrganizer').update('enableArtTools', true); });

async function launch() {
  ({ app, page, errors } = await launchApp(appRoot));
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await wait(2_500);
}
async function ensureAtelierOn() {
  const t = (await toolList(page)).find((x) => x.id === TOOL);
  if (t && !t.enabled) { await setToolEnabled(page, TOOL, true); await wait(4_000); }
  return (await toolList(page)).find((x) => x.id === TOOL)?.enabled === true;
}

// ── Run 1: Atelier on, its art tools on, a painting plan on fractal and a colour sheet; then the older build's saved tabs ──
await launch();
const onAtFirst = await ensureAtelierOn();
await artToolsOn(); await wait(1_200);
const planMade = await runCmd('media-organizer.planPainting', seeded.photo['fractal.jpg']); await wait(3_000);
const sheetId = await runCmd('media-organizer.colour.newSheet'); await wait(2_000);
console.log(`[seed] Atelier on: ${onAtFirst}; plan: ${JSON.stringify(planMade)}; colour sheet: ${JSON.stringify(sheetId)}`);
await app.close(); app = null;
// The older build saved each Atelier screen as a tool editor of type media-organizer-grid with the screen as its
// instanceId (seen in a workspace-state.json written by dev at 95ea6841 after the column's rows were pressed).
const statePath = path.join(ws, '.parallx', 'workspace-state.json');
let seededOld = false;
try {
  const file = JSON.parse(await fs.readFile(statePath, 'utf8'));
  const wb = JSON.parse(file.workbench);
  const groupId = wb.editors?.groups?.[0]?.id ?? 'editor-group-1';
  const old = (instanceId, name, icon) => ({
    typeId: OLD_TYPE, inputId: `${TOOL}:${OLD_TYPE}:${instanceId}`, pinned: true,
    data: { inputId: `${TOOL}:${OLD_TYPE}:${instanceId}`, instanceId, name, icon, ownerToolId: TOOL },
  });
  wb.editors = { groups: [{ id: groupId, editors: [old('grid:favorites', 'Favorites', 'image'), old('grid:recent', 'Recent', 'image'), old(`detail:photo:${PHOTO2_ID}`, PHOTO2, 'image'), old(`album:${extra.album}`, 'Probe Album', 'album')], activeEditorIndex: 1 }], activeGroupIndex: 0, activeGroupId: groupId };
  file.workbench = JSON.stringify(wb);
  await fs.writeFile(statePath, JSON.stringify(file, null, 2));
  seededOld = true;
} catch (e) { console.log(`[seed] the saved state could not be written: ${e?.message ?? e}`); }
console.log(`[seed] older-build tabs (grid:favorites, grid:recent, detail:photo:${PHOTO2_ID}, album:${extra.album}) written into the saved state: ${seededOld}`);

try {
  await launch();
  await ensureAtelierOn();

  // ── R. The older build's tabs ──
  let s = await read();
  const r0 = s;
  const restoredPlaces = r0.at.filter((l) => l !== 'Probe Album');
  check('R1 the older build\'s three saved Atelier screens (grid:favorites, grid:recent, detail:photo) come back as ONE Atelier tab, named for one of them', seededOld && restoredPlaces.length === 1 && ['Favorites', 'Recent', PHOTO2].includes(restoredPlaces[0]), { seededOld, at: r0.at, atIds: r0.atIds });
  check('R2 the older build\'s saved album tab (album:1) comes back as a tab of its own, "Probe Album"', r0.at.filter((l) => l === 'Probe Album').length === 1, r0.at, { guard: true });
  if (restoredPlaces.length >= 1) await pressTab(restoredPlaces[0], { ms: 2_200 });
  s = await read();
  check('R3 that one tab shows an Atelier place: trail "Atelier › … › <its name>", its address parallx://place/media-organizer/…', restoredPlaces.length === 1 && s.activeIsAt && trailIs(s, restoredPlaces[0]) && PLACE_ADDR.test(s.address), short(s));

  await closeAllEditors();

  // ── W. The walk down the column ──
  const walk = ['All Media', 'Favorites', 'Recent', 'Untagged', 'Tag Review', 'Duplicates', 'Probe Smart', 'Daily Study', 'Practice Session', 'Painting Plans', 'Colour Study', 'photos', 'PATTERNS'];
  const addresses = {};
  for (const place of walk) {
    if (place === 'photos' || place === 'PATTERNS') await browseBy(place === 'photos' ? 'Folders' : 'Tags');
    const pressed = await pressColumn(place, { ms: 2_400 });
    s = await read();
    addresses[place] = s.address;
    console.log(`[walk] ${place} pressed: ${pressed} → ${JSON.stringify(short(s))}`);
    check(`W1 ${place}: exactly one Atelier tab, in front, named "${place}", with an icon`, pressed && onePlace(s, place) && s.activeIcon, { pressed, ...short(s), icon: s.activeIcon });
    check(`W2 ${place}: the page has the kit's title (h1.px-page-header__title) and no kit back link`, pressed && s.activeIsAt && s.title !== null && s.back === null, { pressed, title: s.title, back: s.back });
    check(`W3 ${place}: the trail under the tabs is "Atelier › ${place}", Atelier with its icon; the address is parallx://place/media-organizer/…`, pressed && trailIs(s, place) && PLACE_ADDR.test(s.address), s.crumbs);
    check(`W4 ${place}: the keys are on the page's kit title (h1, tabindex -1, in the editor)`, pressed && titleFocused(s), s.focus);
    const m = await markRight(place);
    check(`W5 ${place}: the column marks this row only (aria-current="page" + px-current)`, pressed && m.ok, m);
    if (place === 'All Media') await screenshot(app, page, path.join(shots, 'w-all-media-dark.png'));
    if (place === 'Painting Plans') await screenshot(app, page, path.join(shots, 'w-plans-dark.png'));
  }
  const addrList = walk.map((p) => addresses[p]).filter((a) => PLACE_ADDR.test(a));
  check('W6 every row walked has its own address (as many different parallx://place/media-organizer/… addresses as rows)', addrList.length === walk.length && new Set(addrList).size === walk.length, addresses);

  // ── B. Back and Forward across places in the same tab ──
  await closeAllEditors();
  await pressColumn('All Media'); await pressColumn('Favorites'); await pressColumn('Tag Review', { ms: 2_400 });
  s = await read();
  const bId = s.activeId;
  await key('Alt+ArrowLeft');
  let b1 = await read();
  check('B1 All Media → Favorites → Tag Review, Alt+Left: Favorites, in the same tab (same tab id), still one Atelier tab', onePlace(b1, 'Favorites') && b1.activeId === bId && b1.title === 'Favorites', { before: bId, after: short(b1) });
  check('B2 after Back, the keys are on Favorites\' page title', b1.active === 'Favorites' && titleFocused(b1), b1.focus);
  await key('Alt+ArrowLeft');
  b1 = await read();
  check('B3 Alt+Left again: All Media, in the same tab, trail "Atelier › All Media"', onePlace(b1, 'All Media') && b1.activeId === bId && trailIs(b1, 'All Media'), short(b1));
  const bm = await markRight('All Media');
  check('B4 after Back the column\'s mark follows: only All Media is marked', b1.active === 'All Media' && bm.ok, bm);
  await key('Alt+ArrowRight');
  b1 = await read();
  check('B5 Alt+Right: Favorites again, in the same tab', onePlace(b1, 'Favorites') && b1.activeId === bId, short(b1));

  // ── P. Parameters in the address ──
  const idIn = (a, id) => new RegExp(`(?:=|%3A|:|/)${id}(?:&|$)`, 'i').test(a.replace(/^parallx:\/\/place\/media-organizer\//i, '/'));
  check(`P1 the smart collection's address names it (carries its id, ${extra.smart}) and differs from All Media's`, PLACE_ADDR.test(addresses['Probe Smart'] ?? '') && /\?/.test(addresses['Probe Smart']) && idIn(addresses['Probe Smart'].split('?')[1] ?? '', extra.smart) && addresses['Probe Smart'] !== addresses['All Media'], { smart: addresses['Probe Smart'], all: addresses['All Media'] });
  check(`P2 the tag row's address carries the tag (PATTERNS, id ${seeded.tag.PATTERNS})`, PLACE_ADDR.test(addresses.PATTERNS ?? '') && /\?/.test(addresses.PATTERNS) && idIn(addresses.PATTERNS.split('?')[1] ?? '', seeded.tag.PATTERNS), addresses.PATTERNS);

  // ── D. A photo's and a video's detail: a place over its list ──
  await closeAllEditors();
  await pressColumn('All Media', { ms: 3_000 });
  const d0 = await read();
  const openedPhoto = await openItem(PHOTO2);
  let d1 = await read();
  console.log(`[detail] ${PHOTO2} opened: ${openedPhoto} → ${JSON.stringify(short(d1))}`);
  check(`D1 a photo ("${PHOTO2}") double-clicked in All Media: its detail in the SAME Atelier tab (same tab id), still one Atelier tab, named "${PHOTO2}"`, openedPhoto && onePlace(d1, PHOTO2) && d1.activeId === d0.activeId, { openedPhoto, before: short(d0), after: short(d1) });
  check(`D2 the detail's trail is "Atelier › All Media › ${PHOTO2}"`, openedPhoto && trailIs(d1, PHOTO2) && d1.crumbs.length >= 3 && d1.crumbs[d1.crumbs.length - 2].label === 'All Media', d1.crumbs);
  check(`D3 the detail has the kit title "${PHOTO2}" and the keys are on it`, openedPhoto && d1.title === PHOTO2 && titleFocused(d1), { title: d1.title, focus: d1.focus });
  const detailAddress = d1.address;
  check(`D4 the detail's address names the photo (photo, id ${PHOTO2_ID})`, PLACE_ADDR.test(detailAddress) && /photo/i.test(detailAddress) && idIn(detailAddress, PHOTO2_ID), detailAddress);
  await screenshot(app, page, path.join(shots, 'd-detail-dark.png'));
  await key('Alt+ArrowLeft', 2_400);
  d1 = await read();
  check('D5 Alt+Left from the detail: All Media, in the same tab', onePlace(d1, 'All Media') && d1.activeId === d0.activeId, short(d1));
  const openedVideo = await openItem('clip');
  d1 = await read();
  check('D6 then the video ("clip") double-clicked: its detail in the same tab, named "clip", trail "Atelier › All Media › clip", the video in the address', openedVideo && onePlace(d1, 'clip') && d1.activeId === d0.activeId && trailIs(d1, 'clip') && d1.crumbs[d1.crumbs.length - 2]?.label === 'All Media' && /video/i.test(d1.address) && idIn(d1.address, VIDEO_ID), { openedVideo, ...short(d1) });
  const crumbed = await pressCrumb('All Media', { ms: 2_400 });
  d1 = await read();
  check('D7 the trail\'s "All Media" crumb pressed: All Media in the same tab', crumbed && onePlace(d1, 'All Media') && d1.activeId === d0.activeId, { crumbed, ...short(d1) });

  // From an album (a thing): a photo's detail over the album, not a tab per photo.
  await closeAllEditors();
  await pressColumn('Probe Album', { ms: 2_600 });
  const a0 = await read();
  const aOpen1 = await openItem('boxing');
  const a1 = await read();
  await key('Alt+ArrowLeft', 2_400);
  const aOpen2 = await openItem(PHOTO2);
  const a2 = await read();
  const photoTabs = a2.labels.filter((l) => l === 'boxing' || l === PHOTO2);
  check('D8 from the album, "boxing" then (Back) "card" opened: at most one tab more than the album\'s, never a tab per photo', aOpen1 && aOpen2 && a0.active === 'Probe Album' && a2.count <= a0.count + 1 && photoTabs.length <= 1, { a0: a0.labels, a1: a1.labels, a2: a2.labels });
  check('D9 the album\'s photo detail: named "card", trail "… › Probe Album › card"', aOpen2 && a2.active === PHOTO2 && trailIs(a2, PHOTO2) && a2.crumbs[a2.crumbs.length - 2]?.label === 'Probe Album', short(a2));

  // ── H. The All Media feed's Daily Study card ("Home's feed") ──
  await closeAllEditors();
  await pressColumn('All Media', { ms: 3_000 });
  const h0 = await read();
  const pic = await centre('.mo-daily img');
  if (pic) { await page.mouse.click(pic.x, pic.y); await wait(2_600); }
  let h1 = await read();
  check('H1 the feed\'s Daily Study picture pressed: that photo\'s detail in the same Atelier tab, one tab, trail "Atelier › … › <photo>", the photo in the address', !!pic && h1.at.length === 1 && h1.activeId === h0.activeId && ['boxing', 'card', 'fractal', 'bars'].includes(h1.active) && trailIs(h1, h1.active) && /photo/i.test(h1.address), { pic: !!pic, ...short(h1) });
  await closeAllEditors();
  await pressColumn('All Media', { ms: 3_000 });
  const h2a = await read();
  const started = await pressInPage('', { sel: '.mo-daily button', ms: 2_600 }); // Start (Continue once today's has begun)
  h1 = await read();
  check('H2 the feed\'s Daily Study Start (or Continue): Daily Study, in the same Atelier tab, trail "Atelier › Daily Study"', started && onePlace(h1, 'Daily Study') && h1.activeId === h2a.activeId && trailIs(h1, 'Daily Study'), { started, ...short(h1) });

  // ── L, P3, G. Links into Atelier from a page: the deep links, a place's address, the Media Gallery block ──
  await closeAllEditors();
  const smartAddress = PLACE_ADDR.test(addresses['Probe Smart'] ?? '') ? addresses['Probe Smart'] : '';
  const photoLink = `parallx://media-organizer/photo/${PHOTO2_ID}`;
  const videoLink = `parallx://media-organizer/video/${VIDEO_ID}`;
  const md = [`See [the card photo](${photoLink}).`, `See [the clip](${videoLink}).`, ...(smartAddress ? [`See [the smart one](${smartAddress}).`] : [])].join('\n\n');
  const linkPage = await runTool('canvas_create_page', { title: 'Probe Atelier Links', markdown: md });
  console.log(`[seed] a page with links ${photoLink}, ${videoLink}, ${smartAddress || '(no smart address read)'}: ${linkPage}`);
  const hasPage = !!linkPage && !/^no /.test(linkPage);
  async function clickLink(href) {
    if (!hasPage) return false;
    await cmd(page, 'canvas.openPage', linkPage); await wait(2_000);
    const at = await page.evaluate((href) => { const a = [...document.querySelectorAll('[data-px-surface="canvas"] a')].find((x) => x.getClientRects().length && x.getAttribute('href') === href); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, href);
    if (!at) return false;
    await page.mouse.click(at.x, at.y); await wait(2_800);
    return true;
  }
  await cmd(page, 'media-organizer.openGrid'); await wait(2_400); // an Atelier place tab already open
  const l0 = await read();
  let clicked = await clickLink(photoLink);
  let l1 = await read();
  check(`L1 the deep link ${photoLink}, clicked in a page: "${PHOTO2}"'s detail, in the one Atelier tab, kit title "${PHOTO2}"`, clicked && onePlace(l1, PHOTO2) && l1.title === PHOTO2 && trailIs(l1, PHOTO2), { clicked, before: l0.at, after: short(l1) });
  clicked = await clickLink(videoLink);
  l1 = await read();
  check(`L2 the deep link ${videoLink}, clicked in a page: "clip"'s detail, in the one Atelier tab`, clicked && onePlace(l1, 'clip') && trailIs(l1, 'clip'), { clicked, after: short(l1) });
  clicked = smartAddress ? await clickLink(smartAddress) : false;
  l1 = await read();
  check('P3 the smart collection\'s address, clicked as a link in a page: "Probe Smart" in the one Atelier tab', clicked && onePlace(l1, 'Probe Smart') && trailIs(l1, 'Probe Smart'), { clicked, smartAddress, after: short(l1) });

  // The Media Gallery block's "Open in Atelier".
  let blocks = 'no page';
  if (hasPage) {
    await cmd(page, 'canvas.openPage', linkPage); await wait(2_000);
    blocks = await page.evaluate(({ album }) => {
      const ed = Array.from(document.querySelectorAll('[data-px-surface="canvas"] [contenteditable="true"]')).filter((x) => x.offsetParent).map((x) => x.editor).find(Boolean);
      if (!ed) return 'no editor';
      const block = (albumId) => ({ type: 'toolBlock', attrs: { blockType: 'parallx-community.media-organizer.gallery', config: { albumId, limit: 12 }, from: 'Atelier' } });
      return [ed.commands.insertContentAt(ed.state.doc.content.size, block('')), ed.commands.insertContentAt(ed.state.doc.content.size, block(String(album)))].every(Boolean) ? 'ok' : 'refused';
    }, { album: extra.album });
    await wait(2_000);
  }
  console.log(`[seed] two Media Gallery blocks in the page: ${blocks}`);
  async function galleryOpen(i) {
    if (!hasPage) return false;
    await cmd(page, 'canvas.openPage', linkPage); await wait(2_200);
    const at = await page.evaluate((i) => { const b = [...document.querySelectorAll('[data-px-surface="canvas"] .canvas-toolblock__actions button')].filter((x) => x.getClientRects().length && (x.textContent ?? '').trim() === 'Open in Atelier')[i]; if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, i);
    if (!at) return false;
    await page.mouse.click(at.x, at.y); await wait(2_800);
    return true;
  }
  await cmd(page, 'media-organizer.openGrid'); await wait(2_400);
  const g0 = await read();
  let gPressed = await galleryOpen(0);
  let g1 = await read();
  check('G1 a page\'s Media Gallery block (no album), "Open in Atelier": Recent, in the one Atelier tab (the tab that was on All Media)', gPressed && onePlace(g1, 'Recent') && g1.activeId === g0.activeId && trailIs(g1, 'Recent'), { gPressed, before: short(g0), after: short(g1) });
  gPressed = await galleryOpen(1);
  g1 = await read();
  check('G2 the block on the album, "Open in Atelier": "Probe Album" in a tab of its own; one place tab remains', gPressed && g1.active === 'Probe Album' && g1.labels.filter((l) => l === 'Probe Album').length === 1 && placeTabs(g1).length === 1, { gPressed, ...short(g1) }, { guard: true });

  // ── K. The hand-made back buttons go; the trail does that work ──
  await closeAllEditors();
  await cmd(page, 'media-organizer.colourStudy'); await wait(2_000);
  const sheetOpened = await runCmd('media-organizer.colour.open', typeof sheetId === 'number' ? sheetId : 1); await wait(2_600);
  const k0 = await read();
  const bench = await pressInPage('Edit Mix', { ms: 1_600 });
  const k1 = await read();
  const backRows = await pageHas('Back to Rows');
  check('K1 a colour sheet\'s mix bench (Edit Mix) has no hand-made "Back to Rows"; the trail carries the step (one crumb more, under Atelier)', bench && !backRows && k1.crumbs[0]?.label === 'Atelier' && k1.crumbs.length === k0.crumbs.length + 1, { sheetOpened, bench, backRows, before: k0.crumbs.map((c) => c.label), after: k1.crumbs.map((c) => c.label) });
  const kBack = k1.crumbs.length >= 2 ? await pressCrumb(k1.crumbs[k1.crumbs.length - 2].label) : false;
  const k2 = await read();
  const mixGone = !(await pageHas('The mix', '.mo-practice-section-title'));
  check('K2 the crumb before the bench pressed: back on the sheet\'s rows (the bench gone), in the same tab', kBack && mixGone && k2.activeId === k1.activeId && k2.crumbs.length === k0.crumbs.length, { kBack, mixGone, after: k2.crumbs.map((c) => c.label) });
  await closeAllEditors();
  await cmd(page, 'media-organizer.paintingPlans'); await wait(2_000);
  const card = await centre('.mo-plans-card');
  if (card) { await page.mouse.click(card.x, card.y); await wait(2_800); }
  const step = await centre('.mo-plan-step[aria-label="Colour"]');
  if (step) { await page.mouse.click(step.x, step.y); await wait(1_800); }
  const k3 = await read();
  const myPaints = await pressInPage('My Paints', { ms: 1_800 });
  const k4 = await read();
  const backColours = await pageHas('Back To Colours');
  check('K3 a plan\'s Colour step, My Paints: no hand-made "Back To Colours"; the trail carries the step (one crumb more, under Atelier)', !!card && !!step && myPaints && !backColours && k4.crumbs[0]?.label === 'Atelier' && k4.crumbs.length === k3.crumbs.length + 1, { card: !!card, step: !!step, myPaints, backColours, before: k3.crumbs.map((c) => c.label), after: k4.crumbs.map((c) => c.label) });
  const kBack2 = k4.crumbs.length >= 2 ? await pressCrumb(k4.crumbs[k4.crumbs.length - 2].label) : false;
  const k5 = await read();
  const paintsGone = !(await pageHas('Paints you have', '.mo-practice-section-title'));
  check('K4 the crumb before My Paints pressed: back on the Colour step\'s colours (the paints gone), in the same tab', kBack2 && paintsGone && k5.activeId === k4.activeId && k5.crumbs.length === k3.crumbs.length, { kBack2, paintsGone, after: k5.crumbs.map((c) => c.label) });

  // ── T. Things keep tabs of their own ──
  await closeAllEditors();
  await pressColumn('All Media', { ms: 2_400 });
  await pressColumn('Probe Album', { ms: 2_400 });
  let t1 = await read();
  check('T1 the album row: "Probe Album" in a tab of its own; the place tab stays, one, "All Media"', t1.active === 'Probe Album' && t1.labels.filter((l) => l === 'Probe Album').length === 1 && placeTabs(t1).length === 1 && t1.at.includes('All Media'), short(t1), { guard: true });
  await runCmd('media-organizer.openBoard', 1); await wait(2_600);
  t1 = await read();
  check('T2 a plan\'s board (openBoard): a tab of its own, named for the plan\'s board ("fractal Board"); one place tab', /^fractal\b.*Board$/.test(t1.active ?? '') && placeTabs(t1).length === 1, short(t1), { guard: true });
  await runCmd('media-organizer.editImage', PHOTO2_ID); await wait(3_000);
  t1 = await read();
  check('T3 the image editor (editImage): a tab of its own, "Edit Image"; one place tab', t1.active === 'Edit Image' && placeTabs(t1).length === 1, short(t1), { guard: true });
  await runCmd('media-organizer.openClipEditor', videoPath); await wait(3_000);
  t1 = await read();
  check('T4 the clip editor (openClipEditor): a tab of its own, "Clip · clip.mp4"; one place tab', /^Clip\b/.test(t1.active ?? '') && placeTabs(t1).length === 1, short(t1), { guard: true });
  await closeAllEditors();
  await pressColumn('Practice Session', { ms: 2_400 });
  const ran = await pressInPage('Start', { exact: true, ms: 3_000 });
  t1 = await read();
  check('T5 a practice session started (Practice Session, Start): a tab of its own, "Practice"; the place tab stays, "Practice Session"', ran && t1.active === 'Practice' && t1.at.includes('Practice Session') && placeTabs(t1).length === 1, { ran, ...short(t1) }, { guard: true });

  // ── C. The manifest's commands land in the one place tab ──
  await closeAllEditors();
  const commands = [['media-organizer.openGrid', 'All Media'], ['media-organizer.paintingPlans', 'Painting Plans'], ['media-organizer.colourStudy', 'Colour Study'], ['media-organizer.openTagReview', 'Tag Review'], ['media-organizer.findDuplicates', 'Duplicates'], ['media-organizer.practiceSession', 'Practice Session'], ['media-organizer.dailyStudy', 'Daily Study'], ['media-organizer.openGrid', 'All Media']];
  let cId = null;
  for (const [id, place] of commands) {
    const done = await cmd(page, id); await wait(2_200);
    s = await read();
    if (cId === null) cId = s.activeId;
    check(`C ${id}: lands in the one Atelier tab (same tab), named "${place}", trail "Atelier › ${place}"`, done === true && onePlace(s, place) && s.activeId === cId && trailIs(s, place), { done, ...short(s) });
  }
  await screenshot(app, page, path.join(shots, 'c-all-media-dark.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
  await wait(700);
  await screenshot(app, page, path.join(shots, 'c-all-media-light.png'));
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark'));

  // ── O. Ctrl+click and Open in Its Own Tab ──
  await closeAllEditors();
  await pressColumn('Favorites', { ms: 2_200 });
  const o0 = await read();
  const ctrl = await pressColumn('Favorites', { ctrl: true, ms: 2_200 });
  const o1 = await read();
  check('O1 on Favorites, Ctrl+click on Favorites in the column: a second Atelier tab, both "Favorites", the new one in front', onePlace(o0, 'Favorites') && ctrl && o1.at.length === 2 && o1.at.every((l) => l === 'Favorites') && o1.activeId !== o0.activeId, { before: short(o0), ctrl, after: short(o1) });
  await pressTab(null, { right: true, ms: 800 });
  const tabMenu = await menuItems();
  const picked = await pickMenuItem('Open in Its Own Tab');
  const o2 = await read();
  check('O2 the Atelier tab\'s menu has "Open in Its Own Tab": one more tab on Favorites', tabMenu.includes('Open in Its Own Tab') && picked && o2.at.length === o1.at.length + 1 && o2.at.every((l) => l === 'Favorites'), { tabMenu, after: short(o2) });

  // ── S. After the app is closed and opened ──
  await closeAllEditors();
  await pressColumn('Untagged', { ms: 2_000 });
  await pressColumn('Painting Plans', { ms: 2_400 });
  const s0 = await read();
  await wait(1_500);
  await app.close(); app = null;
  await launch();
  s = await read();
  const back1 = s.at.length === 1 ? s.at[0] : null;
  if (back1) await pressTab(back1, { ms: 2_400 });
  s = await read();
  check('S1 Untagged then Painting Plans in the one tab, the app closed and opened: one Atelier tab comes back, "Painting Plans", trail "Atelier › Painting Plans"', onePlace(s0, 'Painting Plans') && onePlace(s, 'Painting Plans') && trailIs(s, 'Painting Plans') && s.title === 'Painting Plans', { before: short(s0), after: short(s) });

  // ── X. Turned off and on ──
  await ensureAtelierOn();
  await cmd(page, 'media-organizer.openGrid'); await wait(2_200);
  await pressColumn('Probe Album', { ms: 2_000 });
  const off = await setToolEnabled(page, TOOL, false); await wait(2_500);
  const x0 = await read();
  check('X1 Atelier turned off: no Atelier tab (place or thing) and no Atelier column remain', off === true && x0.at.length === 0 && !x0.column, { off, at: x0.at, column: x0.column }, { guard: true });
  const on = await setToolEnabled(page, TOOL, true); await wait(4_000);
  await cmd(page, 'media-organizer.openGrid'); await wait(2_400);
  await cmd(page, 'media-organizer.paintingPlans'); await wait(2_400);
  const x1 = await read();
  check('X2 turned on again, openGrid then paintingPlans: one Atelier tab, "Painting Plans", trail "Atelier › Painting Plans"', on === true && onePlace(x1, 'Painting Plans') && trailIs(x1, 'Painting Plans'), { on, ...short(x1) });
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  if (page) await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app?.close().catch(() => {}); }

const real = errors.filter((e) => !/Ollama|EmbeddingService|ERR_CONNECTION_REFUSED/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] shots: ${shots}`);
console.log(`[probe] guards (true before the piece, must stay true): ${guards.join(', ') || 'none'}`);
const total = passed + failed.length;
console.log(`RESULT: ${passed}/${total} passed`);
process.exitCode = failed.length ? 1 : 0;
