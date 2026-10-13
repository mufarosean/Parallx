// keyboard-audit-probe.mjs: can the app be used from the keyboard alone?
//
// Walks the app hidden and muted (every built-in, every extension, the
// canvas, a PDF, a scratch sheet, quick open). On each screen it clears
// focus and presses Tab, up to MAX_TABS times, as a keyboard-only user
// would, and reports:
//   unreachable  visible interactive elements no key can focus: not in the
//                Tab order, not moved to by the arrow keys from where Tab
//                and F6 went, and not an option an input drives
//   arrows       (named for history) focusable elements the walk did not
//                Tab to: in the Tab order, not verified reached
//   noFocusRing  elements that took focus with no visible change on them
//                or their parent (outline, shadow, border or background)
//   noName       focused elements with no accessible name
//   pointerOnly  elements drawn with a pointer cursor that cannot take
//                focus and sit in nothing that can (mouse-only candidates)
//   trap         Tab stopped moving before the walk ended
// Third-party UI (the spreadsheet engine) is counted apart. A report, not
// a gate: it exits 0. A screen reader itself is not run; this checks what
// one would need.
//
// Usage: node tests/probes/keyboard-audit-probe.mjs [outDir]   (after npm run build)

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { PROJECT_ROOT, launchApp, cmd, setToolEnabled, openFile, tinyPdf } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-keyboard-audit'));
const MAX_TABS = 150; // Tab presses per area
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

// Page side: helpers kept on window.__kb between Tab presses.
function install() {
  const INTERACTIVE = 'button, input:not([type=hidden]), select, textarea, a[href], [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=checkbox], [role=switch], [role=option], [role=radio], [role=slider], [role=treeitem], [role=link], [role=combobox]';
  const COMPOSITE = '[role=listbox], [role=tree], [role=tablist], [role=menu], [role=menubar], [role=radiogroup], [role=grid], [role=toolbar], [role=list]';
  const shown = (e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden], [aria-hidden="true"], [inert]'); };
  const third = (e) => !!e.closest('[class*="univer-"]') || (typeof e.className === 'string' && /(^|\s)univer-/.test(e.className));
  const look = (e) => { if (!e) return ''; const cs = getComputedStyle(e); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.borderBottomColor, cs.backgroundColor, cs.color, cs.textDecorationLine].join('|'); };
  const where = (e) => { const s = e.closest('[data-px-surface]'); return s ? s.getAttribute('data-px-surface') : '(window)'; };
  const name = (e) => {
    const by = e.getAttribute('aria-labelledby');
    const lab = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') : '';
    const forLabel = e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent || '' : '';
    const wrapLabel = e.closest('label')?.textContent || '';
    return (e.getAttribute('aria-label') || lab || forLabel || wrapLabel || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('alt') || (e.tagName === 'INPUT' ? '' : e.textContent) || '').trim().replace(/\s+/g, ' ');
  };
  const describe = (e) => `${where(e)} :: ${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : ''}${e.getAttribute('data-px-id') ? `#${e.getAttribute('data-px-id')}` : (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')} "${name(e).slice(0, 40)}"`;
  window.__kb = {
    seen: new Set(), order: [], prev: null, prevLook: '', prevParentLook: '', noRing: [], noName: [], stuck: 0,
    start() {
      const a = document.activeElement; if (a && a !== document.body) a.blur();
      Object.assign(this, { seen: new Set(), order: [], prev: null, prevLook: '', prevParentLook: '', noRing: [], noName: [], stuck: 0 });
    },
    // After each Tab: settle the previous element's ring, note the new one.
    step() {
      const a = document.activeElement;
      if (this.prev && this.prev !== a && shown(this.prev) && !third(this.prev)) {
        const unchanged = look(this.prev) === this.prevLook && look(this.prev.parentElement) === this.prevParentLook;
        if (unchanged) this.noRing.push(describe(this.prev));
      }
      if (!a || a === document.body || a === document.documentElement) { this.prev = null; return 'body'; }
      if (a === this.prev) { this.stuck++; return this.stuck > 4 ? 'stuck' : 'same'; }
      this.stuck = 0;
      // The look while focused, to compare once focus moves on.
      this.prev = a; this.prevLook = look(a); this.prevParentLook = look(a.parentElement);
      if (this.seen.has(a)) return 'cycle';
      this.seen.add(a); this.order.push(a);
      if (!third(a) && !name(a)) this.noName.push(describe(a));
      return 'new';
    },
    // The lists, tab strips and menus Tab entered, for the arrow-key pass.
    composites() {
      const set = new Set();
      for (const s of this.seen) { const c = s.closest(COMPOSITE); if (c && shown(c)) set.add(c); }
      this.comps = Array.from(set);
      return this.comps.length;
    },
    // Focus the member Tab reached inside composite i, to arrow from there.
    enter(i) {
      const c = this.comps[i];
      const m = c && Array.from(this.seen).find((s) => c.contains(s) && shown(s));
      if (!m) return false;
      m.focus();
      this.prev = m; this.prevLook = look(m); this.prevParentLook = look(m.parentElement); this.stuck = 0;
      return true;
    },
    // The ring test needs the unfocused look: blur the last one and compare.
    finish() {
      const a = this.prev;
      if (a && shown(a) && !third(a)) {
        const focusedLook = this.prevLook, parentLook = this.prevParentLook;
        a.blur();
        if (look(a) === focusedLook && look(a.parentElement) === parentLook) this.noRing.push(describe(a));
      }
      // The ring was taken while focused and compared with the look after
      // focus left; a ring that stays (a selected tab) reads as no change,
      // so a focused element whose look matches its unfocused look is the
      // finding, not one that merely looks like its neighbours.
      const all = Array.from(document.querySelectorAll(INTERACTIVE)).filter((e) => shown(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[contenteditable="true"]'));
      const reached = (e) => this.seen.has(e) || Array.from(this.seen).some((s) => s.contains(e) || e.contains(s));
      // Not reached is two different things: an element no key can focus
      // (tabindex -1, not moved to by arrows, not an option an input drives)
      // is a failure; a focusable one the walk did not Tab to is unverified.
      const unreachable = [], arrows = [], thirdParty = [];
      const drivenByInput = (e) => { const lb = e.closest('[role=listbox]'); return !!lb && (lb.hasAttribute('aria-activedescendant') || !!document.querySelector(`[aria-controls="${CSS.escape(lb.id || '-')}"]`) || !!lb.parentElement?.querySelector('input')); };
      for (const e of all) {
        if (reached(e)) continue;
        if (third(e)) { thirdParty.push(describe(e)); continue; }
        if (e.getAttribute('role') === 'option' && drivenByInput(e)) continue; // a list an input drives with the arrow keys
        if (e.tabIndex >= 0) arrows.push(describe(e)); else unreachable.push(describe(e));
      }
      // Mouse-only candidates: a pointer cursor, not focusable, inside nothing focusable.
      const pointerOnly = [];
      const focusable = (e) => e.tabIndex >= 0 || e.matches('button, input, select, textarea, a[href], [contenteditable="true"]');
      for (const e of document.querySelectorAll('body *')) {
        if (!shown(e) || third(e) || e.closest('[contenteditable="true"]')) continue;
        if (getComputedStyle(e).cursor !== 'pointer') continue;
        if (e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer') continue; // report the outermost only
        let p = e, ok = false;
        while (p && p !== document.body) { if (focusable(p)) { ok = true; break; } p = p.parentElement; }
        if (!ok && !e.querySelector('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')) pointerOnly.push(describe(e));
      }
      return { reached: this.seen.size, interactive: all.length, unreachable, arrows, thirdParty, noRing: [...new Set(this.noRing)], noName: [...new Set(this.noName)], pointerOnly };
    },
  };
}

const stamp = Date.now();
const appRoot = path.join(os.tmpdir(), `parallx-kb-root-${stamp}`);
const ws = path.join(os.tmpdir(), `parallx-kb-ws-${stamp}`);
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
await fs.mkdir(ws, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* ok */ }
await fs.writeFile(path.join(ws, 'alpha.md'), '# Alpha\n\nA note.\n');
await fs.writeFile(path.join(ws, 'reading.pdf'), tinyPdf());
const { app, page } = await launchApp(appRoot);
const report = [];
try {
  for (const id of EXTS) await setToolEnabled(page, id, true);
  await page.waitForTimeout(3_000);
  for (const [first, ...args] of SCREENS) {
    const label = [first, ...args].join(' ');
    await page.keyboard.press('Escape');
    if (first === 'pdf') await openFile(page, 'reading.pdf');
    else if (first !== 'boot') { const r = await cmd(page, first.replace(/^ext:/, ''), ...args); if (r !== true) console.log(`[open] ${label}: ${r}`); }
    await page.waitForTimeout(1_500);
    await page.evaluate(install);
    await page.evaluate(() => window.__kb.start());
    // A keyboard user's walk: F6 into each area of the window (the parts
    // cycle like VS Code's), Tab through it until nothing new comes, then
    // the arrow keys inside every list, tab strip and menu that Tab entered.
    let trap = null, steps = 0;
    const key = async (k) => { await page.keyboard.press(k); steps++; return page.evaluate(() => window.__kb.step()); };
    const trapAt = () => page.evaluate(() => { const a = document.activeElement; const s = a?.closest('[data-px-surface]'); return `${s ? s.getAttribute('data-px-surface') : '(window)'} :: ${a?.tagName.toLowerCase()} "${(a?.getAttribute('aria-label') || a?.textContent || '').trim().slice(0, 40)}"`; });
    for (let part = 0; part < 9 && !trap; part++) {
      await key('F6');
      let stale = 0;
      for (let i = 0; i < MAX_TABS && stale < 6; i++) {
        const r = await key('Tab');
        if (r === 'stuck') { trap = await trapAt(); break; }
        stale = r === 'new' ? 0 : stale + 1;
      }
    }
    const comps = await page.evaluate(() => window.__kb.composites());
    for (let c = 0; c < comps; c++) {
      for (const dir of ['ArrowRight', 'ArrowDown']) {
        if (!(await page.evaluate((i) => window.__kb.enter(i), c))) break;
        let stale = 0;
        for (let i = 0; i < 40 && stale < 3; i++) stale = (await key(dir)) === 'new' ? 0 : stale + 1;
        await page.keyboard.press('Escape');
      }
    }
    const res = await page.evaluate(() => window.__kb.finish());
    report.push({ screen: label, steps, trap, ...res });
    console.log(`[screen] ${label}: tabs=${steps} reached=${res.reached} interactive=${res.interactive} unreachable=${res.unreachable.length} arrows=${res.arrows.length} noFocusRing=${res.noRing.length} noName=${res.noName.length} pointerOnly=${res.pointerOnly.length} thirdParty=${res.thirdParty.length}${trap ? ` TRAP at ${trap}` : ''}${steps >= MAX_TABS ? ' (walk hit the Tab limit)' : ''}`);
  }
} finally {
  await app.close().catch(() => {});
}

// Distinct findings across screens, by kind and surface.
const kinds = ['unreachable', 'arrows', 'noRing', 'noName', 'pointerOnly'];
const totals = {};
for (const k of kinds) {
  const set = new Set(report.flatMap((r) => r[k]));
  totals[k] = set.size;
  const bySurface = new Map();
  for (const d of set) { const s = d.split(' :: ')[0]; bySurface.set(s, [...(bySurface.get(s) ?? []), d.split(' :: ')[1]]); }
  console.log(`\n# ${k} (${set.size} distinct)`);
  for (const [s, list] of [...bySurface].sort((a, b) => b[1].length - a[1].length)) console.log(`## ${s} (${list.length})\n  ${list.slice(0, 25).join('\n  ')}${list.length > 25 ? `\n  …and ${list.length - 25} more` : ''}`);
}
const traps = report.filter((r) => r.trap).map((r) => `${r.screen}: ${r.trap}`);
console.log(`\n# traps (${traps.length})\n  ${traps.join('\n  ')}`);
console.log(`\n[totals] ${JSON.stringify(totals)} traps=${traps.length}`);
await fs.writeFile(path.join(outDir, 'keyboard-audit.json'), JSON.stringify(report, null, 2));
