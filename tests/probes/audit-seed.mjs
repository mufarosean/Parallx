// audit-seed.mjs: content for the accessibility audit (keyboard-audit-probe.mjs),
// so every control and every drag the app has is on screen when it is
// checked. An empty workspace shows no table to resize, no photo to crop,
// no event to move; the audit would pass them by never meeting them.
//
// Before launch: a Media Organizer library (four photos and a short video,
// made with ffmpeg, in the database the app itself would build).
// After launch: a canvas page with every common block (a table, columns, a
// callout, lists, a math block) and a cover; a concept map; a database;
// planner events (timed and all-day, today); dashboard widgets. Each seeded
// place becomes an audit screen (`seed:<name>`).
//
// Nothing here calls a model, and the audit's launch refuses the chat
// model's port.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cmd } from './scene.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const SEED = path.join(__dirname, 'tag-review-seed.cjs');

/** The Media Organizer library, written before the app opens the workspace. */
export async function seedBeforeLaunch(workspace) {
  const photos = path.join(workspace, 'photos');
  await fs.mkdir(photos, { recursive: true });
  const gen = [['boxing.jpg', 'testsrc2=size=1200x800', 1200, 800], ['card.jpg', 'testsrc2=size=1600x1200', 1600, 1200], ['fractal.jpg', 'mandelbrot=size=1200x900', 1200, 900], ['bars.jpg', 'smptehdbars=size=1280x720', 1280, 720]];
  for (const [name, src] of gen) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '1', '-q:v', '3', path.join(photos, name)], { windowsHide: true });
    if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${String(r.stderr).slice(0, 200)}`);
  }
  const video = path.join(photos, 'clip.mp4');
  const v = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '4', '-pix_fmt', 'yuv420p', video], { windowsHide: true });
  if (v.status !== 0) throw new Error(`ffmpeg clip: ${String(v.stderr).slice(0, 200)}`);
  const specPath = path.join(workspace, '.parallx', 'audit-seed-spec.json');
  await fs.mkdir(path.dirname(specPath), { recursive: true });
  await fs.writeFile(specPath, JSON.stringify(gen.map(([basename, , width, height]) => ({ basename, width, height }))));
  let seeded = null;
  for (const id of ['media-organizer', 'parallx-community.media-organizer']) {
    const db = path.join(workspace, '.parallx', 'extensions', id, 'data.db');
    const r = spawnSync(ELECTRON, [SEED, 'seed', db, photos, specPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`media seed: ${r.stderr || r.stdout}`);
    seeded = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  }
  return { photoId: seeded.photo['fractal.jpg'], video };
}

/** Runs a command and returns what it returned (cmd() only says whether it ran). */
const run = (page, id, ...args) => page.evaluate(async ({ id, args }) => {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ICommandService' });
  try { return await svc.executeCommand(id, ...args); } catch (e) { return `failed: ${String(e?.message || e).slice(0, 160)}`; }
}, { id, args });

/** The editor of the canvas page on screen. */
const insertBlocks = (page, blocks) => page.evaluate((blocks) => {
  const ed = Array.from(document.querySelectorAll('[data-px-surface="canvas"] [contenteditable="true"]')).filter((x) => x.offsetParent).map((x) => x.editor).find(Boolean);
  if (!ed) return 'no editor';
  const refused = [];
  for (const b of blocks) {
    try { if (!ed.commands.insertContentAt(ed.state.doc.content.size, b)) refused.push(b.type); } catch { refused.push(b.type); }
  }
  return refused.length ? `refused: ${refused.join(', ')}` : 'ok';
}, blocks);

const text = (t) => ({ type: 'text', text: t });
const para = (t) => ({ type: 'paragraph', content: [text(t)] });
const row = (cells, cell = 'tableCell') => ({ type: 'tableRow', content: cells.map((c) => ({ type: cell, content: [para(c)] })) });

/** The seeded places, made in the running app. Returns the audit screens that open them. */
export async function seedAfterLaunch(page, pre) {
  const log = (what, r) => console.log(`[seed] ${what}: ${typeof r === 'string' ? r : JSON.stringify(r)}`);

  // A canvas page with the common blocks and a cover.
  await cmd(page, 'canvas.newPage');
  await page.waitForTimeout(1_500);
  const pageId = await page.evaluate(() => {
    const s = Array.from(document.querySelectorAll('[data-px-surface="canvas"]')).find((e) => e.getClientRects().length);
    return s ? (s.getAttribute('data-px-instance') || '').split(':').pop() || null : null; // the surface's instance ends with the page id
  });
  log('canvas page', pageId);
  log('canvas blocks', await insertBlocks(page, [
    { type: 'heading', attrs: { level: 2 }, content: [text('Seeded page')] },
    { type: 'paragraph', content: [text('A paragraph with '), { type: 'text', marks: [{ type: 'bold' }], text: 'bold' }, text(' text.')] },
    { type: 'table', content: [row(['Name', 'Value'], 'tableHeader'), row(['Alpha', '1']), row(['Beta', '2'])] },
    { type: 'columnList', content: [{ type: 'column', content: [para('Left column')] }, { type: 'column', content: [para('Right column')] }] },
    { type: 'callout', content: [para('A callout')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [para('One')] }, { type: 'listItem', content: [para('Two')] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [para('A task')] }] },
    { type: 'mathBlock', attrs: { latex: 'x^2 + y^2' } },
    para('The end.'),
  ]));
  log('cover', await page.evaluate(() => { const b = Array.from(document.querySelectorAll('[data-px-id="canvas.page.addCover"]')).find((x) => x.isConnected); if (!b) return 'no Add Cover'; b.click(); return 'ok'; }));
  await page.waitForTimeout(1_000);

  // A concept map, the way chat sends one (its own page).
  const mapId = await run(page, 'canvas.saveConceptMap', 'Reserving\n  Chain Ladder\n    Mack\n  Bornhuetter\n  Cape Cod', 'right');
  log('concept map', mapId);

  // A database.
  await run(page, 'canvas.newDatabase');
  await page.waitForTimeout(1_500);
  const dbId = await page.evaluate(() => { const s = Array.from(document.querySelectorAll('[data-px-surface]')).find((e) => e.getClientRects().length && /database|canvas/.test(e.getAttribute('data-px-surface') || '') && e.getAttribute('data-px-instance')); return s ? (s.getAttribute('data-px-instance') || '').split(':').pop() || null : null; });
  log('database', dbId);

  // Planner events: one timed and one all-day, today.
  log('planner events', await page.evaluate(async () => {
    const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
    const reg = await svc.executeCommand('planner.getRegistry');
    if (!reg?.data) return 'no planner data';
    const d = new Date(); d.setHours(10, 0, 0, 0);
    await reg.data.createEvent({ title: 'Seeded meeting', startAt: d.getTime(), endAt: d.getTime() + 3_600_000 });
    const day = new Date(); day.setHours(0, 0, 0, 0);
    await reg.data.createEvent({ title: 'Seeded day', startAt: day.getTime(), endAt: day.getTime() + 86_400_000 - 1, allDay: true });
    return 'ok';
  }));

  // Dashboard widgets: the picker's first template.
  await cmd(page, 'dashboard.open');
  await page.waitForTimeout(1_500);
  await cmd(page, 'dashboard.addWidget');
  await page.waitForTimeout(800);
  log('dashboard widgets', await page.evaluate(() => { const t = Array.from(document.querySelectorAll('.dashboard-picker__template')).find((x) => x.getClientRects().length); if (!t) return 'no template'; t.click(); return 'ok'; }));
  await page.waitForTimeout(1_500);
  await page.keyboard.press('Escape');

  // Painting Plans: the art tools on and one plan on the seeded photo.
  await page.evaluate(async () => { await window.__parallx_workbench__._services.get({ id: 'IConfigurationService' }).getConfiguration('mediaOrganizer').update('enableArtTools', true); });
  await page.waitForTimeout(1_000);
  log('plan', await run(page, 'media-organizer.planPainting', pre.photoId));
  await page.waitForTimeout(2_000);
  log('variation', await run(page, 'media-organizer.plan.saveVariation'));
  await page.waitForTimeout(800);
  // Its board, with a variation, its palette and a note on it.
  await run(page, 'media-organizer.openBoard', 1);
  await page.waitForTimeout(2_000);
  for (const [c, ...a] of [['media-organizer.board.addVariation', 1], ['media-organizer.board.addPalette', 1], ['media-organizer.board.addNote']]) { await run(page, c, ...a); await page.waitForTimeout(600); }
  const planTool = (label, then) => async () => {
    await run(page, 'media-organizer.paintingPlans');
    await page.waitForTimeout(1_200);
    await page.locator('.mo-plans-card').first().click().catch(() => {});
    await page.waitForTimeout(2_000);
    if (label) await page.locator(`.mo-plan-step[aria-label="${label}"]`).first().click().catch(() => {});
    await page.waitForTimeout(800);
    if (then) await then();
  };
  const PLAN_TOOLS = ['Compose', 'Photo', 'Values', 'Colour', 'Transfer'];

  return {
    'seed:plans': async () => { await run(page, 'media-organizer.paintingPlans'); },
    'seed:plan.board': async () => { await run(page, 'media-organizer.openBoard', 1); },
    ...Object.fromEntries(PLAN_TOOLS.map((t) => [`seed:plan.${t}`, planTool(t)])),
    'seed:plan.beforeAfter': planTool('Values', async () => { await page.locator('[data-px-id="media-organizer.plan.toggleBeforeAfter"]').first().click().catch(() => {}); await page.waitForTimeout(800); }),
    'seed:plan.notes': planTool('Compose', async () => { await page.locator('[data-px-id="media-organizer.plan.toggleNotes"]').first().click().catch(() => {}); await page.waitForTimeout(800); }),
    'seed:plan.myPaints': planTool('Colour', async () => { await page.locator('.mo-plan-panel button', { hasText: 'My Paints' }).first().click().catch(() => {}); await page.waitForTimeout(800); }),
    'seed:page': async () => { if (pageId) await run(page, 'canvas.openPage', pageId); },
    'seed:database': async () => { if (dbId) await run(page, 'canvas.openPage', dbId); },
    'seed:conceptMap': async () => { if (typeof mapId === 'string' && !mapId.startsWith('failed')) await run(page, 'canvas.openPage', mapId); },
    'seed:imageEditor': async () => { await run(page, 'media-organizer.editImage', pre.photoId); },
    // A mask made from the keyboard (its menu: Brush, Linear Gradient, Radial Gradient).
    'seed:imageEditor.masks': async () => { await run(page, 'media-organizer.editImage', pre.photoId); await page.waitForTimeout(2_500); await page.locator('[data-px-id="media-organizer.imageEditor.tool.masks"]:visible').first().click().catch(() => {}); await page.waitForTimeout(600); await page.locator('[data-px-id="media-organizer.imageEditor.masks.new"]:visible').first().click().catch(() => {}); for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(1_200); }, // Linear Gradient
    // a model's part with no model fetched yet: its set-up card
    'seed:imageEditor.masks.subject': async () => { await run(page, 'media-organizer.editImage', pre.photoId); await page.waitForTimeout(2_500); await page.locator('[data-px-id="media-organizer.imageEditor.tool.masks"]:visible').first().click().catch(() => {}); await page.waitForTimeout(600); await page.locator('[data-px-id="media-organizer.imageEditor.masks.new"]:visible').first().click().catch(() => {}); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(2_500); },
    'seed:plan.masks': planTool('Photo', async () => { await page.locator('[data-px-id="media-organizer.plan.masks.new"]:visible').first().click().catch(() => {}); for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(1_500); }), // Radial Gradient
    'seed:plan.masks.words': planTool('Photo', async () => { await page.locator('[data-px-id="media-organizer.plan.masks.new"]:visible').first().click().catch(() => {}); for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(2_500); }),
    'seed:clipEditor': async () => { await run(page, 'media-organizer.openClipEditor', pre.video); },
  };
}
