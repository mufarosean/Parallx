// visual-consistency-probe.mjs — how the app looks, measured.
//
// The look of a surface is held to numbers, not to anyone's taste
// (.claude/skills/visual-bar/criteria.md has each criterion and its source).
// This boots the app hidden on a seeded workspace, opens each tool's main
// screens, takes a screenshot of each, and measures what is on screen:
//
//   smallTarget   a control under 24 by 24 CSS px with another control inside
//                 the 24 px it should own (WCAG 2.2, 2.5.8)
//   offScaleType  text in a size that is not on the app's type scale
//   offFont       text in a family that is neither the UI font nor the mono one
//   offRadius     a corner radius that is not one of the app's radii
//   offHeight     a button or field whose height is not a control height
//   uppercase     a label set in capitals by CSS (the copy rule: none)
//   clipped       text cut off with no ellipsis, or ellipsed with nothing that
//                 gives the whole of it
//   twoPrimaries  more than one primary button in one view (the kit's rule)
//   noHeader      a tool's home screen with no page header from the kit
//   titleSize     a page title in a size other than the one most screens use
//
// The spreadsheet engine, code editors, PDFs, the web view and what a person
// wrote on a page are content or third-party UI and are not measured.
//
// It compares the counts with visual-consistency-baseline.json and prints
// what rose. A report, not a gate: it exits 0 unless --strict is given.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/visual-consistency-probe.mjs [outDir] [--only=text,…] [--update] [--strict]
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { PROJECT_ROOT, launchApp, cmd, setToolEnabled } from './scene.mjs';
import { seedBeforeLaunch, seedAfterLaunch } from './audit-seed.mjs';

const args = process.argv.slice(2);
const outArg = args.find((a) => !a.startsWith('--'));
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const update = args.includes('--update');
const strict = args.includes('--strict');
const BASELINE = path.join(PROJECT_ROOT, 'tests', 'probes', 'visual-consistency-baseline.json');

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const outDir = outArg ? path.resolve(outArg) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'visual-'));
const shots = path.join(outDir, 'shots');
const appRoot = path.join(outDir, 'app');
const ws = path.join(outDir, 'workspace');
for (const d of [shots, path.join(appRoot, 'data'), ws]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* ok */ }

/**
 * Each tool's main screens. `home: true` marks a tool's front page, which
 * carries a page header. `where` says what is measured: the open editor's
 * own content (the default), the side panel on the right ('aux'), the open
 * dialog ('modal'), or the window's own frame ('chrome': title bar, activity
 * bar, sidebar, tab strip, status bar), which is measured once, not on every screen.
 */
const SCREENS = [
  { label: 'The window frame', run: ['welcome.openWelcome'], where: 'chrome' },
  { label: 'Welcome', run: ['welcome.openWelcome'] },
  { label: 'Home', run: ['home.open'], home: true },
  { label: 'Worksheets', run: ['worksheet.open'], home: true },
  { label: 'Worksheets: Problem Bank', run: ['worksheet.bank'] },
  { label: 'Worksheets: Dashboard', run: ['worksheet.dashboard'] },
  { label: 'Worksheets: Quizzes', run: ['worksheet.quizzes'] },
  { label: 'Worksheets: Campaign', run: ['worksheet.plan'] },
  { label: 'Worksheets: Settings', run: ['worksheet.settings'] },
  { label: 'Planner', run: ['planner.open'], home: true },
  { label: 'Dashboard', run: ['dashboard.open'], home: true },
  { label: 'Agents', run: ['agents.show'], where: 'aux' },
  { label: 'Routines', run: ['agents.showRoutines'], where: 'aux' },
  { label: 'Chat', run: ['chat.show'], where: 'aux' },
  { label: 'Tools and Extensions', run: ['tools.showInstalled'], home: true },
  { label: 'Settings', run: ['settings.open'], where: 'modal' },
  { label: 'Workspace Graph', run: ['workspaceGraph.open'], home: true },
  { label: 'Budget', run: ['budget.openTransactions'], home: true },
  { label: 'Flashcards', run: ['flashcards.open'], home: true },
  { label: 'Concept Lab', run: ['conceptLab.open'], home: true },
  { label: 'Media Organizer', run: ['media-organizer.openGrid'], home: true },
  { label: 'Creations', run: ['textGenerator.openHome'], home: true },
  { label: 'Study', run: ['study.open'], home: true },
];
const EXTS = ['parallx.workspace-graph', 'parallx.budget', 'parallx-community.flashcards', 'parallx.concept-lab', 'parallx-community.media-organizer', 'parallx-community.creations-ai', 'parallx-community.study'];

/** Runs in the page: what is on screen now, measured. */
function measure(where) {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const px = (name) => { const v = cs.getPropertyValue(name).trim(); const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const scale = ['--px-text-2xs', '--px-text-xs', '--px-text-sm', '--px-text-base', '--px-text-md', '--px-text-lg', '--px-text-xl'].map(px).filter((n) => n !== null);
  const radii = ['--px-radius-xs', '--px-radius-sm', '--px-radius-md', '--px-radius-lg', '--px-radius-xl'].map(px).filter((n) => n !== null);
  const heights = ['--px-control-h-xs', '--px-control-h-sm', '--px-control-h', '--px-control-h-lg'].map(px).filter((n) => n !== null);
  const firstFamily = (v) => v.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font-family:var(--px-font-ui)'; document.body.appendChild(probe);
  const uiFont = firstFamily(getComputedStyle(probe).fontFamily);
  probe.style.fontFamily = 'var(--px-font-mono)';
  const monoFont = firstFamily(getComputedStyle(probe).fontFamily);
  probe.remove();

  // Not ours to measure: third-party surfaces and what a person wrote.
  const SKIP = '.ws-pane__sheet, #ws-univer-popup-root, .cm-editor, .monaco-editor, .tiptap, [contenteditable="true"], webview, iframe, canvas, svg, .pdf-editor-pane .page, .pdfViewer, .xterm, .markdown-body, .px-markdown, [data-px-content], .katex';
  const part = (id) => document.querySelector(`[data-part-id="workbench.parts.${id}"]`);
  const editor = part('editor') ?? document.body;
  const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter((m) => m.getClientRects().length).pop();
  // What is measured, and what inside it belongs to another row of the report.
  const TABS = '.editor-tab-bar';
  let scopes; let area; let also = '';
  if (where === 'chrome') { scopes = [part('titlebar'), part('activitybar'), part('sidebar'), part('statusbar'), ...editor.querySelectorAll(TABS)].filter(Boolean); area = editor; }
  else if (where === 'aux') { scopes = [part('auxiliarybar')].filter(Boolean); area = scopes[0] ?? editor; }
  else if (where === 'modal') { scopes = [modal].filter(Boolean); area = modal ?? editor; }
  else { scopes = [editor]; area = editor; also = `, ${TABS}`; }
  const vw = innerWidth; const vh = innerHeight;
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return null;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return null;
    return { r, s };
  };
  const name = (el) => {
    const id = el.getAttribute('data-px-id');
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}${id ? `#${id}` : cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };
  const near = (a, list) => list.includes(Math.round(a * 100) / 100) || list.some((x) => Math.abs(x - a) <= 0.51);

  const out = { smallTarget: [], offScaleType: [], offFont: [], offRadius: [], offHeight: [], uppercase: [], clipped: [], twoPrimaries: [], title: null, header: false, counted: { text: 0, controls: 0 } };
  const CONTROL = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="radio"], [role="option"], [role="link"], [tabindex="0"]';
  const controls = [];
  const seen = { type: new Map(), font: new Map(), radius: new Map(), height: new Map() };
  const add = (map, key, el) => { const e = map.get(key); if (e) e.n++; else map.set(key, { n: 1, eg: name(el) }); };

  for (const scope of scopes) {
    for (const el of scope.querySelectorAll('*')) {
      if (el.closest(SKIP + also)) continue;
      const v = onScreen(el);
      if (!v) continue;
      const { r, s } = v;
      // Text this element itself holds.
      const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (ownText) {
        out.counted.text++;
        const size = parseFloat(s.fontSize);
        if (!near(size, scale)) add(seen.type, `${Math.round(size * 10) / 10}px`, el);
        const fam = firstFamily(s.fontFamily);
        if (fam !== uiFont && fam !== monoFont) add(seen.font, fam, el);
        if (s.textTransform === 'uppercase' && el.textContent.trim().length > 1) out.uppercase.push(name(el));
        if (el.scrollWidth > el.clientWidth + 1 && (s.overflowX === 'hidden' || s.overflowX === 'clip') && s.whiteSpace.includes('nowrap')) {
          const whole = el.getAttribute('title') || el.closest('[title]')?.getAttribute('title') || el.closest('[aria-label]')?.getAttribute('aria-label');
          if (s.textOverflow !== 'ellipsis') out.clipped.push(`${name(el)}: cut off with no ellipsis`);
          else if (!whole) out.clipped.push(`${name(el)}: ellipsed, and nothing gives the whole text`);
        }
      }
      // Corners.
      const radius = parseFloat(s.borderTopLeftRadius);
      const drawn = s.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(s.borderTopWidth) > 0;
      if (drawn && radius > 0) {
        const pill = radius >= Math.min(r.width, r.height) / 2 - 0.5 || s.borderTopLeftRadius.includes('%') || radius >= 99;
        if (!pill && !near(radius, radii)) add(seen.radius, `${Math.round(radius * 10) / 10}px`, el);
      }
      if (el.matches(CONTROL)) {
        // A link inside a sentence is text, not a target of its own (WCAG 2.5.8, inline exception).
        const inline = el.tagName === 'A' && s.display.startsWith('inline') && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length + 10;
        if (!inline) controls.push({ el, r });
        out.counted.controls++;
        if ((el.tagName === 'BUTTON' && el.className && /px-btn\b|ui-button\b/.test(String(el.className))) || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && /^(text|search|number|email|url|password|)$/.test(el.type))) {
          if (!near(r.height, heights)) add(seen.height, `${Math.round(r.height * 10) / 10}px`, el);
        }
      }
    }
  }
  // Targets: under 24 px in either direction, and another target inside the 24 px circle it should own.
  for (const c of controls) {
    if (c.r.width >= 24 && c.r.height >= 24) continue;
    const cx = c.r.left + c.r.width / 2; const cy = c.r.top + c.r.height / 2;
    const crowded = controls.some((o) => {
      if (o === c || o.el.contains(c.el) || c.el.contains(o.el)) return false;
      const dx = Math.max(o.r.left - cx, 0, cx - o.r.right); const dy = Math.max(o.r.top - cy, 0, cy - o.r.bottom);
      return Math.hypot(dx, dy) < 12;
    });
    if (crowded) out.smallTarget.push(`${name(c.el)}: ${Math.round(c.r.width)} by ${Math.round(c.r.height)}`);
  }
  for (const [k, v] of seen.type) out.offScaleType.push(`${k} (${v.n} places, e.g. ${v.eg})`);
  for (const [k, v] of seen.font) out.offFont.push(`${k} (${v.n} places, e.g. ${v.eg})`);
  for (const [k, v] of seen.radius) out.offRadius.push(`${k} (${v.n} places, e.g. ${v.eg})`);
  for (const [k, v] of seen.height) out.offHeight.push(`${k} (${v.n} controls, e.g. ${v.eg})`);
  // One primary action to a view.
  const primaries = Array.from(area.querySelectorAll('.px-btn--primary, .ui-button--primary')).filter((b) => !b.closest(SKIP) && onScreen(b));
  if (primaries.length > 1) out.twoPrimaries.push(`${primaries.length} primary buttons: ${primaries.slice(0, 4).map(name).join(', ')}`);
  // The page's title, and whether it is the kit's header.
  const header = Array.from(area.querySelectorAll('.px-page-header')).find((h) => onScreen(h));
  out.header = !!header;
  const h1 = (header && header.querySelector('.px-page-header__title')) || Array.from(area.querySelectorAll('h1')).find((h) => !h.closest(SKIP) && onScreen(h));
  if (h1) { const s = getComputedStyle(h1); out.title = `${Math.round(parseFloat(s.fontSize) * 10) / 10}px / ${s.fontWeight}`; }
  out.scale = scale; out.radii = radii; out.heights = heights; out.fonts = [uiFont, monoFont];
  for (const k of ['smallTarget', 'uppercase', 'clipped']) out[k] = [...new Set(out[k])];
  return out;
}

/**
 * A picture of the hidden window. A still page there makes no new frame until
 * something changes, so a 1 px dot is nudged first; if the page still gives
 * none, the main process hands over what the window last drew.
 */
async function shot(file) {
  await page.evaluate(() => {
    let d = document.getElementById('__probe_repaint');
    if (!d) { d = document.createElement('div'); d.id = '__probe_repaint'; d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none;z-index:2147483647'; document.body.appendChild(d); }
    d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01';
  }).catch(() => {});
  if (await page.screenshot({ path: file, timeout: 8_000 }).then(() => true, () => false)) return true;
  const b64 = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : null; }).catch(() => null);
  if (!b64) return false;
  await fs.writeFile(file, Buffer.from(b64, 'base64'));
  return true;
}

const KINDS = ['smallTarget', 'offScaleType', 'offFont', 'offRadius', 'offHeight', 'uppercase', 'clipped', 'twoPrimaries', 'noHeader', 'titleSize'];
const seedPre = await seedBeforeLaunch(ws);
const { app, page, errors } = await launchApp(appRoot);
const report = [];
try {
  for (const id of EXTS) await setToolEnabled(page, id, true);
  await page.waitForTimeout(3_000);
  await seedAfterLaunch(page, seedPre);
  for (const screen of SCREENS) {
    if (only.length && !only.some((o) => screen.label.toLowerCase().includes(o.toLowerCase()))) continue;
    await page.keyboard.press('Escape');
    const opened = await cmd(page, ...screen.run);
    if (opened !== true) { report.push({ screen: screen.label, notOpened: String(opened) }); console.log(`[screen] ${screen.label}: not opened (${opened})`); continue; }
    await page.waitForTimeout(1_800);
    const file = `${screen.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    const shotTaken = await shot(path.join(shots, file));
    const m = await page.evaluate(measure, screen.where ?? 'editor');
    if (screen.where === 'modal') { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    const row = { screen: screen.label, shot: shotTaken ? file : null, home: !!screen.home, where: screen.where ?? 'editor', ...m, noHeader: screen.home && !m.header ? ['a tool\'s front page with no page header from the kit'] : [], titleSize: [] };
    report.push(row);
  }
} finally {
  await app.close().catch(() => {});
}

// The title size most screens use; the others are the outliers.
const titles = report.filter((r) => r.title);
const tally = new Map();
for (const r of titles) tally.set(r.title, (tally.get(r.title) ?? 0) + 1);
const usual = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
for (const r of titles) if (usual && r.title !== usual) r.titleSize = [`title is ${r.title}; ${tally.get(usual)} of ${titles.length} screens use ${usual}`];

const counts = {};
for (const r of report) {
  if (r.notOpened) continue;
  counts[r.screen] = Object.fromEntries(KINDS.map((k) => [k, r[k].length]));
  const line = KINDS.filter((k) => r[k].length).map((k) => `${k}=${r[k].length}`).join(' ');
  console.log(`[screen] ${r.screen}: ${line || 'nothing found'} (text ${r.counted.text}, controls ${r.counted.controls})`);
}
const totals = Object.fromEntries(KINDS.map((k) => [k, report.reduce((n, r) => n + (r[k]?.length ?? 0), 0)]));
console.log(`\n[totals] ${JSON.stringify(totals)}`);
for (const k of KINDS) {
  const rows = report.filter((r) => r[k]?.length);
  if (!rows.length) continue;
  console.log(`\n# ${k}`);
  for (const r of rows) for (const f of r[k].slice(0, 6)) console.log(`  ${r.screen}: ${f}`);
}
if (titles.length) console.log(`\n# page titles\n${[...tally.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `  ${t}: ${n} screens${t === usual ? '' : ` (${titles.filter((r) => r.title === t).map((r) => r.screen).join(', ')})`}`).join('\n')}`);

await fs.writeFile(path.join(outDir, 'results.json'), JSON.stringify({ at: new Date().toISOString(), totals, report }, null, 1));

// Against the record: what rose since the baseline was taken.
let rises = [];
if (update) {
  const base = existsSync(BASELINE) && only.length ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  await fs.writeFile(BASELINE, JSON.stringify({ ...base, ...counts }, null, 2) + '\n');
  console.log(`\n[baseline] written for ${Object.keys(counts).length} screens`);
} else if (existsSync(BASELINE)) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  for (const [screen, now] of Object.entries(counts)) {
    const was = base[screen];
    if (!was) { const any = KINDS.filter((k) => now[k]); if (any.length) rises.push(`${screen}: a new screen, with ${any.map((k) => `${k}=${now[k]}`).join(' ')}`); continue; }
    for (const k of KINDS) if ((now[k] ?? 0) > (was[k] ?? 0)) rises.push(`${screen}: ${k} ${was[k] ?? 0} -> ${now[k]}`);
  }
  console.log(`\n[against the baseline] ${rises.length ? `${rises.length} rose:\n${rises.map((r) => `  ${r}`).join('\n')}` : 'nothing rose'}`);
} else {
  console.log('\n[baseline] none yet: run with --update to record these counts');
}
const notOpened = report.filter((r) => r.notOpened);
if (notOpened.length) console.log(`\n[not opened] ${notOpened.map((r) => `${r.screen} (${r.notOpened})`).join('; ')}`);
if (errors.length) console.log(`\n[page errors] ${errors.length}\n${errors.slice(0, 5).map((e) => `  ${e}`).join('\n')}`);
console.log(`\n[out] ${outDir}`);
process.exitCode = strict && rises.length ? 1 : 0;
