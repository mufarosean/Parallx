// database-title-width-probe.mjs — a database's Name column keeps the width
// it is given, however long a row's title. Before, the table was laid out by
// its content (width: max-content), so the Name column grew to the longest
// title and its grip could not make it narrower; the other columns were off
// to the right. Now: the column opens at its default width, a drag on its
// grip makes it narrower and it stays so, and a title longer than the column
// ends in an ellipsis.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/database-title-width-probe.mjs [outDir]
import path from 'node:path';
import fs from 'node:fs/promises';
import { PROJECT_ROOT, launchApp, cmd } from './scene.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'db-title-'));
const shots = path.join(outDir, 'shots');
const appRoot = path.join(outDir, 'app');
const ws = path.join(outDir, 'workspace');
for (const d of [shots, path.join(appRoot, 'data'), ws]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };

const { app, page, errors } = await launchApp(appRoot);
try {
  const LONG = 'For by these things and others like them the body is strengthened and becomes capable of enduring hardship, sturdy and ready for any task; the soul too is strengthened since it is trained for courage.';
  const id = await page.evaluate(async (long) => {
    const tools = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' });
    const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
    const made = String((await tools.getTool('canvas_create_database').handler({ title: 'Quotes', properties: [{ name: 'Author', type: 'text' }] }, token))?.content || '');
    const id = (/id: ([0-9a-f-]{20,})/i.exec(made) || [])[1];
    if (!id) return null;
    const add = tools.getTool('canvas_add_database_row');
    await add.handler({ databaseId: id, title: long, values: { Author: 'Marcus Aurelius' } }, token);
    await add.handler({ databaseId: id, title: 'Cast away opinion: thou art saved.', values: { Author: 'Marcus Aurelius' } }, token);
    return id;
  }, LONG);
  check('a database with a long title is made', !!id, id);
  await cmd(page, 'canvas.openPage', id); await page.waitForTimeout(2_000);

  const read = () => page.evaluate(() => {
    const th = Array.from(document.querySelectorAll('.canvas-db-th--title')).find((e) => e.getClientRects().length);
    const author = th?.parentElement?.children[1];
    const text = Array.from(document.querySelectorAll('.canvas-db-cell__titletext')).find((e) => e.getClientRects().length && e.textContent.length > 100);
    return {
      title: th ? Math.round(th.getBoundingClientRect().width) : null,
      authorX: author ? Math.round(author.getBoundingClientRect().left) : null,
      paneRight: Math.round(document.querySelector('.canvas-db-scroll')?.getBoundingClientRect().right ?? 0),
      cut: text ? text.scrollWidth > text.clientWidth && getComputedStyle(text).textOverflow === 'ellipsis' : null,
      grip: th ? (() => { const r = th.querySelector('.canvas-db-resize').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })() : null,
    };
  });
  const first = await read();
  check('the Name column opens at its default width (280), not the longest title\'s', first.title === 280, first);
  check('the next column is in view', first.authorX !== null && first.authorX < first.paneRight, first);
  check('the long title is cut with an ellipsis', first.cut === true, first);

  // Drag the grip 120 px to the left.
  await page.mouse.move(first.grip.x, first.grip.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(first.grip.x - 20 * i, first.grip.y); await page.waitForTimeout(30); }
  await page.mouse.up(); await page.waitForTimeout(1_000);
  const narrower = await read();
  check('dragging the grip makes the Name column narrower, and it stays (160)', narrower.title === 160, narrower);
  check('and the title is still cut with an ellipsis', narrower.cut === true, narrower);

  // The keys: Make Focused Area Narrower (Ctrl+Alt+Shift+Left) on the focused header narrows it, down to its floor (120).
  await page.evaluate(() => Array.from(document.querySelectorAll('.canvas-db-th--title')).find((e) => e.getClientRects().length)?.focus());
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Control+Alt+Shift+ArrowLeft'); await page.waitForTimeout(150); }
  await page.waitForTimeout(600);
  const keys = await read();
  check('the keys narrow it too, to no less than 120', keys.title !== null && keys.title <= narrower.title && keys.title >= 120, keys);

  await page.mouse.move(700, 600);
  await page.screenshot({ path: path.join(shots, 'database-title-width.png') }).catch(() => {});
} finally {
  if (errors.length) console.log(`[probe] page errors: ${errors.length}\n  ${errors.slice(0, 3).join('\n  ')}`);
  console.log(`[probe] ${problems.length} problems${problems.length ? `: ${problems.join('; ')}` : ''}`);
  console.log(`[probe] shots: ${shots}`);
  await app.close().catch(() => {});
  process.exitCode = problems.length ? 1 : 0;
}
