// keyboard-audit-probe.mjs: can the app be used from the keyboard alone, and
// does a screen reader get what it needs?
//
// Runs the app hidden and muted. For every screen (each built-in, each
// extension, and the sub-screens their own navigation opens), it:
//   1. Tab pass: from the top of the window, one unbroken run of Tab until
//      focus comes back round. With a dialog open, only the dialog counts.
//   2. F6 pass: which of the window's visible areas F6 reaches.
//   3. Arrow pass: inside every list, tab strip, tree, menu bar, toolbar and
//      radio group, the arrow keys (and Alt for the menu bar) from the
//      member Tab reached, or from the field that drives the list.
//   4. Reads the accessibility tree (what a screen reader reads) for
//      interactive nodes with no name.
// It reports, per screen and as distinct totals:
//   notFocusable  interactive elements no key reaches (out of the Tab order
//                 and not reached by the arrow keys)
//   tabHole       focusable elements the unbroken Tab run never reached
//   f6Missing     visible areas F6 does not reach
//   noFocusRing   elements that took focus with no visible change
//   noName        interactive accessibility nodes with no name
//   mouseOnly     elements with a click handler (on them or just above)
//                 that no key can reach
//   trap          Tab stuck on one element
// Then a dialog pass: each kind of dialog opened from the keyboard, checked
// for focus moving in, staying in, Escape closing it and focus coming back.
// Third-party UI (the spreadsheet engine) is counted apart. A report, not a
// gate: it exits 0.
//
// Usage: node tests/probes/keyboard-audit-probe.mjs [outDir]   (after npm run build)

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { PROJECT_ROOT, launchApp, cmd, cmdNoWait, setToolEnabled, openFile, tinyPdf, sceneOf, flatten } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-keyboard-audit'));
const only = process.argv.slice(3);

const SCREENS = [
  ['boot'], ['welcome.openWelcome'], ['explorer.open'], ['search.findInFiles'], ['worksheet.open'], ['planner.open'],
  ['dashboard.open'], ['agents.show'], ['agents.showRoutines'], ['tools.showInstalled'], ['chat.show'], ['workflows.new'],
  ['settings.open'], ['settings.open', 'ai'], ['theme-editor.open'], ['canvas.newPage'], ['planner.newTask'],
  ['workbench.view.show', 'view.terminal'], ['workbench.view.show', 'view.activityLog'], ['workbench.view.show', 'view.output'],
  ['workbench.view.show', 'view.indexingLog'], ['workbench.view.show', 'view.diagnostics'],
  ['pdf'], ['worksheet.openScratch'], ['workbench.action.quickOpen'], ['workbench.action.showCommands'],
  ['ext:workspaceGraph.open'], ['ext:budget.openTransactions'], ['ext:flashcards.open'], ['ext:conceptLab.open'],
  ['ext:media-organizer.openGrid'], ['ext:textGenerator.openHome'], ['ext:browser.newTab'], ['ext:study.open'],
];
const EXTS = ['parallx.workspace-graph', 'parallx.budget', 'parallx-community.flashcards', 'parallx.concept-lab', 'parallx-community.media-organizer', 'parallx-community.creations-ai', 'parallx.browser', 'parallx-community.study'];
// A sub-screen is what a tool's own navigation opens: its sidebar's and its
// tab strip's entries. Followed one level down from each screen.
const NAV = /\.(side|nav|tab|tabs)\.[\w-]+$/;

// ── Page side ───────────────────────────────────────────────────────────────
function install() {
  const INTERACTIVE = 'button, input:not([type=hidden]), select, textarea, a[href], [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=checkbox], [role=switch], [role=option], [role=radio], [role=slider], [role=gridcell], [role=treeitem], [role=link], [role=combobox], [role=spinbutton], [role=searchbox], [role=textbox]';
  const COMPOSITE = '[role=listbox], [role=tree], [role=tablist], [role=menu], [role=menubar], [role=radiogroup], [role=grid], [role=toolbar]';
  const shown = (e) => { if (!e || !e.isConnected) return false; const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden], [aria-hidden="true"], [inert]'); };
  const third = (e) => !!e.closest('[class*="univer-"]');
  const settle = () => { for (const a of document.getAnimations()) { try { if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish(); } catch { /* infinite or detached */ } } };
  const look = (e) => { if (!e) return ''; settle(); const cs = getComputedStyle(e); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.borderBottomColor, cs.borderLeftColor, cs.backgroundColor, cs.color, cs.textDecorationLine, ...[...Array.from(e.children).slice(0, 3), e.querySelector('[aria-selected="true"], [class*="--selected"]')].filter(Boolean).map((c) => { const k = getComputedStyle(c); return k.outlineStyle + k.boxShadow + k.borderTopColor; })].join('|'); };
  const around = (e) => [e?.parentElement, e?.parentElement?.parentElement, e?.parentElement?.parentElement?.parentElement].map(look).join('#');
  const where = (e) => { const s = e.closest('[data-px-surface]'); return s ? s.getAttribute('data-px-surface') : '(window)'; };
  const label = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || (e.tagName === 'INPUT' ? '' : e.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const describe = (e) => `${where(e)} :: ${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : ''}${e.getAttribute('data-px-id') ? `#${e.getAttribute('data-px-id')}` : (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')} "${label(e)}"`;
  // With a dialog open, only the dialog is the screen.
  const scope = () => Array.from(document.querySelectorAll('[aria-modal="true"], [role="dialog"], [role="alertdialog"]')).filter(shown).pop() || document.body;
  window.__kb = {
    interactive() { return Array.from(this.scope.querySelectorAll(INTERACTIVE)).filter((e) => shown(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[contenteditable="true"]') && e.id !== '__kb_start'); },
    // The screen as the Tab run left it: the arrow pass after it may change
    // a setting (a segmented switch), and a re-render then replaces every control.
    tabEnd() { this.atTabEnd = this.interactive(); this.pointerAtTabEnd = this.pointerCandidates(); },
    // A radio group's checked option (arrows select as they move), to put back after.
    checkedOf(i) { const c = this.comps[i]; if (c?.getAttribute('role') !== 'radiogroup') return null; return c.querySelector('[aria-checked="true"], [aria-pressed="true"]')?.getAttribute('data-px-id') ?? null; },
    // Mouse-only candidates: a pointer cursor, unreached, inside nothing reached.
    pointerCandidates() {
      const reached = (e) => this.seen.has(e) || Array.from(this.seen).some((s) => s.contains(e) || e.contains(s));
      const out = [];
      for (const e of this.scope.querySelectorAll('*')) {
        if (!shown(e) || third(e) || e.closest('[contenteditable="true"]') || e.id === '__kb_start') continue;
        if (getComputedStyle(e).cursor !== 'pointer') continue;
        if (e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer') continue;
        if (reached(e) || e.matches(INTERACTIVE) || e.closest(INTERACTIVE)) continue;
        if (Array.from(this.seen).some((s) => e.contains(s))) continue;
        out.push(e);
      }
      return out;
    },
    // Tab stops on this screen, to size the Tab run.
    stops() { return Array.from(this.scope.querySelectorAll('*')).filter((e) => e.tabIndex >= 0 && shown(e) && !e.disabled).length; },
    start() {
      Object.assign(this, { atTabEnd: null, pointerAtTabEnd: null, first: null, seen: new Set(), prev: null, prevLook: '', prevParentLook: '', noRing: [], stuck: 0, wrapped: false, scope: scope() });
      let a = document.getElementById('__kb_start');
      if (!a) { a = document.createElement('div'); a.id = '__kb_start'; a.tabIndex = -1; a.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;outline:none'; }
      this.scope.prepend(a);
      a.focus();
    },
    step() {
      const a = document.activeElement;
      if (this.prev && this.prev !== a && shown(this.prev) && !third(this.prev)) {
        if (look(this.prev) === this.prevLook && around(this.prev) === this.prevParentLook) this.noRing.push(describe(this.prev));
      }
      if (!a || a === document.body || a === document.documentElement || a.id === '__kb_start') { this.prev = null; this.wrapped = true; return 'wrap'; }
      if (a === this.prev) { this.stuck++; return this.stuck > 4 ? 'stuck' : 'same'; }
      this.stuck = 0;
      this.prev = a; this.prevLook = look(a); this.prevParentLook = around(a);
      // Focus on something drawn see-through (actions shown only on hover): no visible focus at all.
      let alpha = 1;
      for (let p = a; p && p !== document.body; p = p.parentElement) alpha *= parseFloat(getComputedStyle(p).opacity);
      if (alpha < 0.15 && !third(a)) this.noRing.push(`${describe(a)} (invisible while focused)`);
      if (this.seen.has(a)) return a === this.first ? 'cycled' : 'seen';
      if (!this.first) this.first = a;
      this.seen.add(a);
      return 'new';
    },
    // The composites to arrow through: the member Tab reached, or the field driving a list.
    composites() {
      this.comps = Array.from(this.scope.querySelectorAll(COMPOSITE)).filter((c) => shown(c) && !third(c));
      return this.comps.length;
    },
    enter(i) {
      const c = this.comps[i];
      if (!c) return false;
      const m = Array.from(this.seen).find((s) => c.contains(s) && shown(s))
        || (c.tabIndex >= 0 && this.seen.has(c) ? c : null)
        || (c.id && document.querySelector(`[aria-controls="${CSS.escape(c.id)}"]`))
        || c.parentElement?.querySelector('input');
      if (!m || !shown(m)) return false;
      m.focus();
      this.prev = m; this.prevLook = look(m); this.prevParentLook = around(m); this.stuck = 0;
      this.driver = m.tagName === 'INPUT' || m === c ? c : null;
      return true;
    },
    // A list a field drives marks its current option without moving focus.
    activeOption() {
      const c = this.driver; if (!c) return false;
      const id = c.getAttribute('aria-activedescendant') || document.activeElement?.getAttribute('aria-activedescendant');
      const o = id ? document.getElementById(id) : c.querySelector('[aria-selected="true"], [class*="active"], [class*="focused"]');
      if (!o || this.seen.has(o)) return false;
      this.seen.add(o);
      return true;
    },
    // Text against what it sits on (WCAG AA: 4.5:1, or 3:1 for large text).
    contrast() {
      settle();
      const rgb = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ground = (e) => { for (let p = e; p; p = p.parentElement) { const c = rgb(getComputedStyle(p).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 30, g: 30, b: 30, a: 1 }; };
      const out = [];
      for (const e of this.scope.querySelectorAll('*')) {
        if (!shown(e) || third(e) || e.closest('[aria-disabled="true"], :disabled, #__kb_start') || e.id === '__probe_repaint') continue;
        // Text the eye reads: a text node, or a typed field's value (a
        // switch's or slider's value is not drawn). pdf.js's text layer is
        // transparent on purpose: the page is drawn on a canvas under it.
        const typed = e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && /^(text|search|number|email|url|password|tel|)$/.test(e.type) && e.value);
        const own = Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1) || typed;
        if (!own || e.closest('.textLayer')) continue;
        const cs = getComputedStyle(e);
        if (parseFloat(cs.opacity) === 0) continue;
        const bg = ground(e); const fg0 = rgb(cs.color); if (!fg0 || fg0.a < 0.1) continue;
        const fg = { r: fg0.r * fg0.a + bg.r * (1 - fg0.a), g: fg0.g * fg0.a + bg.g * (1 - fg0.a), b: fg0.b * fg0.a + bg.b * (1 - fg0.a) };
        const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
        const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
        if (ratio < need) out.push(`${describe(e)} ${ratio.toFixed(2)}:1 (needs ${need})`);
      }
      return out;
    },
    finish() {
      if (this.prev && shown(this.prev) && !third(this.prev)) {
        const fl = this.prevLook, pl = this.prevParentLook, p = this.prev;
        p.blur();
        if (look(p) === fl && around(p) === pl) this.noRing.push(describe(p));
      }
      document.getElementById('__kb_start')?.remove();
      const all = this.atTabEnd ?? this.interactive();
      const reached = (e) => this.seen.has(e) || Array.from(this.seen).some((s) => s.contains(e) || e.contains(s));
      const notFocusable = [], tabHole = [], thirdParty = [];
      for (const e of all) {
        if (reached(e)) continue;
        if (third(e)) { thirdParty.push(describe(e)); continue; }
        (e.tabIndex >= 0 ? tabHole : notFocusable).push(describe(e));
      }
      // Taken as the Tab run left the screen; what the arrow pass reached since is not mouse-only.
      this.pointerCands = (this.pointerAtTabEnd ?? this.pointerCandidates()).filter((e) => !reached(e));
      return { reached: this.seen.size, interactive: all.length, notFocusable, tabHole, thirdParty, noRing: [...new Set(this.noRing)], pointerCount: this.pointerCands.length, describePointer: this.pointerCands.map(describe) };
    },
  };
}

// ── The run ─────────────────────────────────────────────────────────────────
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
const cdp = await page.context().newCDPSession(page).catch(() => null);
const report = [];
let dialogs = [];

/** Interactive accessibility nodes with no name, as a screen reader meets them. */
async function namelessNodes() {
  if (!cdp) return ['(accessibility tree unavailable)'];
  const ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'combobox', 'slider', 'radio', 'treeitem', 'spinbutton', 'listbox', 'tree', 'tablist', 'menu', 'menubar']);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const out = [];
  for (const n of nodes) {
    if (n.ignored || !ROLES.has(n.role?.value)) continue;
    if ((n.name?.value || '').trim()) continue;
    if (!n.backendDOMNodeId) continue;
    const desc = await cdp.send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId }).then(({ object }) => cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId, returnByValue: true,
      functionDeclaration: 'function () { if (!this.getClientRects || !this.getClientRects().length || this.closest("[class*=univer-], [aria-hidden=true], [hidden]")) return null; const s = this.closest("[data-px-surface]"); return `${s ? s.getAttribute("data-px-surface") : "(window)"} :: ${this.tagName.toLowerCase()}${this.getAttribute("data-px-id") ? "#" + this.getAttribute("data-px-id") : (typeof this.className === "string" && this.className ? "." + this.className.split(" ")[0] : "")}`; }',
    })).then((r) => r.result.value).catch(() => null);
    if (desc) out.push(`${desc} [${n.role.value}]`);
  }
  return out;
}

/** Of the pointer-cursor candidates, those with a click handler on them or up to three levels above. */
async function mouseOnly(count) {
  if (!cdp || !count) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__kb.pointerCands[${i}]` });
    if (!result.objectId) continue;
    let obj = result.objectId, found = false;
    for (let up = 0; up < 4 && obj && !found; up++) {
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: obj }).catch(() => ({ listeners: [] }));
      if (listeners.some((l) => /^(click|mousedown|mouseup|pointerdown|pointerup|dblclick)$/.test(l.type))) found = true;
      else { const p = await cdp.send('Runtime.callFunctionOn', { objectId: obj, functionDeclaration: 'function () { return this.parentElement; }' }); obj = p.result.objectId; }
    }
    if (found) out.push((await page.evaluate((j) => window.__kb.describePointerOne?.(j) ?? null, i)) ?? i);
  }
  return out;
}

async function auditScreen(label) {
  await page.evaluate(install);
  await page.evaluate(() => window.__kb.start());
  const limit = 2 * (await page.evaluate(() => window.__kb.stops())) + 20;
  let trap = null, tabs = 0, wrapped = false, repeats = 0;
  // 1. One unbroken Tab run, until focus comes round to what it already met.
  for (; tabs < limit; tabs++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => window.__kb.step());
    if (r === 'stuck') { trap = await page.evaluate(() => { const a = document.activeElement; const s = a?.closest('[data-px-surface]'); return `${s ? s.getAttribute('data-px-surface') : '(window)'} :: ${a?.tagName.toLowerCase()} "${(a?.getAttribute('aria-label') || a?.textContent || '').trim().slice(0, 40)}"`; }); break; }
    // Done when the order has come round: after a wrap to the top, the first element met again; a
    // dialog keeps Tab inside, so 40 repeats in a row with no wrap also ends it.
    if (r === 'wrap') wrapped = true;
    repeats = r === 'seen' ? repeats + 1 : 0;
    if (r === 'cycled' || (r === 'seen' && wrapped) || repeats >= 40) break;
  }
  await page.evaluate(() => window.__kb.tabEnd());
  // 2. F6: which visible areas it reaches (not inside a dialog).
  const f6 = await page.evaluate(() => {
    if (window.__kb.scope !== document.body) return null;
    return Array.from(document.querySelectorAll('[data-part-id]')).filter((p) => { const r = p.getBoundingClientRect(); return r.width > 8 && r.height > 8 && getComputedStyle(p).display !== 'none' && !p.closest('[hidden]'); }).map((p) => p.getAttribute('data-part-id'));
  });
  const f6Reached = new Set();
  if (f6) {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('F6');
      const part = await page.evaluate(() => { window.__kb.step(); return document.activeElement?.closest('[data-part-id]')?.getAttribute('data-part-id') || null; });
      if (part) f6Reached.add(part);
    }
  }
  const f6Missing = f6 ? f6.filter((p) => !f6Reached.has(p) && p !== 'workbench.parts.titlebar') : [];
  // The menu bar answers Alt, not F6.
  if (f6) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Alt');
    await page.evaluate(() => window.__kb.step());
    for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowRight'); await page.evaluate(() => window.__kb.step()); }
    await page.keyboard.press('Escape');
  }
  // 3. The arrow keys inside each composite.
  const comps = await page.evaluate(() => window.__kb.composites());
  for (let c = 0; c < comps; c++) {
    const checked = await page.evaluate((i) => window.__kb.checkedOf(i), c);
    for (const dir of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'End', 'Home']) {
      if (!(await page.evaluate((i) => window.__kb.enter(i), c))) break;
      let stale = 0;
      for (let i = 0; i < 300 && stale < 3; i++) {
        await page.keyboard.press(dir);
        const r = await page.evaluate(() => { const moved = window.__kb.activeOption(); const s = window.__kb.step(); return moved ? 'new' : s; });
        stale = r === 'new' ? 0 : stale + 1;
      }
      // Close only what the arrows opened (a dropdown's list, a menu); an
      // Escape otherwise moves focus out of the area being walked.
      if (await page.evaluate(() => Array.from(document.querySelectorAll('.ui-dropdown__list, [data-px-surface="contextMenu"]')).some((e) => e.getClientRects().length))) await page.keyboard.press('Escape');
    }
    // Arrowing a radio group chose its last option (a setting, say text size): choose back.
    if (checked) await page.evaluate((id) => Array.from(document.querySelectorAll(`[data-px-id="${id}"]`)).find((e) => e.getClientRects().length)?.click(), checked);
  }
  await page.evaluate(() => document.activeElement?.blur());
  const lowContrast = await page.evaluate(() => window.__kb.contrast());
  const res = await page.evaluate(() => {
    const r = window.__kb.finish();
    window.__kb.describePointerOne = (j) => r.describePointer[j];
    return r;
  });
  const noName = await namelessNodes();
  const mouse = await mouseOnly(res.pointerCount);
  const row = { screen: label, tabs, trap, incomplete: tabs >= limit, f6Missing, notFocusable: res.notFocusable, tabHole: res.tabHole, noRing: res.noRing, noName, mouseOnly: mouse, lowContrast, lowContrastLight: [], thirdParty: res.thirdParty.length, reached: res.reached, interactive: res.interactive };
  report.push(row);
  console.log(`[screen] ${label}: tabs=${tabs} reached=${res.reached}/${res.interactive} notFocusable=${res.notFocusable.length} tabHole=${res.tabHole.length} f6Missing=${f6Missing.length} noFocusRing=${res.noRing.length} noName=${noName.length} mouseOnly=${mouse.length} lowContrast=${lowContrast.length} thirdParty=${res.thirdParty.length}${trap ? ` TRAP at ${trap}` : ''}${tabs >= limit ? ' INCOMPLETE (Tab never came round)' : ''}`);
}

/** Light mode: the same screens, text contrast only. */
async function auditLight() {
  // Light mode as a person turns it on: Appearance's Light.
  const mode = async (m) => { await cmd(page, 'settings.openAppearance'); await page.waitForTimeout(800); await page.evaluate((m) => Array.from(document.querySelectorAll(`[data-px-id="appearance.mode.${m}"]`)).find((e) => e.getClientRects().length)?.click(), m); await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(300); };
  await mode('light');
  for (const [first, ...args] of SCREENS) {
    const label = [first, ...args].join(' ');
    await open(first, args);
    await page.waitForTimeout(1_200);
    await page.evaluate(install);
    await page.evaluate(() => { window.__kb.start(); document.getElementById('__kb_start')?.remove(); });
    const low = await page.evaluate(() => window.__kb.contrast());
    report.push({ screen: `${label} (light)`, tabs: 0, trap: null, f6Missing: [], notFocusable: [], tabHole: [], noRing: [], noName: [], mouseOnly: [], lowContrast: [], lowContrastLight: low });
    console.log(`[light] ${label}: lowContrast=${low.length}`);
  }
  await mode('dark');
}

async function open(first, args) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  if (first === 'pdf') return openFile(page, 'reading.pdf');
  if (first === 'boot') return;
  const r = await cmd(page, first.replace(/^ext:/, ''), ...args);
  if (r !== true) console.log(`[open] ${first}: ${r}`);
}

// ── Dialogs ─────────────────────────────────────────────────────────────────
// Each kind of dialog, opened with focus on a known control: does focus move
// in, does a modal keep Tab inside, does Escape close it, and does focus come
// back to where it was?
const canvasPageId = () => page.evaluate(() => {
  const s = Array.from(document.querySelectorAll('[data-px-surface="canvas"]')).find((e) => e.getClientRects().length);
  return s ? (s.getAttribute('data-px-instance') || '').split(':').pop() : null;
});
const focusId = (id, inner) => page.evaluate(({ id, inner }) => {
  const e = Array.from(document.querySelectorAll(`[data-px-id="${CSS.escape(id)}"]`)).find((x) => x.getClientRects().length);
  const t = inner ? e?.querySelector(inner) : e;
  t?.focus();
  return !!t && document.activeElement === t;
}, { id, inner });
const DIALOGS = [
  { name: 'command palette', opener: ['activitybar.explorer-container'], open: { key: 'Control+Shift+P' }, root: '[data-px-surface="quickAccess"]', modal: true },
  { name: 'quick open', opener: ['activitybar.explorer-container'], open: { key: 'Control+P' }, root: '[data-px-surface="quickAccess"]', modal: true },
  { name: 'context menu (gear)', opener: ['activitybar.manage'], open: { key: 'Enter' }, root: '[data-px-surface="contextMenu"]', modal: false },
  { name: 'dropdown', setup: ['workflows.new'], opener: ['workflows.editor.class', 'button'], open: { key: 'Enter' }, root: '.ui-dropdown__list', modal: false },
  { name: 'settings', opener: ['activitybar.explorer-container'], open: { cmd: ['settings.open'] }, root: '[data-px-surface="settings"]', modal: true },
  { name: 'confirm', opener: ['activitybar.explorer-container'], open: { cmd: ['workspace.resetConfig'] }, root: '[data-px-surface="confirm"]', modal: true },
  { name: 'input box', setup: ['canvas.newPage'], opener: ['canvas.page.menu'], open: { cmd: ['canvas.renamePage', '$page'] }, root: '[data-px-surface="inputBox"]', modal: true },
  { name: 'prompt toast', setup: ['canvas.newPage'], opener: ['canvas.page.menu'], open: { cmd: ['canvas.deletePage', '$page'] }, root: '[data-px-surface="notification"]', modal: false },
];
async function auditDialogs() {
  const out = [];
  for (const d of DIALOGS) {
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    for (const c of d.setup ?? []) { await cmd(page, c); await page.waitForTimeout(1_200); }
    const focused = await focusId(...d.opener);
    if (!focused) { out.push({ name: d.name, problem: `could not focus the opener ${d.opener.join(' ')}` }); continue; }
    if (d.open.key) await page.keyboard.press(d.open.key);
    else { const args = []; for (const a of d.open.cmd.slice(1)) args.push(a === '$page' ? await canvasPageId() : a); await cmdNoWait(page, d.open.cmd[0], ...args); }
    await page.waitForTimeout(700);
    const state = () => page.evaluate(({ root, opener }) => {
      const r = Array.from(document.querySelectorAll(root)).filter((e) => e.getClientRects().length).pop();
      const a = document.activeElement;
      const op = Array.from(document.querySelectorAll(`[data-px-id="${CSS.escape(opener[0])}"]`)).find((x) => x.getClientRects().length);
      const opEl = opener[1] ? op?.querySelector(opener[1]) : op;
      // What a screen reader is told about the dialog: its role, whether it
      // is modal, and for a message whether it is announced (a live region).
      const live = r && (r.closest('[aria-live], [role=status], [role=alert]') || r.querySelector('[aria-live], [role=status], [role=alert]'));
      const box = r && (r.closest('[role=dialog], [role=alertdialog]') || r);
      const sr = r ? { role: box.getAttribute('role') || r.querySelector('[role=dialog], [role=alertdialog], [role=menu], [role=listbox]')?.getAttribute('role') || 'none', modal: box.getAttribute('aria-modal') || r.querySelector('[aria-modal]')?.getAttribute('aria-modal') || 'no', announced: !!live } : null;
      // A combobox keeps focus on its field or button and names the list it drives.
      const drives = !!r && !!a && !!r.id && a.getAttribute('aria-controls') === r.id;
      return { sr, open: !!r, inside: !!r && (r === a || r.contains(a) || drives), atOpener: !!opEl && a === opEl, active: `${a?.tagName.toLowerCase()}${a?.getAttribute('data-px-id') ? '#' + a.getAttribute('data-px-id') : ''} "${(a?.getAttribute('aria-label') || a?.textContent || '').trim().slice(0, 30)}"` };
    }, { root: d.root, opener: d.opener });
    const s1 = await state();
    const row = { name: d.name, opened: s1.open, focusMovedIn: s1.inside, focusOnOpen: s1.active, screenReader: s1.sr };
    if (s1.open && d.modal) {
      let stayed = true;
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if (!(await state()).inside) { stayed = false; break; } }
      row.tabStaysInside = stayed;
    }
    if (s1.open && !s1.inside) {
      // Not focused on open: can Tab reach it?
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) { await page.keyboard.press('Tab'); reached = (await state()).inside; }
      row.reachableByTab = reached;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const s2 = await state();
    row.escapeCloses = !s2.open;
    row.focusReturned = s2.atOpener;
    row.focusAfterClose = s2.active;
    out.push(row);
    console.log(`[dialog] ${JSON.stringify(row)}`);
  }
  return out;
}

/** The ids of the navigation entries visible now (sidebar items and tab strips of tools). */
async function navIds() {
  // The scene's own `visible` reads document.hidden, which a hidden window
  // always reports; the page's layout says what is on screen.
  const ids = flatten(await sceneOf(page)).filter((n) => NAV.test(n.id) && n.kind !== 'surface').map((n) => n.id);
  return page.evaluate((ids) => [...new Set(ids)].filter((id) => Array.from(document.querySelectorAll(`[data-px-id="${CSS.escape(id)}"]`)).some((e) => e.getClientRects().length && !e.closest('[hidden], [aria-hidden="true"]'))), ids);
}

try {
  for (const id of EXTS) await setToolEnabled(page, id, true);
  await page.waitForTimeout(3_000);
  const done = new Set();
  for (const [first, ...args] of SCREENS) {
    const label = [first, ...args].join(' ');
    if (only.length && !only.some((o) => label.includes(o))) continue;
    console.log(`[open] ${label}`);
    await open(first, args);
    await page.waitForTimeout(1_500);
    await auditScreen(label);
    // One level down: each navigation entry this screen shows.
    for (const id of await navIds()) {
      if (done.has(id)) continue;
      done.add(id);
      await open(first, args);
      await page.waitForTimeout(800);
      const ok = await page.evaluate((id) => { const els = Array.from(document.querySelectorAll(`[data-px-id="${CSS.escape(id)}"]`)); const e = els.find((x) => x.getClientRects().length); if (!e) return false; e.click(); return true; }, id);
      if (!ok) continue;
      console.log(`[open] ${label} > ${id}`);
      await page.waitForTimeout(1_000);
      await auditScreen(`${label} > ${id}`);
    }
  }
  if (!only.length || only.includes('dialogs')) dialogs = await auditDialogs();
  if (!only.length || only.includes('light')) await auditLight();
} finally {
  await app.close().catch(() => {});
}

// Distinct findings across screens, by kind and surface.
const kinds = ['notFocusable', 'tabHole', 'f6Missing', 'noRing', 'noName', 'mouseOnly', 'lowContrast', 'lowContrastLight'];
const totals = {};
for (const k of kinds) {
  const set = new Set(report.flatMap((r) => r[k].map(String)));
  totals[k] = set.size;
  const bySurface = new Map();
  for (const d of set) { const [s, rest] = d.includes(' :: ') ? d.split(' :: ') : ['(area)', d]; bySurface.set(s, [...(bySurface.get(s) ?? []), rest]); }
  console.log(`\n# ${k} (${set.size} distinct)`);
  for (const [s, list] of [...bySurface].sort((a, b) => b[1].length - a[1].length)) console.log(`## ${s} (${list.length})\n  ${list.slice(0, 30).join('\n  ')}${list.length > 30 ? `\n  …and ${list.length - 30} more` : ''}`);
}
const traps = report.filter((r) => r.trap).map((r) => `${r.screen}: ${r.trap}`);
console.log(`\n# traps (${traps.length})\n  ${traps.join('\n  ')}`);
const incomplete = report.filter((r) => r.incomplete).map((r) => r.screen);
console.log(`\n# incomplete Tab runs (${incomplete.length})\n  ${incomplete.join('\n  ')}`);
// A modal must say it is a dialog and modal; a prompt must be announced.
const srProblem = (d) => !d.screenReader || (DIALOGS.find((x) => x.name === d.name)?.modal && (!/dialog/.test(d.screenReader.role) || d.screenReader.modal !== 'true')) || (d.name === 'prompt toast' && !d.screenReader.announced && !(d.screenReader.role === 'alertdialog' && d.focusMovedIn)) || d.screenReader.role === 'none';
const dialogProblems = dialogs.filter((d) => d.problem || !d.opened || !d.escapeCloses || !d.focusReturned || (!d.focusMovedIn && !d.reachableByTab) || d.tabStaysInside === false || srProblem(d));
console.log(`\n# dialogs (${dialogs.length} checked, ${dialogProblems.length} with a problem)\n  ${dialogProblems.map((d) => JSON.stringify(d)).join('\n  ')}`);
console.log(`\n[screens] ${report.length}`);
console.log(`[totals] ${JSON.stringify(totals)} traps=${traps.length} incomplete=${incomplete.length}`);
await fs.writeFile(path.join(outDir, 'keyboard-audit.json'), JSON.stringify(report, null, 2));
