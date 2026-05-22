/**
 * Drives a real Parallx Electron instance end-to-end:
 *   1. Launches Electron (uses last-workspace.json → Personal Workspace)
 *   2. Opens command palette → "Budget: Sync Gmail Transactions"
 *   3. Polls the budget SQLite DB until `last_run_at` advances past the
 *      pre-launch baseline (or 5 min timeout)
 *   4. Diffs DB state and prints PASS/FAIL with deltas
 *
 * Pre-req: NO existing Parallx instance running (SQLite write contention).
 */
import { _electron as electron } from 'playwright';
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DB_PATH = 'D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db';

async function snapshot() {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const q = (sql: string) => { const r = db.exec(sql); return r.length ? r[0].values : []; };
  return {
    cursor: JSON.parse(q("SELECT value FROM sync_state WHERE key='last_synced_at'")[0][0] as string),
    lastRunAt: JSON.parse(q("SELECT value FROM sync_state WHERE key='last_run_at'")[0][0] as string),
    lastRunStatus: JSON.parse(q("SELECT value FROM sync_state WHERE key='last_run_status'")[0][0] as string),
    emailsTotal: q('SELECT COUNT(*) FROM email_imports')[0][0] as number,
    emailsMalformed: q('SELECT COUNT(*) FROM email_imports WHERE malformed=1')[0][0] as number,
    emailsSinceMay17: q("SELECT COUNT(*) FROM email_imports WHERE received_at >= '2026-05-17'")[0][0] as number,
    transactionsTotal: q('SELECT COUNT(*) FROM transactions')[0][0] as number,
    transactionsSinceMay17: q("SELECT COUNT(*) FROM transactions WHERE transaction_date >= '2026-05-17'")[0][0] as number,
  };
}

test('drive real budget.sync end-to-end and verify DB deltas', async () => {
  test.setTimeout(10 * 60_000);  // sync may take several minutes

  const before = await snapshot();
  console.log('\n=== BEFORE ===');
  console.log(JSON.stringify(before, null, 2));

  // Strip ELECTRON_RUN_AS_NODE — if set, electron.exe boots as plain Node and
  // the `app` global is undefined.
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    executablePath: path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.'],
    cwd: PROJECT_ROOT,
    timeout: 60_000,
    env: {
      ...cleanEnv,
      PARALLX_TEST_MODE: '1',
    },
  });

  const window = await app.firstWindow();
  await window.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { timeout: 30_000 });
  console.log('Window loaded');

  // Give extensions time to activate (budget extension loads its DB, applies
  // migrations, registers commands).
  await window.waitForTimeout(8_000);

  // Open command palette and run the sync command.
  await window.keyboard.press('Control+Shift+p');
  const input = window.locator('.command-palette-input');
  await input.waitFor({ state: 'visible', timeout: 5_000 });
  await input.fill('>Sync Gmail Transactions');
  await window.waitForTimeout(500);

  // Pick the first matching item.
  const items = window.locator('.command-palette-item');
  await items.first().waitFor({ state: 'visible', timeout: 5_000 });
  const firstLabel = await window.locator('.command-palette-item-label').first().textContent();
  console.log('Invoking palette item:', firstLabel);
  await items.first().click();

  // Poll the DB until lastRunAt advances (sync wrote final cursor).
  console.log('Polling DB for sync completion...');
  const deadline = Date.now() + 8 * 60_000;
  let after = before;
  let lastLogged = '';
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5_000));
    try {
      after = await snapshot();
      const status = `cursor=${after.cursor} runAt=${after.lastRunAt} status=${JSON.stringify(after.lastRunStatus)}`;
      if (status !== lastLogged) { console.log('  ' + status); lastLogged = status; }
      if (after.lastRunAt !== before.lastRunAt) { console.log('Sync completed.'); break; }
    } catch (e) {
      // DB locked mid-write — retry.
    }
  }

  await app.close();

  console.log('\n=== AFTER ===');
  console.log(JSON.stringify(after, null, 2));

  console.log('\n=== DELTAS ===');
  for (const k of Object.keys(after) as (keyof typeof after)[]) {
    const b = before[k], a = after[k];
    if (typeof a === 'number' && typeof b === 'number') {
      console.log('  ' + k + ': ' + b + ' → ' + a + ' (Δ ' + (a - b > 0 ? '+' : '') + (a - b) + ')');
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      console.log('  ' + k + ': CHANGED');
      console.log('    before: ' + JSON.stringify(b));
      console.log('    after:  ' + JSON.stringify(a));
    }
  }

  // Real assertions — these will FAIL the test if the fix didn't actually work.
  expect(after.lastRunAt, 'sync did not run').not.toBe(before.lastRunAt);
  expect(after.cursor, 'cursor did not advance — pagination/cursor logic broken')
    .not.toBe(before.cursor);
  expect(after.lastRunStatus.errors, 'sync had errors').toBe(0);
  expect(after.transactionsSinceMay17,
    'no May-17-onward transactions extracted — backlog still not getting through')
    .toBeGreaterThan(before.transactionsSinceMay17);
});
