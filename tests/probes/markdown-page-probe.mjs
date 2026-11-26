// markdown-page-probe.mjs — a Markdown file opens as the page it describes,
// and Edit Source opens its text beside the page, which follows what is
// typed (the look's piece 6, second half).
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/markdown-page-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, cmd, openFile, screenshot, setToolEnabled } from './scene.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'markdown-page-'));
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), path.join(ws, 'Readings'), shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }
const file = path.join(ws, 'Readings', 'clark-notes.md');
await fs.writeFile(file, '# Clark notes\n\nThe growth curve models the share of ultimate losses emerged by age.\n\n- Loglogistic\n- Weibull\n');
await fs.writeFile(path.join(ws, 'plain.txt'), 'A text file.\n');

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
const { app, page, errors } = await launchApp(appRoot);
const read = () => page.evaluate(() => {
  const groups = [...document.querySelectorAll('.editor-group')].filter((g) => g.getClientRects().length).map((g) => {
    const pageEl = g.querySelector('.markdown-editor-pane'); const src = g.querySelector('.text-editor-pane textarea, .code-editor-pane .cm-content, .code-editor-pane [contenteditable="true"], textarea');
    return { x: Math.round(g.getBoundingClientRect().x), tab: g.querySelector('.ui-tab--active .ui-tab-label')?.textContent ?? null,
      page: pageEl && pageEl.getClientRects().length ? { h1: pageEl.querySelector('.markdown-content h1')?.textContent ?? null, items: [...pageEl.querySelectorAll('.markdown-content li')].map((li) => li.textContent), head: pageEl.querySelector('.markdown-page-head__file')?.textContent ?? null, edit: !!pageEl.querySelector('[data-px-id="markdown.editSource"]'), raw: /^#\s/m.test(pageEl.querySelector('.markdown-content')?.textContent ?? '') } : null,
      source: src && src.getClientRects().length ? (src.value ?? src.textContent ?? '').slice(0, 80) : null };
  });
  return { groups, focus: document.activeElement?.tagName };
});
try {
  await openFile(page, 'clark-notes.md'); await page.waitForTimeout(1_500);
  let v = await read();
  const g0 = v.groups[0];
  check('the file opens as a page: its heading and list drawn, not its source', v.groups.length === 1 && g0.page?.h1 === 'Clark notes' && g0.page.items.join('|') === 'Loglogistic|Weibull' && !g0.page.raw && g0.source === null, v);
  check('its tab carries the file\'s own name', g0.tab === 'clark-notes.md', g0.tab);
  check('the page\'s head names the file and its folder, and has Edit Source', g0.page.head === 'clark-notes.md · Readings' && g0.page.edit, g0.page);
  await screenshot(app, page, path.join(shots, 'markdown-page.png'));
  // Edit Source, by keys.
  await page.evaluate(() => [...document.querySelectorAll('[data-px-id="markdown.editSource"]')].find((e) => e.getClientRects().length)?.focus());
  await page.keyboard.press('Enter'); await page.waitForTimeout(1_200);
  v = await read();
  const pg = v.groups.find((g) => g.page); const sg = v.groups.find((g) => g.source !== null);
  check('Edit Source opens the text beside the page: two groups, the page at the left', v.groups.length === 2 && !!pg && !!sg && pg.x < sg.x && /^# Clark notes/.test(sg.source), v);
  // Typing in the source changes the live page.
  await page.evaluate(() => { const g = [...document.querySelectorAll('.editor-group')].filter((x) => x.getClientRects().length).find((x) => !x.querySelector('.markdown-editor-pane')?.getClientRects().length); const t = g.querySelector('textarea, .cm-content, [contenteditable="true"]'); t.focus(); });
  await page.keyboard.press('Control+End'); await page.keyboard.type('- Exponential'); await page.waitForTimeout(900);
  // (The page redraws on the next frame, and a hidden window draws a frame only when asked: the screenshot asks.)
  await screenshot(app, page, path.join(shots, 'markdown-edit-source.png'), { keepFocus: true });
  v = await read();
  check('what is typed in the source shows on the page, before any save', v.groups.find((g) => g.page)?.page.items.join('|') === 'Loglogistic|Weibull|Exponential' && !/- Exponential/.test(await fs.readFile(file, 'utf8')), v.groups.find((g) => g.page)?.page.items);
  await page.keyboard.press('Control+s'); await page.waitForTimeout(900);
  check('saving writes the file', /- Exponential/.test(await fs.readFile(file, 'utf8')), await fs.readFile(file, 'utf8'));
  // Edit Source again makes no third copy.
  await page.evaluate(() => [...document.querySelectorAll('[data-px-id="markdown.editSource"]')].find((e) => e.getClientRects().length)?.click()); await page.waitForTimeout(900);
  check('Edit Source a second time opens no second copy of the text', (await read()).groups.length === 2, (await read()).groups.length);
  // What a tool offers for the file is offered on its page: Study This Document…, with Study on.
  await setToolEnabled(page, 'parallx-community.study', true); await page.waitForTimeout(3_000);
  await page.evaluate(() => [...document.querySelectorAll('.editor-group')].filter((x) => x.getClientRects().length).find((x) => x.querySelector('.markdown-editor-pane')?.getClientRects().length)?.querySelector('.markdown-content')?.click());
  await screenshot(app, page, path.join(shots, 'markdown-more.png'));
  const more = await page.evaluate(() => { const b = [...document.querySelectorAll('.markdown-page-head .editor-more-actions')].find((e) => e.getClientRects().length && !e.hidden); if (!b) return null; b.focus(); return b.getAttribute('aria-label') || b.title; });
  check('the page\'s head has More Actions once a tool offers something for the file', more === 'More Actions', more);
  if (more) {
    await page.keyboard.press('Enter'); await page.waitForTimeout(600);
    const offered = await page.evaluate(() => [...document.querySelectorAll('.context-menu [role^="menuitem"], [role="option"]')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()));
    check('and it offers Study This Document…', offered.some((t) => /^Study This Document/.test(t)), offered);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  // (A passage asked for is brought into view on the page too: study-usable-acceptance 18.3 drives that through Study's Show Source.)
  // A text file is not affected.
  await openFile(page, 'plain.txt'); await page.waitForTimeout(1_200);
  v = await read();
  check('a .txt file still opens as text', v.groups.some((g) => g.tab === 'plain.txt' && g.page === null) && await page.evaluate(() => !![...document.querySelectorAll('.text-editor-pane, .code-editor-pane')].find((e) => e.getClientRects().length)), v.groups);
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); problems.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app.close().catch(() => {}); }
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length || real.length ? 1 : 0;
