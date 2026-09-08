import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const repo = path.resolve(import.meta.dirname, '../..');
const prepared = JSON.parse(await fs.readFile(path.join(repo, 'test-results/agent-reliability/ui-prepared.json'), 'utf8'));
process.env.PARALLX_RELIABILITY_CODE_ROOT = prepared.codeRoot;
const { createRun, prepareCode, launch } = await import('../agent-reliability/isolation.mjs');
const run = await createRun('ui-panel-flashcards');
await fs.cp(path.join(prepared.codeRoot, 'ext/flashcards'), path.join(run.appRoot, 'data/extensions/flashcards'), { recursive: true });
await fs.mkdir(path.join(run.workspace, '.parallx'), { recursive: true });
await fs.writeFile(path.join(run.workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
await fs.writeFile(path.join(run.workspace, 'README.md'), '# Interface study\nSynthetic content for Panel and Flashcards verification.\n');
await prepareCode();
const instance = await launch(run);
const { app, page } = instance;
const command = id => page.evaluate(id => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id), id);
async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  // A hidden window can return its previous compositor frame. Wake capture,
  // let the renderer paint, then retain the next frame.
  await app.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.setBackgroundThrottling(false);
    await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a => a.finished.catch(() => {}))));
  const base64 = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    return (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG().toString('base64');
  });
  await fs.writeFile(path.join(run.evidence, `${name}.png`), Buffer.from(base64, 'base64'));
}
try {
  await page.waitForFunction(() => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).getCommand('flashcards.open'), undefined, { timeout: 30000 });
  await command('flashcards.open');
  await page.locator('.fc-home').waitFor();
  await page.evaluate(async () => {
    const db = window.parallxElectron.extensionDatabase;
    const id = 'flashcards';
    const now = Date.now();
    const names = ['Probability & inference', 'Linear algebra', 'Research methods', 'Cognitive psychology', 'French · everyday conversation', 'Archive · first semester'];
    for (let d = 1; d <= names.length; d++) {
      const result = await db.run(id, 'INSERT INTO fc_decks (id,name,created_at,exam_date) VALUES (?,?,?,?)', [d,names[d-1],now,d===1 ? now+45*86400000 : 0]);
      if (result.error) throw new Error(JSON.stringify(result.error));
      for (let c=0;c<12+d*3;c++) {
        const review=c%3===0;
        const front = c===0 ? 'When would you use a confidence interval instead of a prediction interval?' : `${names[d-1]}\n\nExplain concept ${c+1} in your own words, and give a practical example.`;
        const back = c===0 ? 'A **confidence interval** describes uncertainty about a population parameter.\n\nA **prediction interval** describes the range for a new individual observation. It includes both parameter uncertainty and individual variation, so it is usually wider.' : 'Start with the underlying assumption, then connect the definition to an example.\n\n- State the conditions.\n- Explain the relationship.\n- Check the limiting case.';
        const result = await db.run(id,'INSERT INTO fc_cards (deck_id,front,back,created_at,state,due_at,reps,interval_days,tags) VALUES (?,?,?,?,?,?,?,?,?)',[d,front,back,now-c*1000,review?'review':'new',review?now-1000:0,review?4:0,review?5:0,'foundations']);
        if(result.error) throw new Error(JSON.stringify(result.error));
      }
    }
  });
  await command('flashcards.stats');
  await page.locator('.fc-crumb--link').first().click();
  await page.locator('.fc-deck-card').first().waitFor();
  await shot('decks-dark');
  const search = page.getByRole('searchbox', { name: 'Find a deck' });
  await search.fill('LINEAR');
  assert.equal(await page.locator('.fc-deck-card:visible').count(), 1);
  assert.match(await page.locator('.fc-deck-card:visible').innerText(), /Linear algebra/);
  await search.fill('no matching deck');
  await page.getByRole('status').filter({hasText:'No decks match'}).waitFor();
  await search.fill('');
  assert.equal(await page.locator('.fc-deck-card:visible').count(), 6);
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
  await shot('decks-light');
  await page.evaluate(() => document.documentElement.removeAttribute('data-px-mode'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720));
  await shot('decks-narrow');
  assert(await page.locator('.fc-pane').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'Flashcards pane overflows horizontally');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
  await page.locator('.view-tab').filter({ hasText: /^Output$/ }).click();
  await command('output.clear');
  await page.evaluate(() => { console.log('Reading workspace files…'); console.log('Indexed 24 documents in 1.8 s'); console.warn('One PDF needs text extraction.'); console.log('Watching for changes.'); });
  await shot('panel-output');
  await page.getByRole('button', {name:'Toggle timestamps',exact:true}).click();
  assert.equal(await page.locator('.px-panel-log-time:visible').count(),0);
  await page.getByRole('button', {name:'Toggle timestamps',exact:true}).click();
  await page.locator('.fc-deck-card').first().getByRole('button', {name:'Study', exact:true}).click();
  await page.locator('.fc-study__front').waitFor();
  await shot('study-front');
  await page.getByRole('button', {name:'Show Answer',exact:true}).click();
  await page.locator('.fc-study__back').waitFor();
  await shot('study-answer');
  const bounds = await page.locator('.fc-grade--good').evaluate(e => ({ grade: e.getBoundingClientRect().toJSON(), main: e.closest('.fc-study__main').getBoundingClientRect().toJSON() }));
  assert(bounds.grade.top >= bounds.main.top && bounds.grade.bottom <= bounds.main.bottom, 'Rating controls below study viewport');
  await page.locator('.fc-study__main').focus();
  await page.keyboard.press('3');
  await page.waitForFunction(() => !document.querySelector('.fc-study__col.is-revealed'));
  await page.getByRole('button', {name:'Undo',exact:true}).click();
  await page.locator('.fc-study__front').filter({hasText:'confidence interval'}).waitFor();
  await page.getByRole('button',{name:'Show Answer',exact:true}).click();
  await page.locator('.fc-study__back').waitFor();
  await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
  await shot('study-light');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720));
  await shot('study-narrow');
  assert(await page.locator('.fc-study').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'Study overflows horizontally');
  await page.getByRole('button',{name:'Clear output',exact:true}).click();
  await shot('panel-empty');
  console.log(JSON.stringify({ root: run.root, pass: true }));
} catch(error) {
  await fs.writeFile(path.join(run.evidence,'failure.txt'),String(error.stack));
  await shot('failure').catch(()=>{});
  throw error;
} finally { await instance.close(); }
