// flashcards-ids-probe.mjs — card ids in the REAL app, hidden, on a throwaway
// workspace: create cards through the chat tool, find / read / edit / delete
// them by #id through the tools, then look for the id chips on the deck's
// card list and on the study card. Screenshots + every renderer error.
//   node tests/probes/flashcards-ids-probe.mjs <outDir>
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-fc-ids'));

function launchEnv(appRoot) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  env.PARALLX_TEST_MODE = '1'; env.PARALLX_RENDERER_PORT = '0'; env.PARALLX_HIDDEN_PROBE = '1';
  env.PARALLX_APP_ROOT = appRoot; env.PARALLX_USER_DATA = path.join(appRoot, 'data', 'chromium-cache');
  return env;
}
async function makeRoots() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-fcids-root-${stamp}`);
  const workspace = path.join(os.tmpdir(), `parallx-fcids-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Flashcards id probe\n');
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
    // The chat bridge registers extension tools with dots turned into underscores.
    const t = svc?.getTool?.(name) ?? svc?.getTool?.(name.replace(/\./g, '_'));
    if (!t) { const names = (svc?.getTools?.() || []).map((x) => x.name).filter((n) => /flash/i.test(n)); return { content: `tool ${name} not registered; flashcard tools: ${names.join(', ') || 'none'}`, isError: true }; }
    try { return await t.handler(args, undefined); } catch (e) { return { content: String(e), isError: true }; }
  }, { name, args });
}
async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const { appRoot } = await makeRoots();
  const app = await electron.launch({ args: ['.'], cwd: PROJECT_ROOT, env: launchEnv(appRoot) });
  const errors = [];
  const shot = async (page, name) => { const f = path.join(outDir, name); await page.screenshot({ path: f }); console.log(`[probe] screenshot -> ${f}`); };
  let failures = 0;
  const check = (label, ok, detail) => { console.log(`[probe] ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' :: ' + String(detail).slice(0, 200) : ''}`); if (!ok) failures++; };
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 240)}`); });
    await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { state: 'attached', timeout: 90_000 });
    await page.waitForTimeout(3_000);
    // External tools start disabled in a fresh root: enable Flashcards, which activates it.
    const enabled = await page.evaluate(async () => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
      if (!svc?.setEnablement) return 'no enablement service';
      try { await svc.setEnablement('parallx-community.flashcards', true); return true; } catch (e) { return String(e); }
    });
    console.log('[probe] enable flashcards ->', enabled);
    await page.waitForTimeout(4_000);
    console.log('[probe] flashcards.open ->', await runCommand(page, 'flashcards.open'));
    await page.waitForTimeout(3_000);

    const created = await tool(page, 'flashcards.edit', { action: 'create', deckName: 'Probe Deck', cards: [
      { front: 'What is the BF ultimate?', back: 'Reported + (1 - p) * Prem * ELR', tags: ['bf'], importance: 80, importanceReason: 'core formula' },
      { front: 'Define IBNR', back: 'Incurred but not reported' },
      { front: 'Define IBNR losses', back: 'Losses incurred but not yet reported' },
    ] });
    const ids = [...String(created.content).matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    check('edit create returns the new ids', !created.isError && ids.length === 3, created.content);
    const [id1, id2, id3] = ids;

    const found = await tool(page, 'flashcards.query', { action: 'find', query: 'IBNR' });
    check('query find by text lists #ids', String(found.content).includes(`#${id2}`) && String(found.content).includes(`#${id3}`), found.content);
    const count = await tool(page, 'flashcards.query', { action: 'count', where: { query: 'IBNR' } });
    check('query count answers "how many on a topic"', /^2 cards about "IBNR"/.test(String(count.content)), count.content);
    const none = await tool(page, 'flashcards.query', { action: 'count', query: 'Mack variance' });
    check('query count says when a topic is not covered', /^0 cards/.test(String(none.content)), none.content);
    const got = await tool(page, 'flashcards.query', { action: 'card', ids: [`card #${id1}`] });
    check('query card reads by "#id" text', String(got.content).includes('Front:') && String(got.content).includes('Importance: 80'), got.content);
    const due = await tool(page, 'flashcards.query', { action: 'due', due: 'new' });
    check('query due lists new cards with totals', String(due.content).includes('Total: 3') && String(due.content).includes(`#${id1}`), due.content);
    const dups = await tool(page, 'flashcards.query', { action: 'duplicates', deckName: 'Probe Deck' });
    check('query duplicates finds the IBNR pair', String(dups.content).includes(`#${id2}`) && String(dups.content).includes(`#${id3}`), dups.content);
    const upd = await tool(page, 'flashcards.edit', { action: 'update', ids: [String(id1)], set: { back: 'Reported + (1 - p) * Premium * ELR (edited)', addTags: ['edited'], flag: 'red', recallMode: 'formula', rubric: ['Reported losses', 'Unreported share (optional)'] } });
    check('edit update sets every field on one card', !upd.isError && /back/.test(String(upd.content)) && /flag Red/.test(String(upd.content)), upd.content);
    const got2 = await tool(page, 'flashcards.query', { action: 'card', ids: [id1] });
    check('the edits are stored', ['(edited)', 'Tags: bf,edited', 'Flag: Red', 'Recall mode: formula', 'Unreported share (optional)'].every((t) => String(got2.content).includes(t)), got2.content);
    const bulk = await tool(page, 'flashcards.edit', { action: 'update', where: { query: 'IBNR' }, set: { addTags: ['ibnr'], importance: 40 } });
    check('edit update applies in bulk by selector', /^Updated 2 cards/.test(String(bulk.content)), bulk.content);
    const dry = await tool(page, 'flashcards.edit', { action: 'delete', where: { tag: 'ibnr' }, dryRun: true });
    check('edit dryRun previews without changing', /^Would delete 2 cards/.test(String(dry.content)), dry.content);
    const bad = await tool(page, 'flashcards.edit', { action: 'update', set: { suspended: true } });
    check('edit refuses a change with no target', bad.isError === true, bad.content);
    const sim = await tool(page, 'flashcards.query', { action: 'similar', text: 'losses that happened but were not reported yet' });
    check('query similar finds the IBNR cards by meaning', String(sim.content).includes(`#${id2}`) && /Closest cards/.test(String(sim.content)), sim.content);
    const full = await tool(page, 'flashcards.query', { action: 'find', query: 'IBNR', full: true, sort: 'oldest' });
    check('query find full returns complete cards', String(full.content).includes('Front:\nDefine IBNR') && String(full.content).includes('Back:'), full.content);
    const plan = await tool(page, 'flashcards.edit', { action: 'apply', dryRun: true, changes: [
      { op: 'merge', keepId: `#${id2}`, mergeIds: [`#${id3}`], set: { back: 'Incurred but not reported: losses that happened but are not yet reported.' } },
      { op: 'update', ids: [`#${id1}`], set: { importance: 90 } },
    ] });
    check('edit apply dryRun previews a thinning plan', /^Would apply 2 changes/.test(String(plan.content)) && /merge #\d+ into #\d+/.test(String(plan.content)), plan.content);
    const applied = await tool(page, 'flashcards.edit', { action: 'apply', changes: [
      { op: 'merge', keepId: `#${id2}`, mergeIds: [`#${id3}`], set: { back: 'Incurred but not reported: losses that happened but are not yet reported.' } },
      { op: 'update', ids: [`#${id1}`], set: { importance: 90 } },
    ] });
    const afterMerge = await tool(page, 'flashcards.query', { action: 'card', ids: [`#${id2}`, `#${id3}`] });
    check('edit apply merges and updates in one call', /^Applied 2 changes/.test(String(applied.content)) && String(afterMerge.content).includes('not yet reported') && !String(afterMerge.content).includes(`Card #${id3}`) && String(afterMerge.content).includes('Tags: ibnr'), `${applied.content} || ${afterMerge.content}`);
    const missing = await tool(page, 'flashcards.query', { action: 'card', ids: ['#999999'] });
    check('an unknown id is an error, not a crash', missing.isError === true, missing.content);

    // The chips: deck card list, then the study card.
    await runCommand(page, 'flashcards.open');
    await page.waitForSelector('.fc-deck-card__name', { timeout: 30_000 });
    await page.click('.fc-deck-card:has(.fc-deck-card__name:has-text("Probe Deck"))');
    const rowChips = await page.waitForSelector('.fc-cardrow__id', { timeout: 20_000 }).then(() => page.$$eval('.fc-cardrow__id', (els) => els.map((e) => e.textContent))).catch(() => null);
    check('card list rows show #id', Array.isArray(rowChips) && rowChips.includes(`#${id1}`), JSON.stringify(rowChips));
    await shot(page, 'fc-list.png');
    console.log('[probe] flashcards.study ->', await runCommand(page, 'flashcards.study'));
    const studyChip = await page.waitForSelector('.fc-card__id', { timeout: 20_000 }).then((e) => e.textContent()).catch(() => null);
    check('study card shows #id', typeof studyChip === 'string' && /^#\d+$/.test(studyChip), studyChip);
    await shot(page, 'fc-study.png');

    const del = await tool(page, 'flashcards.edit', { action: 'delete', ids: [`#${id2}`] });
    const gone = await tool(page, 'flashcards.query', { action: 'find', query: 'IBNR' });
    check('edit delete removes by ids', !del.isError && String(gone.content) === 'No cards match.', `${del.content} / ${gone.content}`);
  } finally {
    console.log(`[probe] renderer errors: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log('  ' + e);
    console.log(failures ? `[probe] FAILURES: ${failures}` : '[probe] all checks passed');
    await app.close().catch(() => {});
  }
}
main().catch((err) => { console.error('[probe] failed:', err); process.exit(1); });
