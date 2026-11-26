// frame-probe.mjs — the window's frame: one column (Home and the tools, what
// is open, the open tool's name and list, two rows pinned at the foot), the
// bell and the panel buttons in the title bar, tabs as wide as their names.
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
  // No focus ring or tooltip left over from the checks above.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur()).catch(() => {});
  await page.mouse.move(700, 500); await page.waitForTimeout(250);
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
    headFont: (() => { const l = document.querySelector('.sidebar-header-label'); return l ? getComputedStyle(l).fontFamily.split(',')[0].replace(/["']/g, '') : ''; })(),
    rows: rows.map((b) => ({ id: b.dataset.iconId, name: b.getAttribute('aria-label'), shown: b.querySelector('.activity-bar-item-name')?.textContent ?? '', nameVisible: !!b.querySelector('.activity-bar-item-name')?.getClientRects().length, selected: b.getAttribute('aria-selected'), tab: b.tabIndex, ...rect(b) })),
    foot: foot.map((b) => ({ name: b.textContent.trim(), tab: b.tabIndex, ...rect(b) })),
    home: (() => { const h = document.querySelector('[data-px-id="column.home"]'); return h ? { name: h.textContent.trim(), ...rect(h) } : null; })(),
    open: (() => { const o = document.querySelector('.sidebar-open'); const l = document.querySelector('[data-px-id="column.open"]'); const rows = [...document.querySelectorAll('.sidebar-open .open-editors-item')]; return o && l ? { ...rect(o), label: l.getAttribute('aria-label'), expanded: l.getAttribute('aria-expanded'), count: l.dataset.count, rows: rows.length, shown: rows.filter((r) => r.getClientRects().length).length, listH: Math.round(document.querySelector('.sidebar-open .open-editors-view')?.getBoundingClientRect().height ?? 0), activeInView: (() => { const a = o.querySelector('.open-editors-item--active'); const v = o.querySelector('.open-editors-view'); if (!a || !v) return null; const ar = a.getBoundingClientRect(), vr = v.getBoundingClientRect(); return ar.top >= vr.top - 1 && ar.bottom <= vr.bottom + 1; })() } : null; })(),
    headBox: (() => { const h = document.querySelector('.sidebar-header'); return h ? rect(h) : null; })(),
    headSize: (() => { const l = document.querySelector('.sidebar-header-label'); return l ? parseFloat(getComputedStyle(l).fontSize) : 0; })(),
    viewsTop: views ? Math.round(views.getBoundingClientRect().top) : null,
    windowH: window.innerHeight,
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
  check('Home is the first row, over the tools', !!f.home && f.home.name === 'Home' && f.home.y < Math.min(...f.rows.map((r) => r.y)) && f.home.h === f.rows[0].h, f.home);
  check('Open is under the tools, with every open editor and its count', !!f.open && f.open.y > Math.max(...f.rows.map((r) => r.y)) && f.open.rows === f.tabs.length && Number(f.open.count) === f.tabs.length && f.open.label === `Open, ${f.tabs.length} editors`, f.open);
  check('Open shows six rows at most and keeps the tab in front in view', !!f.open && f.open.listH <= 6 * 27 + 2 && f.open.activeInView === true, f.open);
  check('the open tool\'s name is under Open, a small label in the interface face', !!f.head && !!f.headBox && f.headBox.y >= f.open.y + f.open.h - 1 && f.headSize <= 13 && !/newsreader/i.test(f.headFont), { head: f.head, box: f.headBox, size: f.headSize, font: f.headFont });
  check('the open tool\'s list is under its name and ends where the foot begins', f.viewsTop >= f.headBox.y + f.headBox.h - 1 && f.activeViewBottom !== null && f.activeViewBottom <= f.footTop + 1 && f.activeViewBottom - f.viewsTop > 120, { top: f.viewsTop, bottom: f.activeViewBottom, foot: f.footTop });
  check('Tools and Extensions and Settings are pinned at the foot of the column', f.foot.map((r) => r.name).join('|') === 'Tools and Extensions|Settings' && f.foot[1].y + f.foot[1].h > f.windowH - 70, f.foot);
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
  // Shift+Tab from the tools is Home; Tab from the tools is Open's label, then its rows.
  await page.keyboard.press('Shift+Tab'); await page.waitForTimeout(100);
  const stopHome = (await frame()).focus;
  check('Shift+Tab from the tools reaches Home, with a ring', stopHome?.id === 'column.home' && !!stopHome?.ring, stopHome);
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  const stopMore = (await frame()).focus;
  await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  const stopOpen = (await frame()).focus;
  check('Tab from the tools reaches Open\'s three dots, then its label', stopMore?.id === 'column.section.open.more' && stopOpen?.id === 'column.open', [stopMore, stopOpen]);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  let o = (await frame()).open;
  check('Enter on the label folds Open: its rows go, its count stays', o.expanded === 'false' && o.shown === 0 && Number(o.count) > 0, o);
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  o = (await frame()).open;
  check('and unfolds it again', o.expanded === 'true' && o.shown > 0, o);
  await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  check('Tab goes on into the open rows', await page.evaluate(() => !!document.activeElement?.classList.contains('open-editors-item')), null);
  // The two pinned rows by keys.
  await page.evaluate(() => document.querySelector('[data-px-id="column.toolsAndExtensions"]')?.focus());
  await page.keyboard.press('Tab'); await page.waitForTimeout(100);
  const stop2 = (await frame()).focus;
  check('Tab from Tools and Extensions reaches Settings, with a ring', stop2?.id === 'column.settings' && !!stop2?.ring, stop2);
  await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  check('Enter on Settings opens Settings', await page.evaluate(() => !!document.querySelector('[data-px-surface="settings"]')), null);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // Home opens the Home tab and leaves the column as it was.
  const was = await frame();
  await page.mouse.click(was.home.x + 30, was.home.y + was.home.h / 2); await page.waitForTimeout(900);
  const atHome = await frame();
  check('pressing Home opens the Home tab', await page.evaluate(() => document.querySelector('.editor-tab-bar .ui-tab--active .ui-tab-label')?.textContent) === 'Home', null);
  check('and the column stays: the same tool is lit, with its list', atHome.head === was.head && atHome.rows.find((r) => r.selected === 'true')?.name === was.rows.find((r) => r.selected === 'true')?.name, { was: was.head, now: atHome.head });

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

  // A tool's row is dragged to another place in its list: the list reorders, and the layout shows no drop zone of its own.
  const toolIds = () => page.evaluate(() => [...document.querySelectorAll('.sidebar-tools .activity-bar-item')].filter((b) => b.getClientRects().length).map((b) => { const r = b.getBoundingClientRect(); return { id: b.dataset.iconId, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  let t = await toolIds();
  const last = t[t.length - 1];
  await page.mouse.move(last.x, last.y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(last.x, last.y + (t[1].y - 6 - last.y) * i / 12); await page.waitForTimeout(40); }
  const clash = await page.evaluate(() => ({ grid: document.querySelector('.workbench-grid').classList.contains('part-dragging'), zones: [...document.querySelectorAll('[class*="part-drop"], [class*="drop-overlay"]')].filter((e) => e.getClientRects().length && getComputedStyle(e).opacity !== '0').length, bar: !!document.querySelector('.activity-bar--drop-target') }));
  await page.mouse.up(); await page.waitForTimeout(700);
  const reordered = await toolIds();
  check('a tool dragged within the list moves to where it was dropped', reordered[1].id === last.id && reordered.length === t.length, reordered.map((x) => x.id));
  check('and nothing else answers that drag (no layout drop zone over the column)', !clash.grid && clash.zones === 0 && !clash.bar, clash);
  await page.mouse.move(reordered[1].x, reordered[1].y); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(last.x, reordered[1].y + (last.y + 10 - reordered[1].y) * i / 12); await page.waitForTimeout(40); }
  await page.mouse.up(); await page.waitForTimeout(700);
  check('dragged back, the list is as it was', (await toolIds()).map((x) => x.id).join() === t.map((x) => x.id).join(), (await toolIds()).map((x) => x.id));

  // The sections of the column: each can be put elsewhere in it, by its grip or its three dots.
  const sections = () => page.evaluate(() => [['tools', '.sidebar-tools'], ['open', '.sidebar-open'], ['view', '.sidebar-header'], ['foot', '.sidebar-foot']].map(([n, sel]) => [n, Math.round(document.querySelector(sel).getBoundingClientRect().top)]).sort((a, b) => a[1] - b[1]).map((x) => x[0]).join(' '));
  check('the sections start in their default places', (await sections()) === 'tools open view foot', await sections());
  const openBox = await page.evaluate(() => { const r = document.querySelector('.sidebar-open').getBoundingClientRect(); return { x: r.x + 60, y: r.y + 14 }; });
  await page.mouse.move(openBox.x, openBox.y); await page.waitForTimeout(400);
  const sGrip = await page.evaluate(() => { const g = document.querySelector('.sidebar-open > .column-section-grip'); const m = document.querySelector('.sidebar-open > .column-section-more'); const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, grip: getComputedStyle(g).pointerEvents, more: getComputedStyle(m).pointerEvents, away: getComputedStyle(document.querySelector('.sidebar-foot > .column-section-more')).pointerEvents, names: [g.getAttribute('aria-label'), m.getAttribute('aria-label')] }; });
  // (They fade in; a hidden window draws no frame to fade on, so what is read is whether they take the pointer.)
  check('pointing at a section brings up its grip and its three dots, each named, and no other section\'s', sGrip.grip === 'auto' && sGrip.more === 'auto' && sGrip.away === 'none' && sGrip.names.every((n) => !!n), sGrip);
  const footBox = await page.evaluate(() => { const r = document.querySelector('.sidebar-foot').getBoundingClientRect(); return { x: r.x + 80, y: r.bottom - 8 }; });
  await page.mouse.move(sGrip.x, sGrip.y); await page.mouse.down();
  for (let i = 1; i <= 16; i++) { await page.mouse.move(sGrip.x + (footBox.x - sGrip.x) * i / 16, sGrip.y + (footBox.y - sGrip.y) * i / 16); await page.waitForTimeout(40); }
  await page.mouse.up(); await page.waitForTimeout(600);
  check('Open dragged by its grip under the two foot rows lands there', (await sections()) === 'tools view foot open', await sections());
  check('the open tool\'s list still has room after the move', await page.evaluate(() => document.querySelector('.sidebar-views').getBoundingClientRect().height > 120), null);
  await page.evaluate(() => document.querySelector('.sidebar-tools > .column-section-more').focus());
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  const menu = await page.evaluate(() => [...document.querySelectorAll('.context-menu .context-menu-item, .context-menu [role="menuitem"]')].map((e) => e.textContent.trim()));
  check('a section\'s three dots, by keys, offer Move Up, Move Down and Restore Default Places', ['Move Up', 'Move Down', 'Restore Default Places'].every((n) => menu.some((m) => m.startsWith(n))), menu);
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  check('Move Down on the tools, by keys, puts them under the next section', (await sections()) === 'view tools foot open', await sections());
  await shot('dark-sections-moved.png');
  await cmd(page, 'workbench.action.resetSidebarSections'); await page.waitForTimeout(400);
  check('Restore Sidebar Sections puts every section back', (await sections()) === 'tools open view foot', await sections());

  // The column is grabbed at its top and moved: dragged to the right edge it lands there, and back again.
  const grab = async (toX) => {
    const g = await page.evaluate(() => { const e = document.querySelector('.sidebar-grip'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: Math.round(r.height), draggable: e.draggable }; });
    await page.mouse.move(g.x, g.y); await page.mouse.down();
    for (let i = 1; i <= 16; i++) { await page.mouse.move(g.x + (toX - g.x) * i / 16, g.y + 200 * i / 16); await page.waitForTimeout(40); }
    await page.waitForTimeout(200); await page.mouse.up(); await page.waitForTimeout(900);
    return g;
  };
  const vw = await page.evaluate(() => window.innerWidth);
  const grip = await grab(vw - 60);
  let moved = (await frame()).sidebar;
  check('the column has a grip at its top', grip.draggable === true && grip.h >= 8, grip);
  check('dragged by its top to the right edge, the column lands on the right', !!moved && moved.x > vw / 2, moved);
  await shot('dark-column-right.png');
  await grab(8);
  moved = (await frame()).sidebar;
  check('and dragged back, it is on the left again', !!moved && moved.x === 0, moved);
  await cmd(page, 'chat.show'); await page.waitForTimeout(1_000);
  await shot('dark-chat.png');
  await cmd(page, 'workbench.action.showCommands'); await page.waitForTimeout(700);
  await shot('dark-palette.png');
  await page.evaluate(() => document.querySelector('[data-px-id="quickAccess.input"]')?.focus());
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await mode('light');
  await page.evaluate(() => document.querySelector('.activity-bar-item[data-icon-id="study-container"]')?.click());
  await page.waitForTimeout(600);
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
