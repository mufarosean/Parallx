// budget-places-review-fixes-probe.mjs: the four review fixes of 771c34f7
// (Getting around piece 8, Budget on the places point), driven on the real
// app by mouse and keys. Written by a verifier, not the builder.
//
//   C1  typing in Transactions' search (a pause > 150 ms after each key) is ONE
//       step of Back, not one per pause (?q=P, ?q=Pr, ...); the list still
//       follows the keys before the address does.
//   C2  two Budget tabs (Ctrl+click a column row: a tab of its own). In the
//       first, on Plan: a view switch, then Limits' Previous Month, then
//       Reconcile's account: each lands in the first tab's address; the
//       other tab's address, name and trail stay as they were.
//   A2  a transaction opened from its row (Needs review chip, All) and then
//       Confirmed or Deleted in its drawer: the row leaves the list and the
//       keys go to its neighbour row (the last one: the row before), the
//       only one: the page title; never to the page (document.body).
//   A3  two Budget tabs side by side (Split Editor Right), both on
//       Transactions: a row opened in the right one, the ledger changes while
//       the drawer is open (its list is drawn again), Escape: the keys go to
//       that row in the RIGHT page, not the left one's. And a row Deleted in the
//       right one: the keys stay in the right page.
//
// Seeded like the acceptance probe: a CSV typed into Import / Export.
// Usage (after node scripts/build.mjs):
//   xvfb-run -a node tests/probes/budget-places-review-fixes-probe.mjs [outDir]
//   PARALLX_PROBE_BUILD=/path/to/built/tree xvfb-run -a node tests/probes/budget-places-review-fixes-probe.mjs [outDir]
// One line per check, exit code 1 on any FAIL.
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { PROJECT_ROOT, launchEnv, cmd, screenshot, toolList, setToolEnabled } from './scene.mjs';

const BUILD = process.env.PARALLX_PROBE_BUILD ? path.resolve(process.env.PARALLX_PROBE_BUILD) : PROJECT_ROOT;
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(PROJECT_ROOT, 'tests', '.tmp-budget-review-fixes');
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, '.parallx'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
await fs.writeFile(path.join(ws, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
try { await fs.symlink(path.join(BUILD, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }
console.log(`[probe] build: ${BUILD}`);

let passed = 0; const failed = [];
const check = (name, ok, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (ok) passed += 1; else failed.push(name); };

const TOOL = 'parallx.budget';
const COLUMN = '.view[data-view-id="budget.nav"]';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const keyOfLabel = (label) => { const m = new RegExp(`(${MONTHS.join('|')})\\s+(\\d{4})`).exec(label ?? ''); return m ? `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}` : null; };
const shiftKey = (k, n) => { const y = Number(k.slice(0, 4)); const m0 = Number(k.slice(5, 7)) - 1 + n; const d = new Date(Date.UTC(y, m0, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
function parseAddr(a) {
  const m = /^parallx:\/\/place\/([^/?#]+)\/([^?#]*)(?:\?([^#]*))?$/i.exec(String(a ?? ''));
  return m ? { tool: m[1], place: m[2], params: Object.fromEntries(new URLSearchParams(m[3] ?? '')) } : null;
}

let app; let page; const errors = [];
const wait = (ms) => page.waitForTimeout(ms);
app = await electron.launch({ args: ['.', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'], cwd: BUILD, env: launchEnv(appRoot) });
await app.context().route(/^https?:\/\/(localhost|127\.0\.0\.1):11434\//, (route) => route.abort('connectionrefused'));
page = await app.firstWindow();
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Ollama|EmbeddingService/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`); });
await page.setViewportSize({ width: 1600, height: 900 }).catch(() => {});
await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
await wait(2_500);

/** Every visible Budget tab: id, label, active, its group; and per group the trail, the address and the focus. */
const read = () => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0;
  const groups = [...document.querySelectorAll('.editor-group')].filter(vis).map((g) => {
    const tabs = [...g.querySelectorAll('.ui-tab')].filter((t) => vis(t) && !t.classList.contains('ui-tab--leaving') && !t.closest('.editor-pane-container')).map((t) => ({ id: t.dataset.tabId ?? '', label: (t.querySelector('.ui-tab-label')?.textContent ?? '').trim(), active: t.classList.contains('ui-tab--active') }));
    const ribbon = g.querySelector('.editor-ribbon');
    const crumbs = ribbon && vis(ribbon) ? [...ribbon.querySelectorAll('.parallx-breadcrumb-item')].filter(vis).map((c) => ({ label: ((c.querySelector('.breadcrumb-label, [class*="label"]') ?? c).textContent ?? '').trim(), address: c.dataset.address ?? '' })) : [];
    const pane = g.querySelector('.editor-pane-container');
    const rows = [...(pane?.querySelectorAll('.budget-editor [data-tx-id]') ?? [])].filter(vis).map((r) => ({ id: r.dataset.txId, text: (r.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) }));
    return { id: g.getAttribute('data-editor-group-id'), tabs, crumbs: crumbs.map((c) => c.label), address: crumbs.length ? crumbs[crumbs.length - 1].address : '', rows, hasFocus: !!pane?.contains(document.activeElement), x: g.getBoundingClientRect().x };
  }).sort((a, b) => a.x - b.x);
  const ae = document.activeElement;
  const g = ae?.closest?.('.editor-group');
  return {
    groups,
    drawer: [...document.querySelectorAll('.budget-drawer')].filter(vis).length,
    focus: ae ? { tag: ae.tagName, cls: String(ae.className ?? '').slice(0, 60), pxid: ae.getAttribute('data-px-id'), txId: ae.getAttribute('data-tx-id'), text: (ae.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), group: g?.getAttribute('data-editor-group-id') ?? null, title: /px-page-header__title/.test(String(ae.className ?? '')) } : null,
  };
});
const activeGroup = (s) => s.groups.find((g) => g.tabs.some((t) => t.active) && g.hasFocus) ?? s.groups.find((g) => g.tabs.some((t) => t.active));
const centreIn = (sel, groupIndex = null) => page.evaluate(({ sel, groupIndex }) => {
  const groups = [...document.querySelectorAll('.editor-group')].filter((g) => g.getClientRects().length).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
  const scope = groupIndex === null ? document : groups[groupIndex]?.querySelector('.editor-pane-container');
  const e = [...(scope?.querySelectorAll(sel) ?? [])].find((x) => x.getClientRects().length && !x.disabled);
  if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + Math.min(60, r.width / 2), y: r.y + r.height / 2 };
}, { sel, groupIndex });
async function click(sel, groupIndex = null, ms = 1_600) { const at = await centreIn(sel, groupIndex); if (!at) return false; await page.mouse.click(at.x, at.y); await wait(ms); return true; }
const runCmd = (id, ...args) => cmd(page, id, ...args);
async function closeAll() { for (let i = 0; i < 30 && (await read()).groups.some((g) => g.tabs.length); i++) { await runCmd('workbench.action.closeActiveEditor'); await wait(250); } await wait(600); }
async function showColumn() {
  const shown = await page.evaluate((C) => { const v = document.querySelector(C); return !!v && v.getClientRects().length > 0; }, COLUMN);
  if (shown) return;
  const at = await centreIn('.activity-bar-item[data-icon-id="budget-container"]');
  if (at) { await page.mouse.click(at.x, at.y); await wait(1_400); }
}
async function rowAt(label) {
  await showColumn();
  return page.evaluate(({ label, C }) => {
    const nameOf = (e) => ((e.querySelector('.budget-label, .px-btn__label')?.textContent) || e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').replace(/\s*\d+$/, '').trim();
    const e = [...(document.querySelector(C)?.querySelectorAll('a, button, [role="link"], [role="button"], [role="option"]') ?? [])].find((x) => x.getClientRects().length && nameOf(x) === label);
    if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 };
  }, { label, C: COLUMN });
}
async function pressTab(id) {
  const at = await page.evaluate((id) => { const t = [...document.querySelectorAll('.editor-group .ui-tab')].find((x) => x.getClientRects().length && !x.closest('.editor-pane-container') && x.dataset.tabId === id); if (!t) return null; const l = (t.querySelector('.ui-tab-label') ?? t).getBoundingClientRect(); return { x: l.x + Math.min(20, l.width / 2), y: l.y + l.height / 2 }; }, id);
  if (!at) return false; await page.mouse.click(at.x, at.y); await wait(1_500); return true;
}
/** The address and name of the Budget tab with this id, read after pressing it. */
async function tabState(id) { await pressTab(id); const s = await read(); const g = s.groups.find((x) => x.tabs.some((t) => t.id === id && t.active)); return { label: g?.tabs.find((t) => t.id === id)?.label ?? null, crumbs: g?.crumbs ?? [], address: g?.address ?? '' }; }
const listCount = (groupIndex = 0) => page.evaluate((gi) => { const groups = [...document.querySelectorAll('.editor-group')].filter((g) => g.getClientRects().length).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x); return [...(groups[gi]?.querySelectorAll('.budget-editor [data-tx-id]') ?? [])].filter((r) => r.getClientRects().length).length; }, groupIndex);
/** Opens the row whose text starts with `merchant` in group `gi`, by the mouse. */
async function openRow(merchant, gi = 0) {
  const at = await page.evaluate(({ merchant, gi }) => {
    const groups = [...document.querySelectorAll('.editor-group')].filter((g) => g.getClientRects().length).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
    const r = [...(groups[gi]?.querySelectorAll('.budget-editor [data-tx-id]') ?? [])].find((x) => x.getClientRects().length && (x.textContent ?? '').includes(merchant));
    if (!r) return null; r.scrollIntoView({ block: 'nearest' }); const b = r.getBoundingClientRect(); return { x: b.x + Math.min(60, b.width / 2), y: b.y + b.height / 2, id: r.dataset.txId };
  }, { merchant, gi });
  if (!at) return null; await page.mouse.click(at.x, at.y); await wait(1_800); return at.id;
}
const runToolText = (name, args) => page.evaluate(async ({ name, args }) => {
  const svc = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
  const t = svc.getTool(name) ?? svc.getTool(name.replace(/\./g, '_')); if (!t) return `no tool ${name}`;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  try { return String((await t.handler(args, token))?.content ?? ''); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { name, args });

try {
  // ── Seed: Budget on, a CSV typed into Import / Export ──
  const t = (await toolList(page)).find((x) => x.id === TOOL);
  if (t && !t.enabled) { await setToolEnabled(page, TOOL, true); await wait(4_000); }
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const MERCHANTS = ['Probe Alpha', 'Probe Bravo', 'Probe Charlie', 'Probe Delta', 'Probe Echo', 'Probe Foxtrot'];
  const csv = ['date,merchant,amount,type,account,last_four',
    ...MERCHANTS.map((m, i) => `${today},${m},${10 + i}.25,purchase,Probe Checking,4242`),
    `${today},Probe Cafe,6.25,purchase,Probe Card,5151`].join('\n');
  await runCmd('budget.openImportExport'); await wait(2_500);
  let seeded = false;
  if (await click('.editor-pane-container [data-px-id="budget.import.text"]', null, 300)) {
    await page.keyboard.type(csv, { delay: 2 }); await wait(500);
    seeded = await click('.editor-pane-container [data-px-id="budget.import.run"]', null, 3_000);
  }
  await closeAll();
  await runCmd('budget.openTransactions'); await wait(2_500);
  const seedRows = (await read()).groups[0]?.rows ?? [];
  // Seed, not under test: the six Probe Checking rows put in Needs review (as a sync's uncategorised rows are), by Budget's own tool.
  const toReview = seedRows.filter((r) => /Probe (Alpha|Bravo|Charlie|Delta|Echo|Foxtrot)/.test(r.text));
  const reviewed = [];
  for (const r of toReview) reviewed.push(await runToolText('budget.updateTransaction', { id: r.id, status: 'review' }));
  await wait(1_500);
  const rafMs = await page.evaluate(() => new Promise((res) => { const t0 = performance.now(); requestAnimationFrame(() => res(Math.round(performance.now() - t0))); }));
  console.log(`[seed] imported: ${seeded}; rows on Transactions: ${seedRows.length}; put in review: ${reviewed.filter((x) => !/^no tool|failed|error/i.test(x)).length}/${toReview.length} (${reviewed[0]?.slice(0, 60)}); a frame takes ${rafMs} ms here`);

  // ── C1: a search typed is one step of Back ──
  await closeAll();
  await runCmd('budget.openDashboard'); await wait(2_200);
  await runCmd('budget.openTransactions'); await wait(2_500);
  let s = await read();
  const c1Tab = activeGroup(s)?.tabs.find((x) => x.active)?.id;
  const c1Before = activeGroup(s)?.address;
  await click('.editor-pane-container [data-px-id="budget.tx.search"]', null, 300);
  await page.keyboard.type('Probe C', { delay: 260 }); // each pause > the list's 150 ms
  await wait(400); // past the list's 150 ms, before the address's 0.7 s
  const early = await read();
  const earlyRows = early.groups[0]?.rows ?? [];
  await wait(1_600);
  s = await read();
  const c1Typed = activeGroup(s)?.address;
  check('C1a the list follows the keys: soon after "Probe C" is typed, only Probe Charlie and Probe Cafe are listed', earlyRows.length > 0 && earlyRows.every((r) => /Probe C(harlie|afe)/.test(r.text)), earlyRows);
  check('C1b once typing settles, the address holds q=Probe C (the keys still in the search box)', parseAddr(c1Typed)?.params.q === 'Probe C' && s.focus?.pxid === 'budget.tx.search', { c1Typed, focus: s.focus });
  await page.keyboard.press('Alt+ArrowLeft'); await wait(2_200);
  s = await read();
  const back1 = activeGroup(s)?.address;
  check(`C1c Alt+Left once: back to Transactions with no search (${c1Before}), not to a part of the word`, back1 === c1Before && parseAddr(back1)?.place === 'transactions' && parseAddr(back1)?.params.q === undefined, { back1, c1Before });
  await page.keyboard.press('Alt+ArrowLeft'); await wait(2_200);
  s = await read();
  check('C1d Alt+Left again: Overview (the step before), in the same tab', parseAddr(activeGroup(s)?.address)?.place === 'overview' && activeGroup(s)?.tabs.find((x) => x.active)?.id === c1Tab, { address: activeGroup(s)?.address });
  await page.keyboard.press('Alt+ArrowRight'); await wait(2_000);
  await page.keyboard.press('Alt+ArrowRight'); await wait(2_200);
  s = await read();
  check('C1e Alt+Right twice: the search again (q=Probe C), the box showing it', parseAddr(activeGroup(s)?.address)?.params.q === 'Probe C', { address: activeGroup(s)?.address });
  // Twice in a row: a second search typed is one more step, not more.
  await click('.editor-pane-container [data-px-id="budget.tx.search"]', null, 300);
  await page.keyboard.press('Control+a'); await page.keyboard.type('Probe E', { delay: 260 }); await wait(1_800);
  await page.keyboard.press('Alt+ArrowLeft'); await wait(2_200);
  s = await read();
  check('C1f a second search typed over it (Probe E), then Alt+Left once: back to q=Probe C', parseAddr(activeGroup(s)?.address)?.params.q === 'Probe C', { address: activeGroup(s)?.address });

  // ── C2: two Budget tabs; Plan reports into its own ──
  await closeAll();
  await runCmd('budget.openPlan'); await wait(2_500);
  s = await read();
  const tabA = activeGroup(s)?.tabs.find((x) => x.active)?.id;
  const catAt = await rowAt('Categories');
  if (catAt) { await page.keyboard.down('Control'); await page.mouse.click(catAt.x, catAt.y); await page.keyboard.up('Control'); await wait(2_600); }
  s = await read();
  const tabB = activeGroup(s)?.tabs.find((x) => x.active)?.id;
  const b0 = { label: activeGroup(s)?.tabs.find((x) => x.active)?.label, crumbs: activeGroup(s)?.crumbs, address: activeGroup(s)?.address };
  check('C2a set-up: two Budget tabs, the second (Ctrl+click Categories) on Categories', !!tabA && !!tabB && tabA !== tabB && b0.label === 'Categories' && parseAddr(b0.address)?.place === 'categories', { tabA, tabB, b0 });
  await pressTab(tabA);
  const pv = async (label) => { const at = await page.evaluate((label) => { const b = [...document.querySelectorAll('.editor-pane-container [data-px-id="budget.plan.view"] [role="radio"]')].find((x) => x.getClientRects().length && (x.textContent ?? '').trim() === label); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, label); if (!at) return false; await page.mouse.click(at.x, at.y); await wait(2_000); return true; };
  const sw = (await pv('Bills')) && (await pv('Limits'));
  s = await read();
  const monthNow = keyOfLabel(await page.evaluate(() => [...document.querySelectorAll('.editor-pane-container .budget-ov-month-label')].find((e) => e.getClientRects().length)?.textContent ?? ''));
  const prev = await click('.editor-pane-container [data-px-id="budget.month.prev"]', null, 2_200);
  s = await read();
  const aAddr = activeGroup(s)?.address;
  const want = monthNow ? shiftKey(monthNow, -1) : null;
  check(`C2b in the first tab, Bills then Limits (a view switch), then Previous Month: the FIRST tab's address takes month=${want}`, sw && prev && !!want && parseAddr(aAddr)?.place === 'plan' && parseAddr(aAddr)?.params.month === want, { sw, prev, aAddr, monthNow });
  let b1 = await tabState(tabB);
  check('C2c the second tab is untouched: still "Categories", trail Budget › Categories, its address with no month', b1.label === 'Categories' && JSON.stringify(b1.crumbs) === JSON.stringify(['Budget', 'Categories']) && b1.address === b0.address, { b0, b1 });
  // Reconcile's account.
  await pressTab(tabA);
  const rec = await pv('Reconcile');
  const ddOpened = await click('.editor-pane-container .budget-plan-view .budget-dd .ui-dropdown__button, .editor-pane-container .budget-toolbar .budget-dd .ui-dropdown__button', null, 700);
  const picked = ddOpened ? await page.evaluate(() => { const o = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((x) => x.getClientRects().length && /Probe Card/.test(x.textContent ?? '')); if (!o) return null; const r = o.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }) : null;
  if (picked) { await page.mouse.click(picked.x, picked.y); await wait(2_000); }
  s = await read();
  const aRec = activeGroup(s)?.address;
  check('C2d in the first tab, Reconcile, then the account dropdown set to Probe Card: the FIRST tab\'s address is plan?view=reconcile with an account', rec && !!picked && parseAddr(aRec)?.params.view === 'reconcile' && !!parseAddr(aRec)?.params.account, { rec, ddOpened, picked: !!picked, aRec });
  b1 = await tabState(tabB);
  check('C2e the second tab still untouched: "Categories", its address with no account, no month', b1.label === 'Categories' && b1.address === b0.address, { b0, b1 });
  await pressTab(tabA);
  s = await read();
  check('C2f the first tab is named for its view ("Reconcile")', activeGroup(s)?.tabs.find((x) => x.id === tabA)?.label === 'Reconcile', activeGroup(s)?.tabs);

  // ── A2: a row confirmed or deleted gives the keys to its neighbour ──
  await closeAll();
  await runCmd('budget.openTransactions'); await wait(2_500);
  const chip = await click('.editor-pane-container [data-px-id="budget.tx.view.review"]', null, 2_000);
  s = await read();
  let rows = s.groups[0]?.rows ?? [];
  console.log(`[A2] Needs review rows: ${rows.map((r) => r.text).join(' | ')}`);
  const focusOnRow = (st, notId) => !!st.focus?.txId && st.focus.txId !== notId && (st.groups[0]?.rows ?? []).some((r) => r.id === st.focus.txId);
  if (chip && rows.length >= 3) {
    const mid = rows[1];
    const id = await openRow(mid.text.slice(0, 12));
    // Diagnosis only (not a check): when the list is drawn again and when the drawer's frame comes, after Confirm.
    await page.evaluate(() => {
      const t0 = { at: 0 }; window.__rfDiag = { events: [], t0 };
      const list = document.querySelector('.editor-pane-container .budget-editor [data-tx-id]')?.parentElement;
      new MutationObserver(() => window.__rfDiag.events.push(`list redrawn +${Math.round(performance.now() - t0.at)}ms`)).observe(list, { childList: true });
      document.addEventListener('focusin', (e) => window.__rfDiag.events.push(`focus ${e.target.tagName}${e.target.dataset?.txId ? ' row' : ''} +${Math.round(performance.now() - t0.at)}ms`), true);
      document.addEventListener('pointerdown', () => { t0.at = performance.now(); }, { capture: true, once: true });
    });
    const hasConfirm = await click('[data-px-id="budget.txEditor.confirm"]', null, 2_400);
    console.log(`[A2] after Confirm: ${(await page.evaluate(() => window.__rfDiag.events.slice(0, 8))).join(', ')}`);
    s = await read();
    const after = s.groups[0]?.rows ?? [];
    check(`A2a Needs review, the second row (${mid.text.slice(0, 14)}) opened and Confirmed: it leaves the list; the keys on a neighbouring row (${rows[2].text.slice(0, 14)}), not the page`, !!id && hasConfirm && s.drawer === 0 && !after.some((r) => r.id === id) && focusOnRow(s, id) && s.focus.txId === rows[2].id, { hasConfirm, focus: s.focus, rows: after.map((r) => r.text.slice(0, 14)) });
    await screenshot(app, page, path.join(shots, 'a2-after-confirm.png'));
    rows = after;
    const last = rows[rows.length - 1];
    const lid = await openRow(last.text.slice(0, 12));
    await click('[data-px-id="budget.txEditor.confirm"]', null, 2_400);
    s = await read();
    check(`A2b the LAST row (${last.text.slice(0, 14)}) Confirmed: the keys on the row before it (${rows[rows.length - 2]?.text.slice(0, 14)})`, !!lid && focusOnRow(s, lid) && s.focus.txId === rows[rows.length - 2]?.id, { focus: s.focus });
    // Down to one, then the last one: the title.
    rows = s.groups[0]?.rows ?? [];
    for (let i = 0; i < 6 && rows.length > 1; i++) { await openRow(rows[0].text.slice(0, 12)); await click('[data-px-id="budget.txEditor.confirm"]', null, 2_200); rows = (await read()).groups[0]?.rows ?? []; }
    const only = rows[0];
    if (only) { await openRow(only.text.slice(0, 12)); await click('[data-px-id="budget.txEditor.confirm"]', null, 2_400); }
    s = await read();
    check('A2c the only row left Confirmed: the list is empty, the keys on the page title (in its editor), not the page', !!only && (s.groups[0]?.rows ?? []).length === 0 && !!s.focus?.title && !!s.focus.group, { only: only?.text, focus: s.focus });
  } else check('A2a-c set-up: Needs review lists at least three rows', false, { chip, rows });
  // Delete on All.
  await click('.editor-pane-container [data-px-id="budget.tx.view.all"]', null, 2_000);
  rows = (await read()).groups[0]?.rows ?? [];
  if (rows.length >= 3) {
    const victim = rows[1];
    const vid = await openRow(victim.text.slice(0, 12));
    await click('[data-px-id="budget.txEditor.delete"]', null, 400);
    await click('[data-px-id="budget.txEditor.delete"]', null, 2_400);
    s = await read();
    check(`A2d All, the second row (${victim.text.slice(0, 14)}) Deleted (Delete, then again): it leaves the list; the keys on its neighbour (${rows[2].text.slice(0, 14)})`, !!vid && s.drawer === 0 && !(s.groups[0]?.rows ?? []).some((r) => r.id === vid) && s.focus?.txId === rows[2].id, { focus: s.focus });
  } else check('A2d set-up: All lists at least three rows', false, rows);

  // ── A3: two Budget tabs side by side ──
  await closeAll();
  await runCmd('budget.openTransactions'); await wait(2_500);
  await runCmd('workbench.action.splitEditor'); await wait(2_500);
  s = await read();
  console.log(`[A3] groups after split: ${JSON.stringify(s.groups.map((g) => ({ tabs: g.tabs.map((x) => x.label), rows: g.rows.length })))}`);
  if (s.groups.length >= 2 && s.groups[1].tabs.length === 0) { await page.mouse.click(s.groups[1].x + 200, 300); await runCmd('budget.openTransactions'); await wait(2_500); s = await read(); }
  const both = s.groups.length === 2 && s.groups.every((g) => g.rows.length > 0);
  check('A3a set-up: two editor groups side by side, each a Budget tab on Transactions with rows', both, s.groups.map((g) => ({ tabs: g.tabs, rows: g.rows.length })));
  await screenshot(app, page, path.join(shots, 'a3-split.png'));
  if (both) {
    const rightGroup = s.groups[1].id;
    const target = s.groups[1].rows.find((r) => s.groups[0].rows.some((l) => l.id === r.id)) ?? s.groups[1].rows[0];
    const oid = await openRow(target.text.slice(0, 12), 1);
    // The opener is marked so the probe can tell it was drawn again; not read as a result.
    await page.evaluate((id) => { const g = [...document.querySelectorAll('.editor-group')].filter((x) => x.getClientRects().length).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[1]; const r = g?.querySelector(`[data-tx-id="${CSS.escape(id)}"]`); if (r) r.__probeOpener = true; }, oid);
    const cats = await runToolText('budget.listCategories', {});
    const cat = (/"name"\s*:\s*"([^"]+)"/.exec(cats) || [])[1] ?? 'Groceries';
    const setOut = await runToolText('budget.setBudget', { category: cat, amount: 321 }); await wait(2_000);
    const redrawn = await page.evaluate((id) => { const g = [...document.querySelectorAll('.editor-group')].filter((x) => x.getClientRects().length).sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)[1]; const r = g?.querySelector(`[data-tx-id="${CSS.escape(id)}"]`); return !!r && !r.__probeOpener; }, oid);
    console.log(`[A3] limit set while the drawer was open (${cat}): ${setOut.slice(0, 80)}; the row was drawn again: ${redrawn}`);
    await page.keyboard.press('Escape'); await wait(1_500);
    s = await read();
    check(`A3b in the RIGHT tab a row (${target.text.slice(0, 14)}) opened, the list drawn again under the drawer (a limit set), Escape: the keys on that row in the RIGHT page (group ${rightGroup}), not the left one`, !!oid && redrawn && s.drawer === 0 && s.focus?.txId === oid && s.focus.group === rightGroup, { redrawn, focus: s.focus, rightGroup });
    // Delete in the right page: the keys stay in the right page.
    const rr = s.groups[1].rows;
    const del = rr[1] ?? rr[0];
    const did = await openRow(del.text.slice(0, 12), 1);
    await click('[data-px-id="budget.txEditor.delete"]', null, 400);
    await click('[data-px-id="budget.txEditor.delete"]', null, 2_600);
    s = await read();
    // Which control in the right page (a row or its title) is A2's question (A2a-d); this one asks only whose page.
    check(`A3c in the RIGHT tab a row (${del.text.slice(0, 14)}) Deleted: the keys stay in the RIGHT page (a row or its title), not the left one, not the page`, !!did && s.drawer === 0 && !!s.focus && s.focus.tag !== 'BODY' && s.focus.txId !== did && s.focus.group === rightGroup, { focus: s.focus, rightGroup });
    await screenshot(app, page, path.join(shots, 'a3-after-delete.png'));
  }
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); failed.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app?.close().catch(() => {}); }

check('no page errors', errors.length === 0, errors.slice(0, 5));
console.log(`[probe] shots: ${shots}`);
console.log(`RESULT: ${passed}/${passed + failed.length} passed`);
process.exitCode = failed.length ? 1 : 0;
