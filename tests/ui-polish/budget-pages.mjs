// Budget pages, seen as the user sees them.
//
//   node tests/ui-polish/budget-pages.mjs [--light] [--width=1600] [--only=overview,plan]
//
// Launches the built app (run `node scripts/build.mjs` first) with a new
// profile and workspace under test-results/ui-polish/, installs ext/budget,
// seeds a synthetic ledger (three accounts, July to today, bills, rules, a
// row to review, limits for this month) through the extension database, and
// saves a screenshot of every Budget page plus its open dropdowns. No user
// profile or workspace is read. On Linux without a display, run it under
// xvfb-run.
import fs from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const repo = path.resolve(import.meta.dirname, '../..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const light = Boolean(args.light);
const width = Number(args.width) || 1600;
const height = Number(args.height) || 1000;
const only = args.only ? String(args.only).split(',') : null;

const outRoot = path.join(repo, 'test-results/ui-polish');
await fs.mkdir(outRoot, { recursive: true });
const root = await fs.mkdtemp(path.join(outRoot, 'budget-pages-'));
const appRoot = path.join(root, 'app');
const workspace = path.join(root, 'workspace');
const shots = path.join(root, 'shots');
for (const d of [path.join(appRoot, 'data/extensions'), workspace, shots, path.join(appRoot, 'data/chromium-cache')]) await fs.mkdir(d, { recursive: true });
await fs.writeFile(path.join(appRoot, 'data/last-workspace.json'), JSON.stringify({ path: workspace }));
await fs.cp(path.join(repo, 'ext/budget'), path.join(appRoot, 'data/extensions/budget'), { recursive: true });
await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
await fs.writeFile(path.join(workspace, '.parallx/ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));

const env = { ...process.env, PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data/chromium-cache') };
const app = await electron.launch({ args: ['.', '--no-sandbox', '--disable-gpu'], cwd: repo, env, timeout: 90000 });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await app.evaluate(({ BrowserWindow }, { width, height }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(width, height); }, { width, height });
await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });

const svc = (id) => `window.__parallx_workbench__._services.get({ id: '${id}' })`;
const command = (id, ...a) => page.evaluate(({ id, a }) => window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...a), { id, a });

async function settle(ms = 400) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}
async function shot(name) {
  await settle();
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
  console.log('shot', name);
}

try {
  await page.waitForFunction(() => window.__parallx_workbench__?._services.get({ id: 'IToolEnablementService' }), undefined, { timeout: 60000 });
  await page.evaluate(() => window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx.budget', true));
  await page.reload();
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => window.__parallx_workbench__?._services.get({ id: 'ICommandService' }).getCommand('budget.openDashboard'), undefined, { timeout: 60000 });
  // Wait for migrations + default categories.
  for (let i = 0; ; i++) {
    const n = await page.evaluate(async () => {
      const r = await window.parallxElectron.extensionDatabase.get('budget', 'SELECT COUNT(*) AS n FROM categories', []);
      return r?.row?.n ?? 0;
    });
    if (n > 0) break;
    if (i > 120) throw new Error('Budget never opened its database');
    await page.waitForTimeout(500);
  }

  await page.evaluate(async () => {
    const dbx = window.parallxElectron.extensionDatabase;
    const run = async (sql, p = []) => { const r = await dbx.run('budget', sql, p); if (r.error) throw new Error(sql + ' → ' + JSON.stringify(r.error)); };
    const all = async (sql, p = []) => { const r = await dbx.all('budget', sql, p); if (r.error) throw new Error(sql + ' → ' + JSON.stringify(r.error)); return r.rows; };
    const cats = Object.fromEntries((await all('SELECT id, name FROM categories')).map(c => [c.name, c.id]));
    const cat = (n) => cats[n] ?? null;
    await run(`INSERT OR IGNORE INTO accounts (id,last_four,kind,display_name) VALUES ('a1','6307','checking',NULL),('a2','9821','checking',NULL),('a3','7610','credit_card',NULL)`);
    await run(`INSERT INTO balance_snapshots (id,account_last_four,account_id,balance_cents,snapshot_date) VALUES ('b1','6307','a1',6200056,'2026-09-18'),('b2','9821','a2',720125,'2026-09-18'),('b0','6307','a1',6180000,'2026-08-18')`);
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const spend = [
      ['H-E-B #444', 'Groceries', 8400], ['EVERYDAY 24684026', 'Groceries', 4200], ['Amazon.com', 'Shopping', 6400],
      ['AMAZON MKTPLACE PMTS', 'Shopping', 3150], ['UBER * EATS PENDIN', 'Dining', 3800], ['Nayax **Aramark Serv', 'Dining', 450],
      ['SHELL OIL 5744', 'Transport', 4100], ['CVS/PHARMACY #1023', 'Health', 1899], ['EA *ELECTRONIC ARTS', 'Entertainment', 1080],
    ];
    const bills = [
      ['Netflix.com', 'Subscriptions', 2164, 9], ['Spotify USA', 'Subscriptions', 1406, 5], ['Spectrum', 'Utilities', 8125, 6],
      ['ANTHROPIC* CLAUDE SU', 'Subscriptions', 10660, 19], ['RING MULTI PLAN', 'Subscriptions', 1081, 16], ['Chase Mortgage', 'Housing', 185000, 1],
    ];
    let n = 0;
    const start = new Date(2026, 6, 1);
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const day = iso(d);
      const k = d.getDate();
      if (k % 2 === 0) { const s = spend[(k + d.getMonth()) % spend.length]; n++; await run(`INSERT INTO transactions (id,merchant,amount_cents,transaction_date,category_id,status,tx_type,account_id,source) VALUES (?,?,?,?,?,'confirmed','purchase','a3','gmail')`, ['t' + n, s[0], s[2] + (k * 37) % 900, day, cat(s[1])]); }
      if (k % 3 === 0) { const s = spend[(k * 2) % spend.length]; n++; await run(`INSERT INTO transactions (id,merchant,amount_cents,transaction_date,category_id,status,tx_type,account_id,source) VALUES (?,?,?,?,?,'confirmed','purchase','a2','gmail')`, ['t' + n, s[0], s[2], day, cat(s[1])]); }
      for (const b of bills) if (b[3] === k) { n++; await run(`INSERT INTO transactions (id,merchant,amount_cents,transaction_date,category_id,status,tx_type,account_id,source) VALUES (?,?,?,?,?,'confirmed','purchase','a2','gmail')`, ['t' + n, b[0], b[2], day, cat(b[1])]); }
      if (k === 1 || k === 15) { n++; await run(`INSERT INTO transactions (id,merchant,amount_cents,transaction_date,category_id,status,tx_type,account_id,source) VALUES (?,?,?,?,NULL,'confirmed','deposit','a1','gmail')`, ['t' + n, 'Direct Deposit ACME CORP', -270000, day]); }
      if (k === 20) { n++; await run(`INSERT INTO transactions (id,merchant,amount_cents,transaction_date,category_id,status,tx_type,account_id,source,tx_type_source) VALUES (?,?,?,?,NULL,'confirmed','transfer','a1','gmail','ai')`, ['t' + n, 'Online Transfer to SAV', 50000, day]); }
    }
    n++; await run(`INSERT INTO transactions (id,merchant,amount_cents,transaction_date,category_id,status,tx_type,account_id,source,notes) VALUES (?,?,?,?,NULL,'review','other','a3','gmail',?)`, ['t' + n, 'SQ *BLUE BOTTLE', 1275, iso(today), '[possible duplicate of t1]']);
    let r = 0;
    for (const b of bills) {
      r++;
      const next = new Date(today.getFullYear(), today.getMonth(), b[3]);
      if (next < today) next.setMonth(next.getMonth() + 1);
      await run(`INSERT INTO recurring_series (id,merchant_pattern,display_name,category_id,cadence,avg_amount_cents,last_amount_cents,next_due_date,occurrence_count,detection_confidence,user_confirmed) VALUES (?,?,?,?,'monthly',?,?,?,3,'high',1)`, ['r' + r, b[0], b[0], cat(b[1]), b[2], b[2], iso(next)]);
      const txs = await all(`SELECT id FROM transactions WHERE merchant = ?`, [b[0]]);
      for (const t of txs) await run(`INSERT INTO recurring_occurrences (series_id, transaction_id) VALUES (?,?)`, ['r' + r, t.id]);
    }
    let q = 0;
    for (const s of [...spend, ...bills]) { q++; await run(`INSERT INTO categorization_rules (id,pattern,match_type,category_id,auto_created,hits) VALUES (?,?,?,?,1,?)`, ['q' + q, s[0], q % 3 ? 'contains' : 'exact', cat(s[1]), q * 3]); }
    const mk = iso(today).slice(0, 7);
    for (const [c, v] of [['Groceries', 55000], ['Dining', 24000], ['Shopping', 40000], ['Transport', 15000]]) await run(`INSERT INTO budgets (id,category_id,month_key,limit_cents) VALUES (?,?,?,?)`, ['bu' + c, cat(c), mk, v]);
    await run(`INSERT INTO goals (id,name,kind,target_cents,current_cents,target_date) VALUES ('g1','Emergency fund','savings',1500000,620000,'2027-06-01')`).catch(() => {});
  });

  await command('budget.openDashboard');
  await page.locator('.budget-editor').waitFor();
  await page.reload();
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120000 });
  await page.waitForFunction(() => window.__parallx_workbench__?._services.get({ id: 'ICommandService' }).getCommand('budget.openDashboard'), undefined, { timeout: 60000 });
  await command('workbench.view.show', 'budget.nav').catch(() => {});
  // Light mode: the --px tokens switch on <html data-px-mode="light">, as the
  // Appearance panel does.
  if (light) await page.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));

  const pages = [
    ['overview', 'budget.openDashboard'], ['review', 'budget.openReviewQueue'], ['transactions', 'budget.openTransactions'],
    ['plan', 'budget.openBudgets'], ['bills', 'budget.openRecurring'], ['trends', 'budget.openCashFlow'], ['reconcile', 'budget.openReconcile'],
    ['worth', 'budget.openAccounts'], ['rules', 'budget.openRules'], ['categories', 'budget.openCategories'],
    ['synclog', 'budget.openSyncLog'], ['import', 'budget.openImportExport'],
  ];
  for (const [name, cmd] of pages) {
    if (only && !only.includes(name)) continue;
    await command(cmd);
    await page.locator('.budget-editor').waitFor();
    await settle(900);
    await shot(`${name}${light ? '-light' : ''}`);
  }
  // Dropdowns: open each kit/native dropdown on Transactions and Net Worth.
  if (!only || only.includes('dropdowns')) {
    await command('budget.openTransactions'); await settle(900);
    const dd = page.locator('.budget-editor .px-dropdown, .budget-editor .ui-dropdown, .budget-editor select').first();
    if (await dd.count()) { await dd.click(); await shot('dd-transactions-accounts'); await page.keyboard.press('Escape'); }
    await page.locator('.budget-tx-item').first().click().catch(() => {});
    await shot('tx-drawer');
    await page.keyboard.press('Escape');
    await command('budget.openAccounts'); await settle(900);
    const kind = page.locator('.budget-editor .px-dropdown, .budget-editor .ui-dropdown, .budget-editor select').first();
    if (await kind.count()) { await kind.click(); await shot('dd-worth-kind'); await page.keyboard.press('Escape'); }
  }
} catch (e) {
  console.error(e);
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
} finally {
  await fs.writeFile(path.join(root, 'errors.json'), JSON.stringify(errors, null, 2));
  console.log('shots in', shots, 'errors:', errors.length);
  await app.close().catch(() => {});
}
