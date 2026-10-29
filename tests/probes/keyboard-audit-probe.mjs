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
//   touchDead     drag handles a mouse can drag and a finger cannot
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
import { seedBeforeLaunch, seedAfterLaunch, miniAppSource } from './audit-seed.mjs';

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
  // Seeded content (audit-seed.mjs): what an empty workspace never shows.
  ['seed:page'], ['seed:conceptMap'], ['seed:database'], ['seed:imageEditor'], ['seed:imageEditor.masks'], ['seed:imageEditor.masks.subject'], ['seed:plan.masks'], ['seed:plan.masks.words'], ['seed:clipEditor'],
  // Painting Plans (behind the art tools setting, which the seed turns on).
  ['seed:plans'], ...['Compose', 'Photo', 'Values', 'Colour', 'Transfer', 'beforeAfter', 'notes', 'myPaints', 'board'].map((t) => [`seed:plan.${t}`]),
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
  // The spreadsheet engine's own DOM: held to the same checks unless KB_SKIP_THIRD=1 (window.__kbAuditThird).
  const third = (e) => !window.__kbAuditThird && !!e.closest('[class*="univer-"]');
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
      const reached = (e) => this.seen.has(e) || (e.id && this.seenIds.has(e.id)) || Array.from(this.seen).some((s) => s.contains(e) || e.contains(s));
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
    // A date or time field takes a Tab per part (month, day, year): count them.
    stops() { return Array.from(this.scope.querySelectorAll('*')).filter((e) => e.tabIndex >= 0 && shown(e) && !e.disabled).reduce((n, e) => n + (/^(date|time|datetime-local|month|week)$/.test(e.type ?? '') ? 4 : 1), 0); },
    start() {
      Object.assign(this, { seenIds: new Set(), atTabEnd: null, pointerAtTabEnd: null, first: null, seen: new Set(), prev: null, prevLook: '', prevParentLook: '', noRing: [], stuck: 0, wrapped: false, scope: scope() });
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
      // Read after the fade a focus starts has run (reading first starts it; settle finishes it).
      for (let p = a; p && p !== document.body; p = p.parentElement) void getComputedStyle(p).opacity;
      settle();
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
      // A list that redraws its rows as the highlight moves: remember the row by id too.
      this.seen.add(o);
      if (o.id) this.seenIds.add(o.id);
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
      // What the run ended among, still on the page: a view that redrew meanwhile (the Explorer refreshing as files
      // change under .parallx) has replaced some of them, and an element gone is no longer one a key must reach.
      const all = this.atTabEnd ? this.atTabEnd.filter((e) => e.isConnected) : this.interactive();
      const reached = (e) => this.seen.has(e) || (e.id && this.seenIds.has(e.id)) || Array.from(this.seen).some((s) => s.contains(e) || e.contains(s));
      const notFocusable = [], tabHole = [], thirdParty = [];
      for (const e of all) {
        if (reached(e)) continue;
        if (third(e)) { thirdParty.push(describe(e)); continue; }
        (e.tabIndex >= 0 ? tabHole : notFocusable).push(describe(e));
      }
      // A region that keeps Tab for itself and says F6 leaves it (a spreadsheet's grid) is a stop of its own:
      // the Tab run must have entered it, or a keyboard user never reaches what it holds.
      for (const r of this.scope.querySelectorAll('[role="region"][aria-keyshortcuts~="F6"]')) {
        if (!shown(r)) continue;
        const inside = Array.from(this.seen).some((s) => r.contains(s) && (s.isContentEditable || s.closest('[contenteditable="true"]') || s.tagName === 'CANVAS' || s.getAttribute('aria-keyshortcuts')));
        if (!inside) tabHole.push(`${describe(r)} (its own area never entered)`);
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
const seedPre = await seedBeforeLaunch(ws);
const { app, page } = await launchApp(appRoot);
if (!process.env.KB_SKIP_THIRD) await page.evaluate(() => { window.__kbAuditThird = true; }); // the spreadsheet engine is held to the same checks (KB_SKIP_THIRD=1 to set it aside)
await stubNativeDialogs(); // file and message dialogs cancel, links and folders open nothing on the desktop
let seedScreens = {};
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
      functionDeclaration: 'function () { if (!this.getClientRects || !this.getClientRects().length || this.closest(window.__kbAuditThird ? "[aria-hidden=true], [hidden]" : "[class*=univer-], [aria-hidden=true], [hidden]")) return null; const s = this.closest("[data-px-surface]"); return `${s ? s.getAttribute("data-px-surface") : "(window)"} :: ${this.tagName.toLowerCase()}${this.getAttribute("data-px-id") ? "#" + this.getAttribute("data-px-id") : (typeof this.className === "string" && this.className ? "." + this.className.split(" ")[0] : "")}`; }',
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

// 4. Touch (its own pass, after the keyboard's, so its drags never colour
// those results): every drag handle answers a finger as it answers the mouse.
// A handle is a draggable item or anything with a resize, move or grab
// cursor. Each is dragged by a finger first (held a moment when it is a
// draggable item, as the touch gesture asks); if the page does not change
// beyond its idle churn, the same drag by mouse decides: the mouse changes
// it and the finger did not = touchDead. Each distinct handle is tried once.
const touchTried = new Set();
const DRAG_CURSOR = '^(col-resize|row-resize|ew-resize|ns-resize|nwse-resize|nesw-resize|[nsew]{1,2}-resize|grab|move)$';
async function touchDead() {
  if (!cdp) return [];
  const cands = await page.evaluate((re) => {
    const DRAG = new RegExp(re);
    const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 3 || r.height < 3) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') return false; if (e.closest('[hidden], [aria-hidden="true"], [inert]')) return false; const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1); const top = document.elementFromPoint(x, y); return !!top && (top === e || e.contains(top)); };
    const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter((m) => m.getClientRects().length).pop();
    const scope = modal ?? document.body;
    // A drag cursor set only on hover (a grip that shows when its row is
    // pointed at) is in no computed style until then: read the stylesheets.
    const hoverCursor = new Map();
    const strip = (sel) => sel.replace(/:(hover|active|focus|focus-within|focus-visible)\b/g, '').replace(/::?(before|after)\b/g, '');
    const walk = (rules) => { for (const r of rules) { if (r.cssRules && !r.selectorText) { try { walk(r.cssRules); } catch { /* cross-origin */ } continue; } if (!r.selectorText || !r.style?.cursor || !DRAG.test(r.style.cursor)) continue; for (const part of r.selectorText.split(',')) { try { for (const e of scope.querySelectorAll(strip(part.trim()) || '*:not(*)')) if (!hoverCursor.has(e)) hoverCursor.set(e, r.style.cursor); } catch { /* selector the DOM API refuses */ } } } };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch { /* cross-origin */ } }
    const out = [];
    let n = 0;
    for (const e of scope.querySelectorAll('*')) {
      const drag = e.getAttribute('draggable') === 'true';
      let cur = getComputedStyle(e).cursor;
      if (!DRAG.test(cur) && hoverCursor.has(e)) cur = hoverCursor.get(e);
      if (!drag && !DRAG.test(cur)) continue;
      if (!drag && e.parentElement && getComputedStyle(e.parentElement).cursor === cur) continue; // the handle, not what it holds
      if (typeof e.className === 'string' && /(^|\s)univer-/.test(e.className)) continue;
      if (e.closest('[hidden], [inert]') || !e.getClientRects().length) continue;
      // Shown only while its container is pointed at: point there first.
      let hover = null;
      if (!vis(e)) {
        let p = e.parentElement;
        while (p && p !== document.body && !vis(p)) p = p.parentElement;
        if (!p || p === document.body) continue;
        const pr = p.getBoundingClientRect();
        hover = { x: pr.left + Math.min(pr.width / 2, 40), y: pr.top + Math.min(pr.height / 2, 20) };
      }
      e.setAttribute('data-touch-cand', String(n));
      const r = e.getBoundingClientRect();
      const s = e.closest('[data-px-surface]');
      const cls = typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '';
      const label = (e.getAttribute('aria-label') || e.getAttribute('title') || '').trim().slice(0, 30);
      out.push({ n: n++, hover, sig: `${s ? s.getAttribute('data-px-surface') : '(window)'} :: ${e.tagName.toLowerCase()}${e.getAttribute('data-px-id') ? '#' + e.getAttribute('data-px-id') : cls}${label ? ` "${label}"` : ''}`,
        x: r.left + r.width / 2, y: r.top + r.height / 2, drag, axis: /col|ew|^[ew]-/.test(cur) ? 'x' : /row|ns|^[ns]-/.test(cur) ? 'y' : 'xy', canvas: e.tagName === 'CANVAS' });
    }
    return out;
  }, DRAG_CURSOR);
  const dead = [];
  for (const c of cands) {
    if (touchTried.has(c.sig) || touchTried.size > 400) continue;
    if (c.hover) {
      // Point at its container, then find it where it is drawn now.
      await page.mouse.move(c.hover.x, c.hover.y);
      await page.waitForTimeout(250);
      const at = await page.evaluate((n) => { const e = document.querySelector(`[data-touch-cand="${n}"]`); if (!e) return null; const r = e.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const top = document.elementFromPoint(x, y); return r.width >= 3 && r.height >= 3 && top && (top === e || e.contains(top)) ? { x, y } : null; }, c.n);
      if (!at) continue;
      c.x = at.x; c.y = at.y;
    }
    touchTried.add(c.sig);
    // What changed on the page: DOM churn, a drag begun, a canvas redrawn.
    const watch = () => page.evaluate(({ x, y, canvas }) => {
      const w = { n: 0, drag: false, pix: '' };
      const pix = () => { if (!canvas) return ''; const el = document.elementFromPoint(x, y); try { return el?.tagName === 'CANVAS' ? el.toDataURL().slice(-200) : ''; } catch { return ''; } };
      w.pix = pix();
      const mo = new MutationObserver((m) => { w.n += m.length; });
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      const ds = () => { w.drag = true; };
      document.addEventListener('dragstart', ds, true);
      window.__touchWatch = { done: () => { mo.disconnect(); document.removeEventListener('dragstart', ds, true); return { n: w.n, drag: w.drag, pixChanged: canvas && pix() !== w.pix }; } };
    }, c);
    const read = () => page.evaluate(() => window.__touchWatch.done());
    const steps = 3, step = 4;
    const at = (i) => ({ x: c.x + (c.axis === 'y' ? 0 : i * step), y: c.y + (c.axis === 'x' ? 0 : i * step) });
    // Idle churn over the same span, as the baseline.
    await watch(); await page.waitForTimeout(c.drag ? 700 : 300); const idle = await read();
    await watch();
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });
    await touch('touchStart', at(0));
    if (c.drag) await page.waitForTimeout(450);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', at(i)); await page.waitForTimeout(25); }
    await touch('touchEnd', at(steps));
    await page.waitForTimeout(150);
    const byFinger = await read();
    const moved = (w) => w.drag || w.pixChanged || w.n > idle.n + 2;
    if (!moved(byFinger)) {
      await watch();
      await page.mouse.move(at(0).x, at(0).y); await page.mouse.down();
      for (let i = 1; i <= steps; i++) { await page.mouse.move(at(i).x, at(i).y); await page.waitForTimeout(25); }
      await page.mouse.up();
      await page.waitForTimeout(150);
      const byMouse = await read();
      if (moved(byMouse)) dead.push(c.sig);
    }
    if (process.env.KB_DEBUG) console.log(`[debug] touch ${c.sig}: finger=${JSON.stringify(byFinger)} idle=${idle.n}`);
    await page.keyboard.press('Escape');
  }
  return dead;
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
    // Stuck where Tab has a meaning of its own (a spreadsheet's cells) is no trap when the place says how to leave (F6) and F6 does.
    if (r === 'stuck' && process.env.KB_DEBUG) console.log('[debug] stuck at:', await page.evaluate(() => { const out = []; for (let p = document.activeElement; p && out.length < 10; p = p.parentElement) out.push(p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + '.' + String(p.className).split(' ')[0].slice(0, 24) + (p.hasAttribute('aria-keyshortcuts') ? '{F6}' : '')); return out.join(' < '); }));
    if (r === 'stuck' && await page.evaluate(() => !!document.activeElement?.closest('[aria-keyshortcuts~="F6"]'))) {
      await page.keyboard.press('F6');
      if (await page.evaluate(() => !document.activeElement?.closest('[aria-keyshortcuts~="F6"]'))) {
        // F6 lands on the next area's own focus (the chat's body, say): what
        // stands before it in that area is Shift+Tab away, so walk back to it.
        const landing = await page.evaluateHandle(() => document.activeElement);
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press('Shift+Tab');
          const inArea = await page.evaluate((l) => {
            const area = l.closest('[data-part-id]'); const a = document.activeElement;
            if (!area || !area.contains(a) || a === l) return false;
            window.__kb.seen.add(a); if (a.getAttribute('data-px-id')) window.__kb.seenIds.add(a.getAttribute('data-px-id'));
            return true;
          }, landing);
          if (!inArea) break;
        }
        await page.evaluate((l) => { l.focus(); window.__kb.stuck = 0; window.__kb.prev = l; }, landing);
        wrapped = true; continue; // the run has passed the region: the next element met again ends it
      }
      // F6 moved focus within the region (a sheet's grid to its tabs bar): that is progress, not a trap.
      const moved = await page.evaluate(() => { const was = window.__kb.prev; window.__kb.stuck = 0; const a = document.activeElement; window.__kb.prev = a; if (a && a !== was) { window.__kb.seen.add(a); return true; } return false; });
      if (moved) continue;
    }
    if (r === 'stuck') { trap = await page.evaluate(() => { const a = document.activeElement; const s = a?.closest('[data-px-surface]'); return `${s ? s.getAttribute('data-px-surface') : '(window)'} :: ${a?.tagName.toLowerCase()} "${(a?.getAttribute('aria-label') || a?.textContent || '').trim().slice(0, 40)}"`; }); break; }
    // Done when the order has come round: after a wrap to the top, the first element met again; a
    // dialog keeps Tab inside, so 40 repeats in a row with no wrap also ends it.
    if (r === 'wrap') wrapped = true;
    repeats = r === 'seen' ? repeats + 1 : 0;
    if (r === 'cycled' || (r === 'seen' && wrapped) || repeats >= 40) break;
  }
  await page.evaluate(() => window.__kb.tabEnd());
  // KB_DEBUG=1: elements the Tab run met that are gone from the page by its end (a view built again meanwhile).
  if (process.env.KB_DEBUG) console.log('[debug] detached since met:', await page.evaluate(() => Array.from(window.__kb.seen).filter((e) => !e.isConnected).map((e) => e.getAttribute('data-px-id') || e.className).join(' | ') || 'none'));
  // KB_DEBUG=1: the Tab path as the run met it, and the composites the arrows will walk.
  if (process.env.KB_DEBUG) console.log('[debug] tab path:', await page.evaluate(() => Array.from(window.__kb.seen).map((e) => `${e.tagName.toLowerCase()}${e.getAttribute('data-px-id') ? '#' + e.getAttribute('data-px-id') : '.' + String(e.className).split(' ')[0]} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24)}"`).join(' | ')));
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
  if (process.env.KB_DEBUG) console.log('[debug] composites:', await page.evaluate(() => window.__kb.comps.map((c, i) => `${i}:${c.getAttribute('role')}${c.id ? '#' + c.id : ''} enter=${!!(Array.from(window.__kb.seen).find((s) => c.contains(s)) || (c.id && document.querySelector('[aria-controls="' + c.id + '"]')))}`).join(' ')));
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
  if (process.env.KB_DEBUG) console.log('[debug] after arrows, tabs reached:', await page.evaluate(() => Array.from(window.__kb.seen).filter((e) => e.getAttribute('role') === 'tab').map((e) => (e.textContent || '').trim().slice(0, 16) + (e.isConnected ? '' : '(gone)')).join(' | ')));
  await page.evaluate(() => document.activeElement?.blur());
  const lowContrast = await page.evaluate(() => window.__kb.contrast());
  const res = await page.evaluate(() => {
    const r = window.__kb.finish();
    window.__kb.describePointerOne = (j) => r.describePointer[j];
    return r;
  });
  const noName = await namelessNodes();
  const mouse = await mouseOnly(res.pointerCount);
  const row = { screen: label, tabs, trap, incomplete: tabs >= limit, f6Missing, notFocusable: res.notFocusable, tabHole: res.tabHole, noRing: res.noRing, noName, mouseOnly: mouse, touchDead: [], lowContrast, lowContrastLight: [], thirdParty: res.thirdParty.length, reached: res.reached, interactive: res.interactive };
  report.push(row);
  console.log(`[screen] ${label}: tabs=${tabs} reached=${res.reached}/${res.interactive} notFocusable=${res.notFocusable.length} tabHole=${res.tabHole.length} f6Missing=${f6Missing.length} noFocusRing=${res.noRing.length} noName=${noName.length} mouseOnly=${mouse.length} lowContrast=${lowContrast.length} thirdParty=${res.thirdParty.length}${trap ? ` TRAP at ${trap}` : ''}${tabs >= limit ? ' INCOMPLETE (Tab never came round)' : ''}`);
}

/** Light mode: the same screens, text contrast only. */
// 5. Popups (its own pass): every state a screen opens. On each screen,
// each button that is not destructive is pressed from the keyboard; what
// opens (a dialog, a menu, a list, a popover) is checked as the dialog pass
// checks the shared kinds: focus goes in, a modal keeps Tab inside, every
// control in it has a name, Escape closes it, focus comes back. A menu's
// submenus are opened with the arrow key and checked the same way. Native
// file and message dialogs are stubbed to cancel at once (nothing could
// close one in a hidden window).
const popupTried = new Set();
const DESTRUCTIVE = /print|delete|remove|clear|reset|empty|erase|discard|uninstall|disconnect|sign out|log out|quit|close window|^close$|minimi|maximi|restore|run|send|stop|start|record|apply|save|sync|refresh|rescan|scan|generate|upscale|optimize|merge|move to trash|restart|reload|install|update|approve|reject|accept|done|confirm|submit|turn on|turn off|enable|disable|play|pause|undo|redo|duplicate/i;
const POPUP_ROOTS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-px-surface="contextMenu"], [data-px-surface="quickAccess"], .ui-dropdown__list';
async function stubNativeDialogs() {
  await app.evaluate(({ shell }) => { shell.openExternal = async () => {}; shell.openPath = async () => ''; shell.showItemInFolder = () => {}; }).catch(() => {}); // a hidden run opens nothing on the desktop
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
    dialog.showMessageBox = async (_w, o) => { const opts = o ?? _w; const n = (opts?.buttons ?? ['OK']).length; return { response: typeof opts?.cancelId === 'number' ? opts.cancelId : n - 1, checkboxChecked: false }; };
    dialog.showOpenDialogSync = () => undefined; dialog.showSaveDialogSync = () => undefined; dialog.showMessageBoxSync = (_w, o) => { const opts = o ?? _w; return typeof opts?.cancelId === 'number' ? opts.cancelId : (opts?.buttons ?? ['OK']).length - 1; };
  }).catch(() => {});
}
/** The workbench is up and its services usable (a reload disposes them). */
const workbenchAlive = () => page.evaluate(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ICommandService' }); } catch { return false; } }).catch(() => false);
async function waitWorkbench() { for (let i = 0; i < 120 && !(await workbenchAlive()); i++) await page.waitForTimeout(500); await page.waitForTimeout(2_000); }
async function popupProblems(label) {
  const problems = [];
  const before = new Set(await namelessNodes());
  const cands = await page.evaluate(({ DEST, roots }) => {
    const re = new RegExp(DEST, 'i');
    const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter((m) => m.getClientRects().length).pop();
    const scope = modal ?? document.body;
    const out = [];
    let n = 0;
    for (const e of scope.querySelectorAll('button, [role="button"], [aria-haspopup]:not([aria-haspopup="false"])')) {
      if (!e.getClientRects().length || e.disabled || e.getAttribute('aria-disabled') === 'true') continue;
      if (e.closest('[class*=univer-], [aria-hidden="true"], [hidden], [inert], [data-part-id="workbench.parts.titlebar"], [data-part-id="workbench.parts.activitybar"], [data-part-id="workbench.parts.activitybar.right"], [data-part-id="workbench.parts.statusbar"]')) continue;
      if (e.closest(roots)) continue;
      const name = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').trim().replace(/\s+/g, ' ');
      if (!name || re.test(name)) continue;
      if (e.getAttribute('role') === 'tab' || e.closest('[role="tablist"]')) continue; // navigation, visited as screens
      const sur = e.closest('[data-px-surface]');
      e.setAttribute('data-popup-cand', String(n));
      out.push({ n: n++, sig: `${sur ? sur.getAttribute('data-px-surface') : '(window)'} :: ${e.getAttribute('data-px-id') || name.slice(0, 40)}` });
    }
    return out;
  }, { DEST: DESTRUCTIVE.source, roots: POPUP_ROOTS });
  for (const c of cands) {
    if (popupTried.has(c.sig) || popupTried.size > 1500) continue;
    popupTried.add(c.sig);
    const opened = await page.evaluate(({ n, roots }) => {
      const e = document.querySelector(`[data-popup-cand="${n}"]`);
      if (!e || !e.getClientRects().length) return null;
      window.__popupBefore = new Set(Array.from(document.querySelectorAll(roots)).filter((r) => r.getClientRects().length));
      window.__popupOpener = e;
      e.focus();
      return document.activeElement === e || e.contains(document.activeElement);
    }, { n: c.n, roots: POPUP_ROOTS });
    if (!opened) continue;
    if (process.env.KB_DEBUG) console.log(`[debug] popup press ${c.sig}`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);
    // A press that reloaded the window (a workspace switch): wait for it, then go on with the next screen.
    if (!(await workbenchAlive())) { problems.push(`${label} :: ${c.sig}: the window reloaded`); await waitWorkbench(); break; }
    const state = () => page.evaluate((roots) => {
      const now = Array.from(document.querySelectorAll(roots)).filter((r) => r.getClientRects().length && !window.__popupBefore.has(r));
      const r = now.pop();
      const a = document.activeElement;
      const drives = !!r && !!a && !!r.id && a.getAttribute('aria-controls') === r.id;
      return { open: !!r, modal: !!r && (r.getAttribute('aria-modal') === 'true' || !!r.closest('[aria-modal="true"]')), inside: !!r && (r.contains(a) || drives), atOpener: a === window.__popupOpener, menu: !!r && (r.getAttribute('role') === 'menu' || r.matches('[data-px-surface="contextMenu"]')) };
    }, POPUP_ROOTS);
    const s1 = await state();
    if (!s1.open) {
      // Not a popup: it navigated or toggled. Put the screen back.
      await page.keyboard.press('Escape');
      continue;
    }
    const where = `${label} :: ${c.sig}`;
    if (!s1.inside) problems.push(`${where}: focus did not move into what opened`);
    if (s1.modal) {
      for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); if (!(await state()).inside) { problems.push(`${where}: Tab left the modal`); break; } }
    }
    for (const nm of await namelessNodes()) if (!before.has(nm)) problems.push(`${where}: nameless ${nm}`);
    if (s1.menu) {
      // A submenu: the first item that has one, opened with the arrow key.
      const sub = await page.evaluate(() => { const items = Array.from(document.querySelectorAll('[role="menuitem"][aria-haspopup]')).filter((x) => x.getClientRects().length); const it = items[0]; if (!it) return false; it.focus(); return true; });
      if (sub) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(300);
        const deeper = await page.evaluate(() => document.querySelectorAll('[role="menu"]').length);
        if (deeper < 2) problems.push(`${where}: a submenu did not open with the arrow key`);
        else { for (const nm of await namelessNodes()) if (!before.has(nm)) problems.push(`${where} > submenu: nameless ${nm}`); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200); }
      }
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    const s2 = await state();
    if (s2.open) { problems.push(`${where}: Escape did not close it`); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); }
    else if (!s2.atOpener && !s1.modal) problems.push(`${where}: focus did not come back to the opener`);
    else if (!s2.atOpener) problems.push(`${where}: focus did not come back to the opener`);
  }
  return [...new Set(problems)];
}
async function auditPopups() {
  await stubNativeDialogs();
  const done = new Set();
  const one = async (label) => {
    let p;
    try { p = await popupProblems(label); } catch (err) { await waitWorkbench(); p = [`${label}: the popup pass failed here (${String(err?.message || err).slice(0, 120)})`]; }
    report.push({ screen: `${label} (popups)`, tabs: 0, trap: null, f6Missing: [], notFocusable: [], tabHole: [], noRing: [], noName: [], mouseOnly: [], touchDead: [], popups: p, lowContrast: [], lowContrastLight: [] });
    console.log(`[popups] ${label}: tried=${popupTried.size} problems=${p.length}`);
  };
  for (const [first, ...args] of SCREENS) {
    const label = [first, ...args].join(' ');
    if (only.length && !only.some((o) => label.includes(o)) && !only.includes('popups')) continue;
    await open(first, args);
    await page.waitForTimeout(1_200);
    await one(label);
    for (const id of await navIds().catch(async () => { await waitWorkbench(); return []; })) {
      if (done.has(id)) continue;
      done.add(id);
      await open(first, args);
      await page.waitForTimeout(800);
      const ok = await page.evaluate((id) => { const e = Array.from(document.querySelectorAll(`[data-px-id="${CSS.escape(id)}"]`)).find((x) => x.getClientRects().length); if (!e) return false; e.click(); return true; }, id);
      if (!ok) continue;
      await page.waitForTimeout(1_000);
      await one(`${label} > ${id}`);
    }
  }
}

async function auditTouch() {
  const done = new Set();
  const one = async (label) => {
    const dead = await touchDead();
    report.push({ screen: `${label} (touch)`, tabs: 0, trap: null, f6Missing: [], notFocusable: [], tabHole: [], noRing: [], noName: [], mouseOnly: [], touchDead: dead, lowContrast: [], lowContrastLight: [] });
    console.log(`[touch] ${label}: tried=${touchTried.size} touchDead=${dead.length}`);
  };
  for (const [first, ...args] of SCREENS) {
    const label = [first, ...args].join(' ');
    if (only.length && !only.some((o) => label.includes(o)) && !only.includes('touch')) continue;
    await open(first, args);
    await page.waitForTimeout(1_200);
    await one(label);
    for (const id of await navIds().catch(async () => { await waitWorkbench(); return []; })) {
      if (done.has(id)) continue;
      done.add(id);
      await open(first, args);
      await page.waitForTimeout(800);
      const ok = await page.evaluate((id) => { const e = Array.from(document.querySelectorAll(`[data-px-id="${CSS.escape(id)}"]`)).find((x) => x.getClientRects().length); if (!e) return false; e.click(); return true; }, id);
      if (!ok) continue;
      await page.waitForTimeout(1_000);
      await one(`${label} > ${id}`);
    }
  }
}

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
    report.push({ screen: `${label} (light)`, tabs: 0, trap: null, f6Missing: [], notFocusable: [], tabHole: [], noRing: [], noName: [], mouseOnly: [], touchDead: [], lowContrast: [], lowContrastLight: low });
    console.log(`[light] ${label}: lowContrast=${low.length}`);
  }
  await mode('dark');
}

async function open(first, args) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  if (first === 'pdf') return openFile(page, 'reading.pdf');
  if (first === 'boot') return;
  if (first.startsWith('seed:')) return seedScreens[first]?.();
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
// An opener is a declared control's id, or `css:<selector>` (a mini-app's frame).
const focusId = (id, inner) => page.evaluate(({ id, inner }) => {
  const e = Array.from(document.querySelectorAll(id.startsWith('css:') ? id.slice(4) : `[data-px-id="${CSS.escape(id)}"]`)).find((x) => x.getClientRects().length);
  const t = inner ? e?.querySelector(inner) : e;
  t?.focus();
  return !!t && document.activeElement === t;
}, { id, inner });
// A control inside a frame: focused from within it (focusing the frame itself puts its focus on its body).
const focusInFrame = async (frame, inner) => {
  try { await page.frameLocator(`${frame}:visible`).first().locator(inner).focus({ timeout: 5_000 }); } catch { return false; }
  return page.evaluate((frame) => { const a = document.activeElement; return !!a && a.matches(frame) && !!a.getClientRects().length; }, frame);
};
const DIALOGS = [
  { name: 'command palette', opener: ['activitybar.explorer-container'], open: { key: 'Control+Shift+P' }, root: '[data-px-surface="quickAccess"]', modal: true },
  { name: 'quick open', opener: ['activitybar.explorer-container'], open: { key: 'Control+P' }, root: '[data-px-surface="quickAccess"]', modal: true },
  { name: 'notifications panel (bell)', opener: ['activitybar.notifications'], open: { key: 'Enter' }, root: '[data-px-surface="notificationCenter"]', modal: false },
  { name: 'dropdown', setup: ['workflows.new'], opener: ['workflows.editor.class', 'button'], open: { key: 'Enter' }, root: '.ui-dropdown__list', modal: false },
  { name: 'settings', opener: ['activitybar.explorer-container'], open: { cmd: ['settings.open'] }, root: '[data-px-surface="settings"]', modal: true },
  { name: 'confirm', opener: ['activitybar.explorer-container'], open: { cmd: ['workspace.resetConfig'] }, root: '[data-px-surface="confirm"]', modal: true },
  { name: 'input box', setup: ['canvas.newPage'], opener: ['canvas.page.menu'], open: { cmd: ['canvas.renamePage', '$page'] }, root: '[data-px-surface="inputBox"]', modal: true },
  { name: 'prompt toast', setup: ['canvas.newPage'], opener: ['canvas.page.menu'], open: { cmd: ['canvas.deletePage', '$page'] }, root: '[data-px-surface="notification"]', modal: false },
  // A mini-app asks to use one of the person's tools when its button is pressed.
  // Its opener is the frame (focus returns to it); inside, the app's button, where Tab from the window lands.
  { name: 'app permission', setup: [['chat.openMiniApp', 'Permission Check', miniAppSource('Permission Check', { onPress: ['fs_list_files'] })]], opener: ['css:.px-af-app__frame'], inFrame: '#go', open: { key: 'Enter' }, root: '.px-app-permission', modal: true },
];
async function auditDialogs() {
  const out = [];
  for (const d of DIALOGS) {
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    for (const c of d.setup ?? []) { await cmd(page, ...[c].flat()); await page.waitForTimeout(1_200); }
    const focused = d.inFrame ? await focusInFrame(d.opener[0].slice(4), d.inFrame) : await focusId(...d.opener);
    if (!focused) { out.push({ name: d.name, problem: `could not focus the opener ${d.opener.join(' ')}` }); continue; }
    const modesBefore = await page.evaluate(() => document.documentElement.dataset.pxModes || '');
    // Where the opening key goes: who receives it, and whether anything cancels it on the way.
    await page.evaluate(() => { const d = (t) => t ? `${t.tagName?.toLowerCase?.() ?? 'doc'}${t.getAttribute?.('data-px-id') ? '#' + t.getAttribute('data-px-id') : ''}` : 'none'; window.__keyTrail = []; const cap = (e) => { if (e.key === 'Enter') window.__keyTrail.push('capture:' + d(e.target) + ':active=' + d(document.activeElement)); }; const bub = (e) => { if (e.key === 'Enter') window.__keyTrail.push('bubble-end:prevented=' + e.defaultPrevented); }; window.addEventListener('keydown', cap, { capture: true, once: true }); window.addEventListener('keydown', bub, { once: true }); for (const m of ['stopPropagation', 'stopImmediatePropagation', 'preventDefault']) { const orig = Event.prototype[m]; if (orig.__kbWrapped) continue; const w = function () { if (this.type === 'keydown' && this.key === 'Enter' && window.__keyTrail.length < 6) window.__keyTrail.push(m + ' by ' + String(new Error().stack).split(String.fromCharCode(10)).slice(2, 5).map((l) => l.trim().split('/dist/renderer/').pop()).join(' < ')); return orig.apply(this, arguments); }; w.__kbWrapped = true; Event.prototype[m] = w; } });
    if (d.open.key) await page.keyboard.press(d.open.key);
    else { const args = []; for (const a of d.open.cmd.slice(1)) args.push(a === '$page' ? await canvasPageId() : a); await cmdNoWait(page, d.open.cmd[0], ...args); }
    await page.waitForTimeout(700);
    const state = () => page.evaluate(({ root, opener }) => {
      const r = Array.from(document.querySelectorAll(root)).filter((e) => e.getClientRects().length).pop();
      const a = document.activeElement;
      const op = Array.from(document.querySelectorAll(opener[0].startsWith('css:') ? opener[0].slice(4) : `[data-px-id="${CSS.escape(opener[0])}"]`)).find((x) => x.getClientRects().length);
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
    // Not opened: what the page held, so the cause is a finding rather than a guess.
    if (!s1.open) { row.modesBefore = modesBefore; row.keyTrail = await page.evaluate(() => (window.__keyTrail || []).join(' | ')); }
    if (!s1.open) row.seen = await page.evaluate(({ root, opener }) => {
      const a = document.activeElement;
      const openers = Array.from(document.querySelectorAll(opener[0].startsWith('css:') ? opener[0].slice(4) : `[data-px-id="${CSS.escape(opener[0])}"]`));
      return { roots: Array.from(document.querySelectorAll(root)).map((e) => (e.getClientRects().length ? 'shown' : 'hidden')), openers: openers.map((e) => (e.getClientRects().length ? 'shown' : 'hidden')), activeShown: !!a?.getClientRects().length, expanded: a?.getAttribute('aria-expanded'), modes: document.documentElement.dataset.pxModes || '', lastExit: document.documentElement.dataset.pxLastExit || '', disabled: !!a?.disabled };
    }, { root: d.root, opener: d.opener });
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
    // Back in a frame, focus is on the control that opened the dialog, not the frame's body.
    if (d.inFrame && s2.atOpener) {
      await page.waitForTimeout(300);
      row.focusReturned = await page.frameLocator(`${d.opener[0].slice(4)}:visible`).first().locator(d.inFrame).evaluate((e) => e.ownerDocument.activeElement === e).catch(() => false);
    }
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
  // Behind an open modal nothing is reachable: follow only the navigation inside it.
  return page.evaluate((ids) => { const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter((m) => m.getClientRects().length).pop(); return [...new Set(ids)].filter((id) => Array.from(document.querySelectorAll(`[data-px-id="${CSS.escape(id)}"]`)).some((e) => e.getClientRects().length && !e.closest('[hidden], [aria-hidden="true"]') && (!modal || modal.contains(e)))); }, ids);
}

try {
  for (const id of EXTS) await setToolEnabled(page, id, true);
  await page.waitForTimeout(3_000);
  seedScreens = await seedAfterLaunch(page, seedPre);
  const done = new Set();
  for (const [first, ...args] of SCREENS) {
    const label = [first, ...args].join(' ');
    if (only.length && !only.some((o) => label.includes(o))) continue;
    console.log(`[open] ${label}`);
    await open(first, args);
    await page.waitForTimeout(1_500);
    await auditScreen(label);
    // One level down: each navigation entry this screen shows.
    for (const id of await navIds().catch(async () => { await waitWorkbench(); return []; })) {
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
  if (!only.length || only.includes('touch') || only.some((o) => !['dialogs', 'light', 'popups'].includes(o))) await auditTouch();
  if (!only.length || only.includes('popups') || only.some((o) => !['dialogs', 'light', 'touch'].includes(o))) await auditPopups();
  if (!only.length || only.includes('light')) await auditLight();
} finally {
  await app.close().catch(() => {});
}

// Distinct findings across screens, by kind and surface.
const kinds = ['notFocusable', 'tabHole', 'f6Missing', 'noRing', 'noName', 'mouseOnly', 'touchDead', 'popups', 'lowContrast', 'lowContrastLight'];
const totals = {};
for (const k of kinds) {
  const set = new Set(report.flatMap((r) => (r[k] ?? []).map(String)));
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
