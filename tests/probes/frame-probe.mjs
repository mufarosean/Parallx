// frame-probe.mjs — the window's frame (1E6): one column, the bell and the
// panel buttons in the title bar, tabs as wide as their names.
//
// Boots the built app hidden on a seeded workspace with the extensions on,
// opens a few tools, and reads the frame back from the app: where the tools
// list sits, that every tool has a row with a name that the keys reach, that
// pressing a row opens that tool's list under its name, where the bell is,
// and how wide the tabs are. Screenshots in dark and light.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/frame-probe.mjs [outDir]
import path from 'node:path';
import fs from 'node:fs/promises';
import { PROJECT_ROOT, launchApp, cmd, setToolEnabled } from './scene.mjs';
import { seedBeforeLaunch, seedAfterLaunch } from './audit-seed.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'frame-'));
const shots = path.join(outDir, 'shots');
const appRoot = path.join(outDir, 'app');
const ws = path.join(outDir, 'workspace');
for (const d of [shots, path.join(appRoot, 'data'), ws]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* ok */ }

const EXTS = ['parallx-community.flashcards', 'parallx-community.study', 'parallx-community.media-organizer', 'parallx.budget'];
const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };

const seedPre = await seedBeforeLaunch(ws);
const { app, page, errors } = await launchApp(appRoot);
const shot = async (name) => {
  await page.evaluate(() => {
    let d = document.getElementById('__probe_repaint');
    if (!d) { d = document.createElement('div'); d.id = '__probe_repaint'; d.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none;z-index:2147483647'; document.body.appendChild(d); }
    d.style.opacity = d.style.opacity === '0.01' ? '0.02' : '0.01';
  }).catch(() => {});
  const file = path.join(shots, name);
  if (await page.screenshot({ path: file, timeout: 8_000 }).then(() => true, () => false)) return;
  const b64 = await app.evaluate(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w ? (await w.webContents.capturePage()).toPNG().toString('base64') : null; }).catch(() => null);
  if (b64) await fs.writeFile(file, Buffer.from(b64, 'base64'));
};
const mode = async (m) => {
  await cmd(page, 'settings.openAppearance'); await page.waitForTimeout(800);
  await page.evaluate((m) => Array.from(document.querySelectorAll(`[data-px-id="appearance.mode.${m}"]`)).find((e) => e.getClientRects().length)?.click(), m);
  await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
};
/** The frame, read from the page. */
const frame = () => page.evaluate(() => {
  const rect = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const sidebar = document.querySelector('[data-part-id="workbench.parts.sidebar"]');
  const list = document.querySelector('[data-part-id="workbench.parts.activitybar"]');
  const rows = Array.from(document.querySelectorAll('[data-part-id="workbench.parts.activitybar"] .activity-bar-item')).filter((b) => b.getClientRects().length);
  const foot = Array.from(document.querySelectorAll('.sidebar-foot .column-foot-row'));
  const bell = document.querySelector('[data-px-id="activitybar.notifications"]');
  const tabs = Array.from(document.querySelectorAll('.editor-tab-bar .ui-tab'));
  const views = document.querySelector('.sidebar-views');
  const footBox = document.querySelector('.sidebar-foot');
  return {
    sidebar: sidebar ? rect(sidebar) : null,
    listInColumn: !!(list && sidebar && sidebar.contains(list)),
    head: document.querySelector('.sidebar-header-label')?.textContent ?? null,
    headFont: getComputedStyle(document.querySelector('.sidebar-header-label')).fontFamily.split(',')[0].replace(/["']/g, ''),
    rows: rows.map((b) => ({ id: b.dataset.iconId, name: b.getAttribute('aria-label'), shown: b.querySelector('.activity-bar-item-name')?.textContent ?? '', nameVisible: !!b.querySelector('.activity-bar-item-name')?.getClientRects().length, selected: b.getAttribute('aria-selected'), tab: b.tabIndex, ...rect(b) })),
    foot: foot.map((b) => ({ name: b.textContent.trim(), tab: b.tabIndex, ...rect(b) })),
    viewsBottom: views ? Math.round(views.getBoundingClientRect().bottom) : null,
    footTop: footBox ? Math.round(footBox.getBoundingClientRect().top) : null,
    activeViewBottom: (() => { const vc = Array.from(document.querySelectorAll('.sidebar-views > *')).find((e) => e.getClientRects().length); return vc ? Math.round(vc.getBoundingClientRect().bottom) : null; })(),
    bellInTitlebar: !!bell?.closest('[data-part-id="workbench.parts.titlebar"]'),
    bell: bell ? rect(bell) : null,
    titlebarButtons: Array.from(document.querySelectorAll('.titlebar-right .titlebar-layout-btn')).map((b) => b.getAttribute('aria-label')),
    menus: Array.from(document.querySelectorAll('.titlebar-menu-item')).map((m) => m.textContent.trim()),
    tabs: tabs.map((t) => ({ name: t.querySelector('.ui-tab-label')?.textContent, w: Math.round(t.getBoundingClientRect().width), icon: !!t.querySelector('.ui-tab-icon svg, .ui-tab-icon img, .ui-tab-icon span') || !!t.querySelector('.ui-tab-icon')?.textContent?.trim() })),
    focus: (() => { const a = document.activeElement; return a ? { id: a.dataset?.pxId ?? null, name: a.getAttribute?.('aria-label') ?? a.textContent?.trim().slice(0, 40), ring: getComputedStyle(a).boxShadow !== 'none' || getComputedStyle(a).outlineStyle !== 'none' } : null; })(),
  };
});

try {
  for (const id of EXTS) await setToolEnabled(page, id, true);
  await page.waitForTimeout(3_000);
  await seedAfterLaunch(page, seedPre);
  for (const run of [['study.open'], ['flashcards.open'], ['planner.open'], ['worksheet.open'], ['tools.showInstalled']]) { await cmd(page, ...run); await page.waitForTimeout(900); }
  await cmd(page, 'study.open'); await page.waitForTimeout(1_200);

  let f = await frame();
  console.log(JSON.stringify({ head: f.head, rows: f.rows.map((r) => r.name), foot: f.foot.map((r) => r.name), tabs: f.tabs, titlebar: f.titlebarButtons, menus: f.menus }, null, 1));
  check('the tools list sits inside the column', f.listInColumn, f);
  check('the column starts at the window\'s left edge (no rail beside it)', f.sidebar?.x === 0, f.sidebar);
  check('every tool that is on has a row', f.rows.length >= 6, f.rows.length);
  check('every row shows its name', f.rows.every((r) => r.nameVisible && r.shown === r.name && r.name), f.rows.filter((r) => !r.nameVisible || r.shown !== r.name));
  check('a row is at least 24 px tall and as wide as the column allows', f.rows.every((r) => r.h >= 24 && r.w > 120), f.rows.map((r) => [r.h, r.w]));
  check('the foot ends with Tools and Extensions, then Settings', f.foot.map((r) => r.name).join('|') === 'Tools and Extensions|Settings', f.foot);
  check('the last rows are under the tools', f.foot.length === 2 && f.foot[0].y > Math.max(...f.rows.map((r) => r.y)), f.foot);
  check('the open tool\'s list ends where the foot begins', f.activeViewBottom !== null && f.activeViewBottom <= f.footTop + 1, { view: f.activeViewBottom, foot: f.footTop });
  check('the head names the open tool in the display face', !!f.head && /newsreader/i.test(f.headFont), { head: f.head, font: f.headFont });
  check('the bell is in the title bar', f.bellInTitlebar, f.bell);
  check('the title bar has search, the three area buttons and the bell', ['Search Commands', 'Toggle Left Area', 'Toggle Bottom Area', 'Toggle Right Area'].every((n) => f.titlebarButtons.includes(n)) && f.titlebarButtons.some((n) => /^Notifications/.test(n)), f.titlebarButtons);
  check('the title bar keeps the menu words', ['File', 'Edit', 'View', 'Help'].every((m) => f.menus.includes(m)), f.menus);
  check('tabs are as wide as their names (not one width)', new Set(f.tabs.map((t) => t.w)).size > 1, f.tabs);
  check('every tab carries an icon', f.tabs.length >= 4 && f.tabs.every((t) => t.icon), f.tabs.filter((t) => !t.icon));

  // Press each tool's row with the mouse: the head names it and its row is the selected one.
  const wrong = [];
  for (const r of f.rows) {
    if (r.id.startsWith('part:')) continue;
    await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); await page.waitForTimeout(350);
    const g = await frame();
    const row = g.rows.find((x) => x.id === r.id);
    if (g.head !== r.name || row?.selected !== 'true' || !g.sidebar || g.sidebar.w < 100) wrong.push({ row: r.name, head: g.head, selected: row?.selected, sidebar: g.sidebar });
  }
  check('pressing a tool\'s row opens its list under its name', wrong.length === 0, wrong);
  // Pressing the open tool again leaves the column open.
  f = await frame();
  const open = f.rows.find((r) => r.selected === 'true');
  await page.mouse.click(open.x + 20, open.y + open.h / 2); await page.waitForTimeout(500);
  f = await frame();
  check('pressing the open tool again leaves the column open', !!f.sidebar && f.sidebar.w > 100 && f.rows.length > 0, f.sidebar);

  // Keys: focus the open row, walk every row with the arrows, open one with Enter.
  await page.evaluate(() => document.querySelector('[data-part-id="workbench.parts.activitybar"] .activity-bar-item[tabindex="0"]')?.focus());
  await page.keyboard.press('Home'); await page.waitForTimeout(100);
  const walked = [];
  for (let i = 0; i < f.rows.length; i++) {
    const g = await frame();
    walked.push({ name: g.focus?.name, ring: g.focus?.ring });
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(80);
  }
  check('the arrow keys reach every tool, each named', walked.map((w) => w.name).join('|') === f.rows.map((r) => r.name).join('|'), walked);
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  let g = await frame();
  check('Enter on a row opens that tool', g.head === f.rows[1].name, { head: g.head, want: f.rows[1].name });
  // Tab from the tools goes to the last two rows, each a stop of its own.
  await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  const stop1 = (await frame()).focus;
  await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  const stop2 = (await frame()).focus;
  check('Tab reaches Tools and Extensions, then Settings', stop1?.id === 'column.toolsAndExtensions' && stop2?.id === 'column.settings', [stop1, stop2]);
  check('the focused row shows a ring', !!stop2?.ring, stop2);
  await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  check('Enter on Settings opens Settings', await page.evaluate(() => !!document.querySelector('[data-px-surface="settings"]')), null);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // The bell opens the list of notices under it.
  f = await frame();
  await page.mouse.click(f.bell.x + f.bell.w / 2, f.bell.y + f.bell.h / 2); await page.waitForTimeout(500);
  const panel = await page.evaluate(() => { const p = document.querySelector('[data-px-surface="notificationCenter"]'); if (!p) return null; const r = p.getBoundingClientRect(); return { top: Math.round(r.top), right: Math.round(r.right), w: Math.round(r.width), vw: window.innerWidth }; });
  check('the bell opens the notifications under it, inside the window', !!panel && panel.top >= f.bell.y + f.bell.h && panel.right <= panel.vw, panel);
  await shot('dark-bell.png');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // Hiding the column with the title bar's button, and back.
  await cmd(page, 'workbench.action.toggleSidebar'); await page.waitForTimeout(700);
  g = await frame();
  check('the title bar\'s button hides the whole column', !g.sidebar || g.sidebar.w === 0 || g.rows.length === 0, g.sidebar);
  await shot('dark-column-hidden.png');
  await cmd(page, 'workbench.action.toggleSidebar'); await page.waitForTimeout(700);
  g = await frame();
  check('and brings it back with its tools', !!g.sidebar && g.sidebar.w > 100 && g.rows.length === f.rows.length, g.sidebar);

  // A tool turned off loses its row at once.
  const before = (await frame()).rows.map((r) => r.name);
  await setToolEnabled(page, 'parallx.budget', false); await page.waitForTimeout(1_500);
  const after = (await frame()).rows.map((r) => r.name);
  check('a tool turned off loses its row', after.length === before.length - 1, { before, after });

  await cmd(page, 'study.open'); await page.waitForTimeout(1_000);
  await page.evaluate(() => { const b = document.querySelector('.activity-bar-item[data-icon-id="study-container"]'); b?.click(); });
  await page.waitForTimeout(600);
  await shot('dark.png');
  await cmd(page, 'chat.show'); await page.waitForTimeout(1_000);
  await shot('dark-chat.png');
  await cmd(page, 'workbench.action.showCommands'); await page.waitForTimeout(700);
  await shot('dark-palette.png');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await mode('light');
  await shot('light-chat.png');
  await cmd(page, 'workbench.action.toggleAuxiliaryBar').catch(() => {}); await page.waitForTimeout(800);
  await shot('light.png');
  await page.evaluate(() => { const b = document.querySelector('.activity-bar-item[data-icon-id="explorer-container"]'); b?.click(); });
  await page.waitForTimeout(600);
  await shot('light-files.png');
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`);
  problems.push('the probe stopped');
  await shot('stopped.png').catch(() => {});
} finally {
  await app.close().catch(() => {});
}
console.log(`\n[probe] page errors: ${errors.length}`);
for (const e of errors.slice(0, 8)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length ? 1 : 0;
