// flashcards-custom-decks-probe.mjs — custom decks in the REAL app, hidden, on a
// throwaway workspace with made-up cards: make a custom deck from a selection in
// one deck, add a card from a second deck, see it on Home and in the sidebar,
// open it, study it, take a card out, delete it. Cards must stay in their own decks.
//   node tests/probes/flashcards-custom-decks-probe.mjs <outDir>
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-fc-custom'));

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1'; env.PARALLX_RENDERER_PORT = '0'; env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot; env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-fccustom-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-fccustom-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Flashcards custom decks probe\n');
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
async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot, workspace } = await makeRoots();
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  // A picture is a help, not a check: a hidden window that will not paint must not stop the run.
  const shot = async (page, name) => { const f = path.join(outDir, name); try { await page.screenshot({ path: f, timeout: 8_000 }); console.log(`[probe] screenshot -> ${f}`); } catch { console.log(`[probe] no screenshot for ${name}`); } };
  let failures = 0;
  const check = (label, ok, detail) => { console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ' :: ' + String(detail).slice(0, 240) : ''}`); if (!ok) failures++; };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`); });
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    const enabled = await page.evaluate(async () => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
      if (!svc?.setEnablement) return 'no enablement service';
      try { await svc.setEnablement('parallx-community.flashcards', true); return true; } catch (e) { return String(e); }
    });
    console.log('[probe] enable flashcards ->', enabled);
    await page.waitForTimeout(4_000);
    console.log('[probe] flashcards.open ->', await runCommand(page, 'flashcards.open'));
    await page.waitForTimeout(3_000);

    const a = await tool(page, 'flashcards.edit', { action: 'create', deckName: 'Paper A', cards: [
      { front: 'Paper A: mean of the model', back: 'm = x * f', tags: ['glm'] },
      { front: 'Paper A: variance of the model', back: 'v = phi * m' },
      { front: 'Paper A: a card that is not in any custom deck', back: 'plain' },
    ] });
    const b = await tool(page, 'flashcards.edit', { action: 'create', deckName: 'Paper B', cards: [
      { front: 'Paper B: mean of the model', back: 'm = a * b' },
      { front: 'Paper B: another card left out', back: 'plain' },
    ] });
    const idsA = [...String(a.content).matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    const idsB = [...String(b.content).matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    check('seed cards made in two decks', idsA.length === 3 && idsB.length === 2, `${a.content} / ${b.content}`);

    // Home before: no custom deck section, but the button to make one.
    await runCommand(page, 'flashcards.open');
    await page.waitForSelector('.fc-deck-card__name', { timeout: 30_000 });
    check('Home has no custom deck rows before one is made', (await page.$$('.fc-deck-card--custom')).length === 0);
    check('Home offers New Custom Deck', (await page.$$('button:has-text("New Custom Deck")')).length === 1);

    // Make one from a selection in Paper A.
    await page.click('.fc-deck-card:has(.fc-deck-card__name:has-text("Paper A")) .fc-deck-card__info');
    await page.waitForSelector('.fc-cardrow', { timeout: 20_000 });
    check('the deck lists its cards', (await page.$$('.fc-cardrow')).length === 3);
    await page.click('.fc-cardrow:has-text("Paper A: mean of the model")', { position: { x: 6, y: 6 } });
    await page.click('.fc-cardrow:has-text("Paper A: variance of the model")', { position: { x: 6, y: 6 }, modifiers: ['Control'] });
    check('two rows are selected', (await page.$$('.fc-cardrow--selected')).length === 2);
    await page.waitForSelector('.fc-bulkbar button:has-text("Add To Custom Deck")', { timeout: 10_000 });
    await shot(page, 'custom-1-bulkbar.png');
    await page.click('.fc-bulkbar button:has-text("Add To Custom Deck")');
    await page.waitForSelector('.parallx-quickpick-row', { timeout: 10_000 });
    const picks = await page.$$eval('.parallx-quickpick-row', (els) => els.map((e) => e.textContent.trim()));
    check('the pick list offers a new custom deck', picks.length === 1 && picks[0].startsWith('New Custom Deck'), JSON.stringify(picks));
    await page.click('.parallx-quickpick-row');
    await page.waitForSelector('.parallx-modal-input', { timeout: 10_000 });
    await page.fill('.parallx-modal-input', 'Model Specifications');
    await page.click('.parallx-modal-btn--primary');
    await page.waitForTimeout(1_500);

    // Add one from Paper B through the tool's tag (what the apply script does to the real cards).
    const tagged = await tool(page, 'flashcards.edit', { action: 'update', ids: [idsB[0]], set: { addTags: ['deck-model-specifications'] } });
    check('a card from a second deck joins by tag', !tagged.isError, tagged.content);

    // Home after.
    await page.click('.fc-pane__crumbs >> text="Decks"');
    await page.waitForSelector('.fc-deck-card--custom', { timeout: 20_000 });
    const home = await page.$eval('.fc-deck-card--custom', (el) => ({
      name: el.querySelector('.fc-deck-card__name')?.textContent,
      counts: [...el.querySelectorAll('.fc-deck-count__n')].map((n) => n.textContent),
      buttons: [...el.querySelectorAll('button')].map((x) => x.textContent.trim()).filter(Boolean),
      cols: getComputedStyle(el).gridTemplateColumns,
    }));
    check('Home shows the custom deck with its counts', home.name === 'Model Specifications' && home.counts.join() === '3,0,3', JSON.stringify(home));
    check('Home row has Study and Study All', home.buttons.join() === 'Study,Study All', JSON.stringify(home.buttons));
    const paperA = await page.$eval('.fc-deck-card:not(.fc-deck-card--custom):has(.fc-deck-card__name:has-text("Paper A"))', (el) => [...el.querySelectorAll('.fc-deck-count__n')].map((n) => n.textContent));
    check('the cards are still counted in their own deck', paperA[2] === '3', JSON.stringify(paperA));
    const side = await page.$$eval('.fc-deck-row--custom .fc-deck-row__name', (els) => els.map((e) => e.textContent));
    check('the sidebar lists the custom deck', side.join() === 'Model Specifications', JSON.stringify(side));
    // The sidebar has to be the one showing, or every position measures as zero.
    for (const viewId of ['flashcards.decks', 'parallx-community.flashcards.flashcards.decks', 'parallx-community.flashcards.decks']) {
      await runCommand(page, 'workbench.view.show', viewId);
      await page.waitForTimeout(600);
      const shown = await page.evaluate(() => (document.querySelector('.fc-deck-row--custom')?.getBoundingClientRect().width || 0) > 0);
      if (shown) break;
    }
    const measureRows = () => page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }; };
      const custom = document.querySelector('.fc-deck-row--custom');
      const plain = document.querySelector('.fc-deck-row:not(.fc-deck-row--custom)');
      const rights = (row) => [...row.querySelectorAll('.fc-deck-row__counts > span')].map((x) => box(x).r);
      const mark = box(custom.querySelector('.fc-deck-row__apart'));
      const more = box(custom.querySelector('.fc-deck-row__more'));
      const name = box(custom.querySelector('.fc-deck-row__name'));
      const overlap = (p, q) => p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
      return {
        width: Math.round(document.querySelector('.fc-sidebar').getBoundingClientRect().width),
        custom: rights(custom), plain: rights(plain),
        heads: [...document.querySelectorAll('.fc-sb__columns-counts > span')].map((x) => box(x).r),
        moreRight: [box(custom.querySelector('.fc-deck-row__more')).r, box(plain.querySelector('.fc-deck-row__more')).r],
        markClear: !overlap(mark, more) && !overlap(mark, name),
      };
    });
    const setWidth = (px) => page.evaluate((w) => { const el = document.querySelector('.fc-sidebar'); el.style.width = w ? w + 'px' : ''; el.style.flex = w ? '0 0 ' + w + 'px' : ''; }, px);
    await setWidth(420);
    await page.waitForTimeout(400);
    const wide = await measureRows();
    check('sidebar, wide: a custom deck row lines its counts up with a deck row and the headings', wide.custom.every((x) => x > 0) && wide.custom.join() === wide.plain.join() && wide.custom.join() === wide.heads.join() && wide.moreRight[0] === wide.moreRight[1] && wide.markClear, JSON.stringify(wide));
    await setWidth(240);
    await page.waitForTimeout(400);
    const narrow = await measureRows();
    check('sidebar, narrow: counts line up and the Custom mark is clear of the name and the button', narrow.custom.every((x) => x > 0) && narrow.custom.join() === narrow.plain.join() && narrow.moreRight[0] === narrow.moreRight[1] && narrow.markClear, JSON.stringify(narrow));
    await setWidth(0);
    const overflow = await page.$eval('.fc-deck-card--custom', (el) => el.scrollWidth > el.clientWidth + 1);
    check('the Home row does not overflow', overflow === false);
    await shot(page, 'custom-2-home.png');

    // Its page.
    await page.click('.fc-deck-card--custom .fc-deck-card__info');
    await page.waitForSelector('.fc-custom__card', { timeout: 20_000 });
    const pageState = await page.evaluate(() => ({
      title: document.querySelector('.fc-custom .fc-view__title')?.textContent,
      crumbs: document.querySelector('.fc-pane__crumbs')?.textContent,
      groups: [...document.querySelectorAll('.fc-custom__group-name')].map((n) => n.textContent),
      cards: [...document.querySelectorAll('.fc-custom__front')].map((n) => n.textContent),
      sub: document.querySelector('.fc-custom__sub')?.textContent,
      buttons: [...document.querySelectorAll('.fc-custom .fc-row button')].map((x) => x.textContent.trim()).filter(Boolean),
    }));
    check('the page names the deck', pageState.title === 'Model Specifications' && /Model Specifications/.test(pageState.crumbs || ''), JSON.stringify(pageState));
    check('cards are grouped by the deck they live in', pageState.groups.join() === 'Paper A,Paper B' && pageState.cards.length === 3, JSON.stringify(pageState.groups));
    check('cards left out are not shown', !pageState.cards.some((c) => /left out|not in any/.test(c)), JSON.stringify(pageState.cards));
    check('the page offers both ways to study', pageState.buttons.includes('Study 3 Cards') && pageState.buttons.includes('Study All 3'), JSON.stringify(pageState.buttons));
    await shot(page, 'custom-3-page.png');

    // Study: only its cards come up.
    await page.click('.fc-custom .fc-row button:has-text("Study 3 Cards")');
    await page.waitForSelector('.fc-card__id', { timeout: 20_000 });
    const mine = new Set([idsA[0], idsA[1], idsB[0]]);
    const first = Number(String(await page.$eval('.fc-card__id', (e) => e.textContent)).replace('#', ''));
    check('the study session serves a card of the custom deck', mine.has(first), first);
    const studyCrumbs = await page.$eval('.fc-pane__crumbs', (e) => e.textContent);
    check('the study view says which custom deck', /Model Specifications/.test(studyCrumbs || ''), studyCrumbs);
    const progress = await page.evaluate(() => document.querySelector('.fc-study__progress, .fc-progress, .fc-study__count')?.textContent || '');
    console.log('[probe] study progress text ->', progress);
    await shot(page, 'custom-4-study.png');

    // The card menu lists the custom deck, ticked.
    const more = await page.$('.fc-study button[aria-label*="More"], .fc-study button[title*="More"], .fc-card__more');
    if (more) {
      await more.click();
      await page.waitForTimeout(600);
      const items = await page.$$eval('.context-menu-item, .px-menu__item, [role="menuitem"], [role="menuitemcheckbox"]', (els) => els.map((e) => e.textContent.trim()));
      check('the card menu lists the custom deck', items.some((t) => t.includes('Model Specifications')), JSON.stringify(items));
      await shot(page, 'custom-5-menu.png');
      await page.keyboard.press('Escape');
    } else {
      check('the card menu button is found', false, 'no more button matched');
    }

    // Study All: every card, as a cram.
    await page.click('.fc-pane__crumbs >> text="Decks"');
    await page.waitForSelector('.fc-deck-card--custom', { timeout: 20_000 });
    await page.click('.fc-deck-card--custom button:has-text("Study All")');
    await page.waitForSelector('.fc-card__id', { timeout: 20_000 });
    const cramFirst = Number(String(await page.$eval('.fc-card__id', (e) => e.textContent)).replace('#', ''));
    check('Study All serves a card of the custom deck', mine.has(cramFirst), cramFirst);
    await shot(page, 'custom-6-study-all.png');

    // Remove one card from the custom deck; it stays in Paper A.
    await page.click('.fc-pane__crumbs >> text="Decks"');
    await page.waitForSelector('.fc-deck-card--custom', { timeout: 20_000 });
    await page.click('.fc-deck-card--custom .fc-deck-card__info');
    await page.waitForSelector('.fc-custom__card', { timeout: 20_000 });
    await page.hover(`.fc-custom__card[data-card-id="${idsA[1]}"]`);
    await page.click(`.fc-custom__card[data-card-id="${idsA[1]}"] .fc-custom__remove`);
    await page.waitForFunction(() => document.querySelectorAll('.fc-custom__card').length === 2, null, { timeout: 10_000 }).catch(() => {});
    check('Remove takes the card off the page', (await page.$$('.fc-custom__card')).length === 2);
    const still = await tool(page, 'flashcards.query', { action: 'card', ids: [idsA[1]] });
    check('the removed card is still in its own deck', /Paper A/.test(String(still.content)) && !/deck-model-specifications/.test(String(still.content)), still.content);

    // Delete the custom deck from its row menu; the cards stay.
    await page.click('.fc-pane__crumbs >> text="Decks"');
    await page.waitForSelector('.fc-deck-card--custom', { timeout: 20_000 });
    await page.click('.fc-deck-card--custom button[aria-label^="Actions for"]');
    await page.waitForTimeout(500);
    await page.click('text="Delete Custom Deck"');
    await page.waitForSelector('.parallx-modal-box', { timeout: 10_000 });
    await shot(page, 'custom-7-delete.png');
    await page.click('.parallx-modal-btn--primary, .parallx-modal-btn--danger');
    await page.waitForFunction(() => document.querySelectorAll('.fc-deck-card--custom').length === 0, null, { timeout: 10_000 }).catch(() => {});
    check('the custom deck is gone from Home', (await page.$$('.fc-deck-card--custom')).length === 0);
    const kept = await tool(page, 'flashcards.query', { action: 'card', ids: [idsA[0], idsB[0]] });
    check('its cards are kept, in their decks, without the tag', /Paper A/.test(String(kept.content)) && /Paper B/.test(String(kept.content)) && !/deck-model-specifications/.test(String(kept.content)) && /glm/.test(String(kept.content)), kept.content);
    const totals = await page.$$eval('.fc-deck-card:not(.fc-deck-card--custom)', (els) => els.map((el) => [el.querySelector('.fc-deck-card__name')?.textContent, [...el.querySelectorAll('.fc-deck-count__n')].map((n) => n.textContent)[2]].join(':')));
    check('both decks hold every card they had', totals.includes('Paper A:3') && totals.includes('Paper B:2'), JSON.stringify(totals));
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
