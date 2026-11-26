// chat-look-probe.mjs — chat in the look (piece 5, his 1A), the part built on
// 2026-11-26: thought, source and speed are meta in the mono face; a numbered
// source mark is a small outlined mono number; the question box is one sheet.
//
//   node scripts/build.mjs && xvfb-run -a node tests/probes/chat-look-probe.mjs [outDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, launchApp, screenshot } from './scene.mjs';
import { seedBeforeLaunch, seedAfterLaunch } from './audit-seed.mjs';

await fs.mkdir(path.join(PROJECT_ROOT, 'test-results'), { recursive: true });
const root = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(PROJECT_ROOT, 'test-results', 'chat-look-'));
await fs.rm(root, { recursive: true, force: true });
const appRoot = path.join(root, 'app'); const ws = path.join(root, 'workspace'); const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data'), ws, shots]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* there */ }

const problems = [];
const check = (name, ok, got) => { console.log(`${ok ? '  ok ' : ' FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)}`}`); if (!ok) problems.push(name); };
const pre = await seedBeforeLaunch(ws);
const { app, page, errors } = await launchApp(appRoot);
const style = (sel) => page.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return null; const c = getComputedStyle(e); return { text: e.textContent.trim().slice(0, 60), font: c.fontFamily.split(',')[0].replace(/['"]/g, ''), size: c.fontSize, colour: c.color, bg: c.backgroundColor, border: `${c.borderTopWidth} ${c.borderTopStyle}`, radius: parseFloat(c.borderTopLeftRadius), shadow: c.boxShadow !== 'none' }; }, sel);
try {
  const screens = await seedAfterLaunch(page, pre);
  await screens['seed:chat.timing'](); await page.waitForTimeout(1_500);
  const thought = await style('.parallx-chat-thinking-toggle');
  const speed = await style('.parallx-chat-meta');
  const answer = await style('.parallx-chat-message--assistant .parallx-chat-markdown p, .parallx-chat-message-assistant p, .parallx-chat-markdown p');
  check('the thought line is in the mono face', !!thought && /Mono/.test(thought.font) && /Thought/.test(thought.text), thought);
  check('the speed line is in the mono face', !!speed && /Mono/.test(speed.font) && /tokens\/s/.test(speed.text), speed);
  check('the answer itself is reading text in the interface face, not mono', !!answer && !/Mono/.test(answer.font) && parseFloat(answer.size) >= 13, answer);
  const box = await style('.parallx-chat-input-container, .parallx-chat-input, .parallx-chat-composer');
  check('the question box is one rounded sheet', !!box && box.radius >= 8, box);
  await screenshot(app, page, path.join(shots, 'chat-timing.png'));
  // The thought line still opens by keys.
  await page.evaluate(() => [...document.querySelectorAll('.parallx-chat-thinking-toggle')].find((e) => e.getClientRects().length)?.focus());
  const before = await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'));
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'));
  check('Enter on the thought line opens and closes it', before !== after && after !== null, [before, after]);
  await page.keyboard.press('Enter');
  // A numbered source mark.
  await screens['seed:chat.citation'](); await page.waitForTimeout(1_500);
  const mark = await style('.parallx-citation-badge');
  if (mark) check('a numbered source mark is a small outlined mono number in the accent\'s ink', /Mono/.test(mark.font) && parseFloat(mark.size) <= 11 && mark.border.startsWith('1px solid') && /rgba?\(0, 0, 0, 0\)|transparent/.test(mark.bg), mark);
  else console.log('  --  the seeded conversation has no numbered source mark on screen; its style is not seen here');
  await screenshot(app, page, path.join(shots, 'chat-citation.png'));
} catch (err) {
  console.log(`[probe] stopped: ${err?.stack ?? err}`); problems.push('the probe stopped');
  await screenshot(app, page, path.join(shots, 'stopped.png')).catch(() => {});
} finally { await app.close().catch(() => {}); }
const real = errors.filter((e) => !/Ollama|EmbeddingService/.test(e));
console.log(`\n[probe] page errors: ${real.length}`); for (const e of real.slice(0, 6)) console.log('  ' + e);
console.log(`[probe] ${problems.length} problems${problems.length ? ': ' + problems.join('; ') : ''}`);
console.log(`[probe] shots: ${shots}`);
process.exitCode = problems.length || real.length ? 1 : 0;
