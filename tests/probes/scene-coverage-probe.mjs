// scene-coverage-probe.mjs: how much of what is on screen the scene can see.
//
// Walks the app hidden (every built-in, every extension, the canvas, a PDF,
// a scratch sheet, quick open) and sorts each visible interactive element
// (button, field, link, tab, menu item...) into: declared (reachable by id,
// or a surface itself), a row of a declared list (reachable by its text),
// third-party (the spreadsheet engine's own UI), or undeclared. Prints the
// totals and every undeclared one by surface. A report, not a gate: it exits 0.
//
// Usage: node tests/probes/scene-coverage-probe.mjs   (after npm run build)
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { PROJECT_ROOT, launchApp, cmd, setToolEnabled, openFile, tinyPdf } from './scene.mjs';

const SCREENS = [
  ['boot'], ['welcome.openWelcome'], ['explorer.open'], ['search.findInFiles'], ['worksheet.open'], ['planner.open'],
  ['dashboard.open'], ['agents.show'], ['agents.showRoutines'], ['tools.showInstalled'], ['chat.show'], ['workflows.new'],
  ['settings.open'], ['settings.open', 'ai'], ['theme-editor.open'], ['canvas.newPage'], ['planner.newTask'],
  ['workbench.view.show', 'view.terminal'], ['workbench.view.show', 'view.activityLog'], ['workbench.view.show', 'view.output'],
  ['pdf'], ['worksheet.openScratch'], ['workbench.action.quickOpen'],
  ['ext:workspaceGraph.open'], ['ext:budget.openTransactions'], ['ext:flashcards.open'], ['ext:conceptLab.open'],
  ['ext:media-organizer.openGrid'], ['ext:textGenerator.openHome'], ['ext:browser.newTab'], ['ext:study.open'],
];
const EXTS = ['parallx.workspace-graph', 'parallx.budget', 'parallx-community.flashcards', 'parallx.concept-lab', 'parallx-community.media-organizer', 'parallx-community.creations-ai', 'parallx.browser', 'parallx-community.study'];

const measure = () => {
  const sel = 'button, input:not([type=hidden]), select, textarea, a[href], [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=checkbox], [role=switch], [role=option], [role=radio], [role=slider], [role=treeitem], [role=link]';
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]'); };
  const out = { declared: 0, rows: 0, thirdParty: 0, und: [] };
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e) || e.closest('[contenteditable="true"], [aria-hidden="true"]')) continue;
    if (e.hasAttribute('data-px-surface')) { out.declared++; continue; }
    if (typeof e.className === 'string' && /(^|\s)univer-/.test(e.className)) { out.thirdParty++; continue; }
    const d = e.closest('[data-px-id]');
    if (d) { if (d !== e && ['listbox', 'tree', 'tablist', 'list', 'grid'].includes(d.getAttribute('role'))) out.rows++; else out.declared++; continue; }
    const s = e.closest('[data-px-surface]');
    const name = (e.getAttribute('aria-label') || e.title || e.placeholder || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    out.und.push(`${s ? s.dataset.pxSurface : '(window)'} :: ${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''} "${name}"`);
  }
  return out;
};

const stamp = Date.now();
const appRoot = path.join(os.tmpdir(), `parallx-cov-root-${stamp}`);
const ws = path.join(os.tmpdir(), `parallx-cov-ws-${stamp}`);
await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
await fs.mkdir(ws, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* ok */ }
await fs.writeFile(path.join(ws, 'alpha.md'), '# Alpha\n\nA note.\n');
await fs.writeFile(path.join(ws, 'reading.pdf'), tinyPdf());
const { app, page } = await launchApp(appRoot);
let declared = 0, rows = 0, thirdParty = 0;
const und = new Map();
try {
  for (const id of EXTS) await setToolEnabled(page, id, true);
  await page.waitForTimeout(3_000);
  for (const [first, ...args] of SCREENS) {
    await page.keyboard.press('Escape');
    if (first === 'pdf') await openFile(page, 'reading.pdf');
    else if (first !== 'boot') { const r = await cmd(page, first.replace(/^ext:/, ''), ...args); if (r !== true) console.log(`[open] ${first}: ${r}`); }
    await page.waitForTimeout(1_500);
    const m = await page.evaluate(measure);
    declared += m.declared; rows += m.rows; thirdParty += m.thirdParty;
    for (const u of m.und) und.set(u, (und.get(u) ?? 0) + 1);
    console.log(`[screen] ${[first, ...args].join(' ')}: declared=${m.declared} rows=${m.rows} thirdParty=${m.thirdParty} undeclared=${m.und.length}`);
  }
  const bySurface = new Map();
  for (const u of und.keys()) { const s = u.split(' :: ')[0]; bySurface.set(s, [...(bySurface.get(s) ?? []), u.split(' :: ')[1]]); }
  console.log(`\n[total, summed over screens] declared=${declared} rows=${rows} thirdParty=${thirdParty} undeclared distinct=${und.size}`);
  for (const [s, list] of [...bySurface].sort((a, b) => b[1].length - a[1].length)) console.log(`\n## ${s} (${list.length})\n  ${list.slice(0, 40).join('\n  ')}`);
} finally {
  await app.close().catch(() => {});
}
