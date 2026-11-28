// atelier-review-fixes-probe.mjs — checks the three review fixes of Getting around
// piece 4 (dev 2c991b08) with real input: a plan's My Paints closes with the Colour
// step; a colour sheet's kit title takes the keys; Daily Study's title takes the
// player's keys, Alt+Left is Back. Setup and helpers copied from
// getting-around-atelier-acceptance.mjs (its seeding of a library).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/atelier-review-fixes-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, launchApp, cmd, screenshot, toolList, setToolEnabled } from './scene.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-atelier-review-fixes');
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

/** The visible section titles of the active editor (what panel is showing). */
const sections = () => page.evaluate(() => {
  const act = [...document.querySelectorAll('.editor-group .ui-tab--active')].find((t) => t.getClientRects().length && !t.closest('.editor-pane-container'));
  const panes = act?.closest('.editor-group')?.querySelector('.editor-pane-container');
  return [...(panes?.querySelectorAll('.mo-practice-section-title') ?? [])].filter((x) => x.getClientRects().length).map((x) => x.textContent.trim());
});
const csState = () => page.evaluate(() => { const r = [...document.querySelectorAll('.mo-cs')].find((x) => x.getClientRects().length); const h = r && r.__moColourStudy; return h && h.state ? JSON.parse(JSON.stringify(h.state())) : null; });
const player = () => page.evaluate(() => {
  const r = [...document.querySelectorAll('.mo-practice')].find((x) => x.getClientRects().length); if (!r) return null;
  const pb = r.querySelector('[data-px-id="media-organizer.practice.player.pause"], .mo-practice-btn[aria-label="Pause"], .mo-practice-btn[aria-label="Resume"]');
  const btns = [...r.querySelectorAll('.mo-practice-btn')].map((b) => b.getAttribute('aria-label'));
  const end = r.querySelector('.mo-practice-end');
  return { pause: btns.find((l) => l === 'Pause' || l === 'Resume') ?? null, clock: r.querySelector('.mo-practice-clock')?.textContent ?? '', counter: r.querySelector('.mo-practice-counter')?.textContent ?? '', ended: !!end && !end.classList.contains('mo-hidden'), endText: (end?.textContent ?? '').trim().slice(0, 80) };
});

try {
  await launch();
  const on = await ensureAtelierOn();
  await artToolsOn(); await wait(1_200);
  const planMade = await runCmd('media-organizer.planPainting', seeded.photo['fractal.jpg']); await wait(3_000);
  console.log(`[seed] Atelier on: ${on}; plan: ${JSON.stringify(planMade)}`);
  await closeAllEditors();

  // ── 1. Painting Plan: My Paints closes with the Colour step ──
  await pressColumn('Painting Plans', { ms: 2_200 });
  const card = await centre('.mo-plans-card');
  if (card) { await page.mouse.click(card.x, card.y); await wait(2_800); }
  const colourStep = async () => { const at = await centre('.mo-plan-step[aria-label="Colour"]'); if (at) { await page.mouse.click(at.x, at.y); await wait(1_800); } return !!at; };
  const stepOk = await colourStep();
  const a0 = await read(); const sec0 = await sections();
  const mp = await pressInPage('My Paints', { ms: 1_800 });
  const a1 = await read(); const sec1 = await sections();
  check('1.1 plan Colour step, My Paints pressed: trail ends "My Paints", the panel shows "Paints you have"', !!card && stepOk && mp && a1.crumbs.at(-1)?.label === 'My Paints' && sec1.includes('Paints you have'), { card: !!card, stepOk, mp, crumbs: a1.crumbs.map((c) => c.label), sec1 });
  await screenshot(app, page, path.join(shots, 'plan-my-paints.png'), { keepFocus: true });
  for (const other of ['Photo', 'Values']) {
    const at = await centre(`.mo-plan-step[aria-label="${other}"]`);
    if (at) { await page.mouse.click(at.x, at.y); await wait(1_800); }
    const b = await read();
    check(`1.2 ${other} step pressed from My Paints: the trail has no My Paints crumb`, !!at && !b.crumbs.some((c) => c.label === 'My Paints'), { pressed: !!at, crumbs: b.crumbs.map((c) => c.label) });
    await colourStep();
    const c = await read(); const secC = await sections();
    check(`1.3 Colour pressed again after ${other}: My Paints did not come back (no "Paints you have", no My Paints crumb), the colours panel as before`, !secC.includes('Paints you have') && !c.crumbs.some((x) => x.label === 'My Paints') && JSON.stringify(secC) === JSON.stringify(sec0), { secC, sec0, crumbs: c.crumbs.map((x) => x.label) });
    // open My Paints again for the next round
    await pressInPage('My Paints', { ms: 1_800 });
  }
  await screenshot(app, page, path.join(shots, 'plan-colours-after.png'), { keepFocus: true });
  const a2 = await read();
  const planCrumb = a2.crumbs.length >= 2 ? a2.crumbs[a2.crumbs.length - 2].label : null;
  const pc = planCrumb ? await pressCrumb(planCrumb) : false;
  const a3 = await read(); const sec3 = await sections();
  check('1.4 from My Paints, the plan\'s crumb pressed: back on the colours (no "Paints you have", trail has no My Paints, same tab)', a2.crumbs.at(-1)?.label === 'My Paints' && pc && !sec3.includes('Paints you have') && JSON.stringify(sec3) === JSON.stringify(sec0) && a3.crumbs.at(-1)?.label !== 'My Paints' && a3.activeId === a2.activeId, { before: a2.crumbs.map((c) => c.label), planCrumb, after: a3.crumbs.map((c) => c.label), sec3 });
  // twice: My Paints then the crumb again
  await pressInPage('My Paints', { ms: 1_800 });
  const a4 = await read(); const pc2 = a4.crumbs.length >= 2 ? await pressCrumb(a4.crumbs[a4.crumbs.length - 2].label) : false;
  const sec5 = await sections();
  check('1.5 twice in a row: My Paints, crumb: back on the colours again', a4.crumbs.at(-1)?.label === 'My Paints' && pc2 && JSON.stringify(sec5) === JSON.stringify(sec0), { a4: a4.crumbs.map((c) => c.label), sec5 });
  await closeAllEditors();

  // ── 2. Colour Study sheet: keys on the kit title; Edit Mix crumb ──
  const sid = await runCmd('media-organizer.colour.newSheet'); await wait(2_000);
  console.log(`[seed] colour sheet ${JSON.stringify(sid)}`);
  await closeAllEditors();
  await pressColumn('Colour Study', { ms: 2_200 });
  // Tab to the sheet's Open control, then Enter
  let reached = null;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab'); await wait(120);
    reached = await page.evaluate(() => { const a = document.activeElement; return a && a.classList.contains('mo-plans-open') ? (a.querySelector('.mo-plans-card-title')?.textContent ?? '') : null; });
  }
  if (reached) { await page.keyboard.press('Enter'); await wait(2_600); }
  const b1 = await read(); const st1 = await csState();
  const focusTxt = b1.focus?.text ?? '';
  check('2.1 Tab to the sheet on Colour Study\'s page, Enter: the sheet opens and the keys are on its kit title (h1.px-page-header__title, tabindex -1, text = the sheet\'s name)', !!reached && !!st1 && titleFocused(b1) && focusTxt === st1.title && focusTxt === reached, { reached, sheet: st1 && st1.title, focus: b1.focus, crumbs: b1.crumbs.map((c) => c.label) });
  await screenshot(app, page, path.join(shots, 'sheet-dark.png'), { keepFocus: true });
  const ed = await pressInPage('Edit Mix', { ms: 1_600 });
  const b2 = await read(); const st2 = await csState();
  check('2.2 Edit Mix pressed: trail ends "The Mix" (one crumb more), the sheet on its bench', ed && b2.crumbs.at(-1)?.label === 'The Mix' && b2.crumbs.length === b1.crumbs.length + 1 && st2?.view === 'bench', { ed, crumbs: b2.crumbs.map((c) => c.label), view: st2?.view });
  const prev = b2.crumbs.length >= 2 ? b2.crumbs[b2.crumbs.length - 2].label : null;
  const pb = prev ? await pressCrumb(prev) : false;
  const b3 = await read(); const st3 = await csState();
  check('2.3 the crumb before "The Mix" pressed: back on the rows, trail without The Mix, same tab', pb && st3?.view === 'rows' && !b3.crumbs.some((c) => c.label === 'The Mix') && b3.activeId === b2.activeId, { prev, crumbs: b3.crumbs.map((c) => c.label), view: st3?.view });
  // twice
  await pressInPage('Edit Mix', { ms: 1_600 }); const b4 = await read();
  if (b4.crumbs.length >= 2) await pressCrumb(b4.crumbs[b4.crumbs.length - 2].label);
  const st5 = await csState();
  check('2.4 twice in a row: Edit Mix then the crumb: rows again', b4.crumbs.at(-1)?.label === 'The Mix' && st5?.view === 'rows', { b4: b4.crumbs.map((c) => c.label), view: st5?.view });
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light')); await wait(600);
  await screenshot(app, page, path.join(shots, 'sheet-light.png'), { keepFocus: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'dark')); await wait(400);
  await closeAllEditors();

  // ── 3. Daily Study: the title takes the player's keys; Alt+Left is Back ──
  await pressColumn('All Media', { ms: 2_400 });
  await pressColumn('Daily Study', { ms: 3_500 });
  const d0 = await read(); const p0 = await player();
  check('3.1 Daily Study opened from the column: keys on the "Daily Study" title, the player running', titleFocused(d0) && d0.focus.text === 'Daily Study' && p0?.pause === 'Pause', { focus: d0.focus, player: p0, active: d0.active });
  await screenshot(app, page, path.join(shots, 'daily-dark.png'), { keepFocus: true });
  const f1 = (await read()).focus;
  await page.keyboard.press('Space'); await wait(600);
  const p1 = await player(); await wait(2_200); const p1b = await player();
  check('3.2 Space on the title: the run pauses (the button reads Resume; the clock stands still for 2 s)', p1?.pause === 'Resume' && p1.clock === p1b.clock, { focusAtSpace: f1, before: p0, after: p1, later: p1b?.clock });
  await page.keyboard.press('Space'); await wait(1_600);
  const p2 = await player(); await wait(1_400); const p2b = await player();
  check('3.3 Space again: it resumes (Pause again; the clock moves)', p2?.pause === 'Pause' && p2.clock !== p2b.clock, { p2, later: p2b?.clock });
  const d1 = await read();
  await page.keyboard.press('Alt+ArrowLeft'); await wait(2_400);
  const d2 = await read();
  check('3.4 Alt+Left: Back to the previous place (All Media), same tab', d1.active === 'Daily Study' && d2.active === 'All Media' && d2.activeId === d1.activeId, { from: d1.active, to: d2.active, ids: [d1.activeId, d2.activeId] });
  await page.keyboard.press('Alt+ArrowRight'); await wait(3_000);
  const d3 = await read(); const p3 = await player();
  check('3.5 Alt+Right: Forward to Daily Study, keys on its title again', d3.active === 'Daily Study' && titleFocused(d3), { active: d3.active, focus: d3.focus, player: p3 });
  const p3s = await player(); await page.keyboard.press('Space'); await wait(600); const p3t = await player();
  check('3.5b after Forward, Space on the title pauses (Resume); Space again resumes', p3s?.pause === 'Pause' && p3t?.pause === 'Resume', { before: p3s, after: p3t });
  await page.keyboard.press('Space'); await wait(600);
  // ArrowRight: compare to the player itself — in the player one draw, ArrowRight = Skip, the last draw ends the run
  const p4a = await player();
  await page.keyboard.press('ArrowRight'); await wait(2_000);
  const p4 = await player();
  check('3.6 ArrowRight on the title moves on (one picture today: the run ends, as Skip does in the player)', !!p4a && !p4a.ended && (p4?.ended || p4?.counter !== p4a.counter), { before: p4a, after: p4 });
  await screenshot(app, page, path.join(shots, 'daily-after-right.png'), { keepFocus: true });
} catch (e) {
  check('the probe ran to the end', false, String(e?.stack || e).slice(0, 600));
} finally {
  await app?.close().catch(() => {});
}
console.log(`[atelier-review-fixes] ${passed} ok, ${failed.length} FAIL; shots: ${shots}`);
process.exit(failed.length ? 1 : 0);
