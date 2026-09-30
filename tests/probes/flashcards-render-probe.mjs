// flashcards-render-probe.mjs — how a set of cards LOOKS in the real app, hidden, on a
// throwaway workspace. Seeds the cards of a plan file, makes the plan's custom decks,
// then measures every rendered card: equation errors, text or equations running past
// the edge, and the counts on Home. Screenshots of Home, a custom deck, a deck list and
// the study card. The plan file holds card text: the caller deletes it afterwards.
//   node tests/probes/flashcards-render-probe.mjs <plan.json> <outDir> [studyCardId ...]
// plan.json: { cards: [{ id, deck, front, back, tags: [] }], decks: [{ name, tag, count }] }
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const planPath = process.argv[2];
const outDir = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), 'parallx-fc-render'));
const studyIds = process.argv.slice(4).map(Number).filter(Boolean);
if (!planPath) { console.error('usage: flashcards-render-probe.mjs <plan.json> <outDir> [studyCardId ...]'); process.exit(2); }

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1'; env.PARALLX_RENDERER_PORT = '0'; env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot; env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-fcrender-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-fcrender-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Flashcards render probe\n');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* fine */ }
  return { appRoot, workspace };
}
async function runCommand(page, commandId, ...args) {
  return page.evaluate(async ({ commandId, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
    if (!svc?.executeCommand) return false;
    try { await svc.executeCommand(commandId, ...args); return true; } catch (e) { return String(e); }
  }, { commandId, args });
}
async function tool(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ILanguageModelToolsService' });
    const t = svc?.getTool?.(name) ?? svc?.getTool?.(name.replace(/\./g, '_'));
    if (!t) return { content: `tool ${name} not registered`, isError: true };
    try { return await t.handler(args, undefined); } catch (e) { return { content: String(e), isError: true }; }
  }, { name, args });
}
/** Every rendered card text under `selector`: equation errors and anything wider than its box. */
async function measure(page, selector) {
  return page.$$eval(selector, (els) => els.map((el) => {
    const row = el.closest('[data-card-id], .fc-cardrow, .fc-card') || el;
    const box = el.getBoundingClientRect();
    const wide = [];
    el.querySelectorAll('.px-markdown__math, .katex-display, table, pre').forEach((m) => {
      const r = m.getBoundingClientRect();
      if (r.width > 0 && r.right > box.right + 2) wide.push(Math.round(r.right - box.right));
    });
    const scrolls = getComputedStyle(el).overflowX !== 'visible' || [...el.querySelectorAll('.px-markdown, .px-markdown__math--display')].some((x) => /auto|scroll/.test(getComputedStyle(x).overflowX));
    return {
      id: row.querySelector('.fc-cardrow__id, .fc-card__id')?.textContent || row.dataset?.cardId || '',
      errors: el.querySelectorAll('.katex-error').length,
      math: el.querySelectorAll('.px-markdown__math').length,
      pastEdge: wide.length ? Math.max(...wide) : 0,
      cut: el.scrollWidth > el.clientWidth + 2 && !scrolls,
      height: Math.round(box.height),
    };
  }));
}

async function main() {
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace } = await makeRoots();
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  let failures = 0;
  const check = (label, ok, detail) => { console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ' :: ' + String(detail).slice(0, 300) : ''}`); if (!ok) failures++; };
  const shot = async (page, name) => {
    const file = path.join(outDir, name);
    await page.waitForTimeout(700);
    try { await page.screenshot({ path: file, timeout: 8_000 }); }
    catch {
      const out = await app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed());
        if (!w) return null;
        return (await w.webContents.capturePage()).toPNG().toString('base64');
      });
      if (!out) { console.log(`[probe] no picture for ${name}`); return; }
      await fs.writeFile(file, Buffer.from(out, 'base64'));
    }
    console.log(`[probe] picture -> ${file}`);
  };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`); });
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(async () => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
      try { await svc.setEnablement('parallx-community.flashcards', true); } catch { /* reported below */ }
    });
    await page.waitForTimeout(4_000);
    await runCommand(page, 'flashcards.open');
    await page.waitForTimeout(2_500);

    // Seed, deck by deck, keeping the plan's card ids against the ids the app hands out.
    const planIdOf = new Map();
    const byDeck = new Map();
    for (const c of plan.cards) { if (!byDeck.has(c.deck)) byDeck.set(c.deck, []); byDeck.get(c.deck).push(c); }
    let seeded = 0;
    for (const [deck, cards] of byDeck) {
      for (let i = 0; i < cards.length; i += 50) {
        const chunk = cards.slice(i, i + 50);
        const res = await tool(page, 'flashcards.edit', { action: 'create', deckName: deck, cards: chunk.map((c) => ({ front: c.front, back: c.back, tags: c.tags })) });
        const ids = [...String(res.content).matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
        if (res.isError || ids.length !== chunk.length) check(`seed ${deck}`, false, res.content);
        ids.forEach((id, k) => planIdOf.set(String(id), chunk[k].id));
        seeded += ids.length;
      }
    }
    check('every card of the plan is seeded', seeded === plan.cards.length, `${seeded} of ${plan.cards.length}`);
    const planId = (appId) => planIdOf.get(String(appId).replace('#', '')) ?? appId;

    // The custom decks, made the way a person makes them.
    await runCommand(page, 'flashcards.open');
    await page.waitForSelector('.fc-deck-card__name', { timeout: 30_000 });
    for (const d of plan.decks) {
      await page.click('.fc-pane__crumbs >> text="Decks"').catch(() => {});
      await page.waitForSelector('button:has-text("New Custom Deck")', { timeout: 20_000 });
      await page.click('button:has-text("New Custom Deck")');
      await page.waitForSelector('.parallx-modal-input', { timeout: 10_000 });
      await page.fill('.parallx-modal-input', d.name);
      await page.click('.parallx-modal-btn--primary');
      await page.waitForSelector('.fc-custom', { timeout: 20_000 });
    }

    // Home.
    await page.click('.fc-pane__crumbs >> text="Decks"');
    await page.waitForSelector('.fc-deck-card--custom', { timeout: 20_000 });
    const home = await page.$$eval('.fc-deck-card--custom', (els) => els.map((el) => ({
      name: el.querySelector('.fc-deck-card__name')?.textContent,
      counts: [...el.querySelectorAll('.fc-deck-count__n')].map((n) => n.textContent),
      overflow: el.scrollWidth > el.clientWidth + 1,
    })));
    for (const d of plan.decks) {
      const row = home.find((h) => h.name === d.name);
      check(`Home shows ${d.name} with ${d.count} cards`, !!row && Number(row.counts[2]) === d.count && !row.overflow, JSON.stringify(row));
    }
    await shot(page, 'render-1-home.png');

    // Each custom deck's page.
    for (const [n, d] of plan.decks.entries()) {
      await page.click('.fc-pane__crumbs >> text="Decks"');
      await page.waitForSelector('.fc-deck-card--custom', { timeout: 20_000 });
      await page.click(`.fc-deck-card--custom:has(.fc-deck-card__name:text-is("${d.name}")) .fc-deck-card__info`);
      await page.waitForSelector('.fc-custom__card', { timeout: 20_000 });
      const rows = await measure(page, '.fc-custom__front');
      const groups = await page.$$eval('.fc-custom__group-name', (els) => els.map((e) => e.textContent));
      check(`${d.name}: page lists ${d.count} cards`, rows.length === d.count, `${rows.length} rows, ${groups.length} papers: ${groups.join(', ')}`);
      const bad = rows.filter((r) => r.errors > 0);
      check(`${d.name}: no equation errors in the list`, bad.length === 0, bad.map((r) => planId(r.id)).join(' '));
      const wide = rows.filter((r) => r.pastEdge > 0 || r.cut);
      check(`${d.name}: nothing runs past the edge in the list`, wide.length === 0, wide.map((r) => `${planId(r.id)}(+${r.pastEdge}px)`).join(' '));
      const tall = rows.filter((r) => r.height > 160);
      console.log(`[probe] ${d.name}: tallest row ${Math.max(...rows.map((r) => r.height))}px; rows over 160px: ${tall.map((r) => planId(r.id)).join(' ') || 'none'}`);
      await shot(page, `render-2-custom-${n + 1}.png`);
    }

    // Every deck's card list: fronts and backs as the app renders them.
    let listed = 0;
    const listFaults = [];
    for (const deck of byDeck.keys()) {
      await page.click('.fc-pane__crumbs >> text="Decks"');
      await page.waitForSelector('.fc-deck-card__name', { timeout: 20_000 });
      await page.click(`.fc-deck-card:not(.fc-deck-card--custom):has(.fc-deck-card__name:text-is("${deck}")) .fc-deck-card__info`);
      await page.waitForSelector('.fc-cardrow', { timeout: 20_000 });
      for (const sel of ['.fc-cardrow__front', '.fc-cardrow__back']) {
        const rows = await measure(page, sel);
        listed += rows.length;
        for (const r of rows) if (r.errors > 0 || r.pastEdge > 0 || r.cut) listFaults.push(`${planId(r.id)} ${sel.endsWith('front') ? 'front' : 'back'}${r.errors ? ' equation error' : ''}${r.pastEdge ? ` +${r.pastEdge}px` : ''}${r.cut ? ' cut' : ''}`);
      }
      if (deck === [...byDeck.keys()][0]) await shot(page, 'render-3-deck-list.png');
    }
    check('deck lists: every front and back measured', listed === plan.cards.length * 2, `${listed} of ${plan.cards.length * 2}`);
    check('deck lists: no equation errors, nothing past the edge', listFaults.length === 0, listFaults.join('; '));

    // The study card, for the cards named on the command line.
    const appIdOf = new Map([...planIdOf].map(([a, p]) => [p, a]));
    for (const id of studyIds) {
      const appId = appIdOf.get(id);
      const card = plan.cards.find((c) => c.id === id);
      if (!appId || !card) { check(`study card ${id} is in the plan`, false); continue; }
      const deckTag = card.tags.find((t) => t.startsWith('deck-'));
      const deck = plan.decks.find((d) => d.tag === deckTag);
      await page.click('.fc-pane__crumbs >> text="Decks"');
      await page.waitForSelector('.fc-deck-card__name', { timeout: 20_000 });
      if (!deck) { console.log(`[probe] card ${id} is in no custom deck: not studied here`); continue; }
      await page.click(`.fc-deck-card--custom:has(.fc-deck-card__name:text-is("${deck.name}")) .fc-deck-card__info`);
      await page.waitForSelector('.fc-custom__card', { timeout: 20_000 });
      await page.click(`.fc-custom__card[data-card-id="${appId}"] .fc-custom__front`, { position: { x: 4, y: 4 } });
      const shown = await page.waitForSelector('.fc-card__id', { timeout: 20_000 }).then((e) => e.textContent()).catch(() => null);
      check(`study shows card ${id}`, shown === `#${appId}`, shown);
      await page.keyboard.press('Space');
      await page.waitForTimeout(900);
      const faces = await page.evaluate(() => {
        const card = document.querySelector('.fc-study__col') || document.querySelector('.fc-study__main');
        const box = card.getBoundingClientRect();
        const out = { errors: card.querySelectorAll('.katex-error').length, math: card.querySelectorAll('.px-markdown__math').length, answer: !!card.querySelector('.fc-study__answer-host')?.textContent.trim(), pastEdge: 0, cardWidth: Math.round(box.width), scrollable: 0 };
        card.querySelectorAll('.px-markdown__math, .katex-display').forEach((m) => {
          const r = m.getBoundingClientRect();
          let host = m.parentElement;
          let scrolls = false;
          while (host && host !== card.parentElement) { if (/auto|scroll/.test(getComputedStyle(host).overflowX) && host.scrollWidth > host.clientWidth) scrolls = true; host = host.parentElement; }
          if (r.right > box.right + 2) { if (scrolls) out.scrollable++; else out.pastEdge = Math.max(out.pastEdge, Math.round(r.right - box.right)); }
        });
        return out;
      });
      check(`study card ${id}: the answer shows, equations render and fit`, faces.answer && faces.math > 0 && faces.errors === 0 && faces.pastEdge === 0, JSON.stringify(faces));
      await shot(page, `render-4-study-${id}.png`);
    }
  } finally {
    console.log(`[probe] renderer errors: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log('  ' + e);
    console.log(failures ? `[probe] FAILURES: ${failures}` : '[probe] all checks passed');
    await app.close().catch(() => {});
    await fs.rm(appRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}
main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
