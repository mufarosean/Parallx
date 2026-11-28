// flashcards-pages-probe.mjs — Flashcards' Decks page opens on the day's work
// and its Stats page on four numbers that mean something (the look's piece 10).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/flashcards-pages-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, screenshot, setToolEnabled } from './scene.mjs';
import { seedBeforeLaunch, seedAfterLaunch } from './audit-seed.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'flashcards-pages-'));
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), ws, shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
const pre = await seedBeforeLaunch(ws);
const { app, page, errors } = await launchApp(appRoot);
const font = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); return e ? `${getComputedStyle(e).fontFamily.split(',')[0].replace(/['"]/g, '')} ${getComputedStyle(e).fontSize}` : null; }, sel);
const texts = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((x) => x.getClientRects().length).map((x) => x.textContent.trim().replace(/\s+/g, ' ')), sel);
const menu = () => page.evaluate(() => [...document.querySelectorAll('[data-px-surface="contextMenu"] [role="menuitem"]')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()));
try {
  await setToolEnabled(page, 'parallx-community.flashcards', true); await page.waitForTimeout(2_500);
  await seedAfterLaunch(page, pre);
  // A deck with cards, made through the tool's own commands and its own database.
  const made = await page.evaluate(async () => {
    const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
    try { return await svc.executeCommand('flashcards.addCards', { deckName: 'Probe Deck', cards: [{ front: 'One', back: '1' }, { front: 'Two', back: '2' }, { front: 'Three', back: '3' }] }); } catch (e) { return String(e?.message || e); }
  });
  await cmd(page, 'flashcards.open'); await page.waitForTimeout(1_800);
  // The page's title is the kit's page header since piece 6 of Getting around (it was .fc-home__title).
  const HOME_TITLE = '.fc-home__head .px-page-header__title';
  const title = (await texts(HOME_TITLE))[0] ?? '';
  const sub = (await texts('.fc-home__sub'))[0] ?? '';
  const due = (await texts('.fc-home__due'))[0] ?? '';
  check('the page has decks to show', /^[1-9]\d* decks? · \d+ cards?/.test(sub), { sub, made });
  check('its title is the day\'s work, in the display face', /^(\d+ cards? due today|Nothing due right now)$/.test(title) && /^Newsreader/.test(await font(HOME_TITLE)), [title, await font(HOME_TITLE)]);
  check('under it, the split in words', /^(About \d+ min\. )?\d+ new, \d+ learning, \d+ to review\./.test(due), due);
  const n = Number((title.match(/^(\d+)/) || [])[1] || 0);
  const buttons = await texts('.fc-home__head button');
  check('the masthead has Stats, Custom Study…, Add and one primary Study button', buttons.join('|') === ['Stats', 'Custom Study…', 'Add', n > 0 ? `Study ${n} ${n === 1 ? 'Card' : 'Cards'}` : 'Nothing Due Right Now'].join('|') && await page.evaluate(() => document.querySelectorAll('.fc-home__head .fc-btn--primary').length === 1), buttons);
  check('the row of five making-and-importing buttons is gone', (await texts('.fc-home__actions button')).length === 0, await texts('.fc-home__actions button'));
  // The Add menu, by keys.
  await page.evaluate(() => [...document.querySelectorAll('.fc-home__head button')].find((b) => b.textContent.trim() === 'Add')?.focus());
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  const items = await menu();
  check('Add opens a menu: New Deck…, New Custom Deck…, Generate Cards, Import Cards, Exam Dates…', items.join('|') === 'New Deck…|New Custom Deck…|Generate Cards|Import Cards|Exam Dates…', items);
  await screenshot(app, page, path.join(shots, 'decks-add-menu.png'), { keepFocus: true });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // A deck's row.
  const rows = await page.evaluate(() => [...document.querySelectorAll('.fc-home__decks:not(.fc-home__decks--custom) .fc-deck-card')].filter((x) => x.getClientRects().length).map((c) => ({ name: c.querySelector('.fc-deck-card__name')?.firstChild?.textContent, words: c.querySelector('.fc-deck-card__words')?.textContent.trim(), bar: c.querySelector('.fc-deck-bar')?.getAttribute('aria-label'), barH: c.querySelector('.fc-deck-bar')?.getBoundingClientRect().height, segs: c.querySelectorAll('.fc-deck-bar__seg').length, study: c.querySelector('.fc-deck-card__actions button')?.textContent.trim() })));
  check('each deck is a row with its counts in words', rows.length > 0 && rows.every((r) => /^(nothing due · |\d+ new · \d+ learning · \d+ review · )\d+ cards?$/.test(r.words)), rows.map((r) => r.words));
  check('and one thin bar, named for a screen reader with its three counts', rows.every((r) => r.barH <= 8 && /: \d+ new, \d+ learning, \d+ to review, of \d+ cards$/.test(r.bar || '')), rows.map((r) => [r.barH, r.bar]));
  const probeDeck = rows.find((r) => r.name === 'Probe Deck');
  check('a deck with three new cards says so, and its bar has a new part', !probeDeck || (probeDeck.words === '3 new · 0 learning · 0 review · 3 cards' && probeDeck.segs === 1), probeDeck);
  check('the bar\'s colours are named under the list', (await texts('.fc-home__legend span')).join('|') === 'new|learning|review', await texts('.fc-home__legend span'));
  await screenshot(app, page, path.join(shots, 'decks.png'));
  // Study from the masthead starts a session; back to Decks.
  if (n > 0) {
    await page.evaluate(() => document.querySelector('.fc-home__head .fc-btn--primary')?.click()); await page.waitForTimeout(1_200);
    check('the primary button starts a study session', await page.evaluate((sel) => !document.querySelector(sel)?.getClientRects().length && !!document.querySelector('.fc-study')?.getClientRects().length, HOME_TITLE), null);
    await cmd(page, 'flashcards.open'); await page.waitForTimeout(800);
    await page.evaluate(() => [...document.querySelectorAll('.fc-sb__nav-item')].find((b) => b.getAttribute('data-view') === 'decks')?.click()); await page.waitForTimeout(900);
  }
  // Stats.
  await page.evaluate(() => [...document.querySelectorAll('.fc-home__head button')].find((b) => b.textContent.trim() === 'Stats')?.click()); await page.waitForTimeout(1_200);
  const labels = await texts('.fc-stat__label');
  const values = await texts('.fc-stat__value');
  check('Stats opens on four numbers, each with its unit in words', labels.length === 4 && /^reviews? today$/.test(labels[0]) && labels[1] === 'today' && labels[2] === 'in a row' && /^right, last 30 days/.test(labels[3]) && /^\d+$/.test(values[0]) && /^\d+ min$/.test(values[1]) && /^\d+ days?$/.test(values[2]), { labels, values });
  check('the numbers are in the display face, 34 px', (await font('.fc-stat__value')) === 'Newsreader 34px', await font('.fc-stat__value'));
  check('Cards by stage is not on the page', !(await texts('.fc-label')).includes('Cards by stage'), await texts('.fc-label'));
  const heads = await texts('.fc-chart-head');
  check('two bar charts, each with its total: reviews done, cards coming due', heads.length === 2 && /^Reviews, last 30 days ?\d+$/.test(heads[0]) && /^Due, next 14 days ?\d+$/.test(heads[1]) && await page.evaluate(() => document.querySelectorAll('.fc-chart').length === 2 && document.querySelectorAll('.fc-chart__bar--done').length === 30 && document.querySelectorAll('.fc-chart__bar--forecast').length === 14), heads);
  await screenshot(app, page, path.join(shots, 'stats.png'));
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); problems.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app.close().catch(() => {}); }
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length || real.length ? 1 : 0;
