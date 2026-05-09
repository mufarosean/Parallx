// Dry-run migration 005 against a copy of the DB and print what would change.
import initSql from 'sql.js';
import fs from 'fs';

const SRC = 'D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db';
const SQL = await initSql();
const db = new SQL.Database(fs.readFileSync(SRC));

const beforeQ = db.exec(`SELECT tx_type, COUNT(*) n FROM transactions GROUP BY tx_type`);
console.log('=== BEFORE ===');
for (const row of beforeQ[0].values) console.log('  ', row[0], row[1]);

const sql = fs.readFileSync('ext/budget/db/migrations/budget_005_backfill_tx_type.sql','utf8');
db.exec(sql);

const afterQ = db.exec(`SELECT tx_type, COUNT(*) n FROM transactions GROUP BY tx_type`);
console.log('\n=== AFTER ===');
for (const row of afterQ[0].values) console.log('  ', row[0], row[1]);

// Show every row that changed type from purchase to deposit/transfer/fee/hidden.
console.log('\n=== rows now classified as deposit/transfer/fee or hidden (post-migration) ===');
const r2 = db.exec(`
  SELECT t.amount_cents, t.merchant, t.tx_type, t.status, t.transaction_date, e.raw_subject
    FROM transactions t
    LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
   WHERE t.tx_type IN ('deposit','transfer','fee') OR t.status='hidden'
   ORDER BY t.tx_type, ABS(t.amount_cents) DESC`);
if (r2[0]) {
  for (const row of r2[0].values) {
    const obj = Object.fromEntries(r2[0].columns.map((c,i)=>[c,row[i]]));
    console.log(`  $${(obj.amount_cents/100).toFixed(2).padStart(10)}  ${(obj.merchant||'NULL').padEnd(22)}  ${(obj.tx_type||'NULL').padEnd(9)}  ${obj.status.padEnd(9)}  ${obj.raw_subject||''}`);
  }
}

// Verify the dashboard math now makes sense.
console.log('\n=== Dashboard sums (May 2026) ===');
const sums = db.exec(`
  SELECT
    COALESCE(SUM(CASE WHEN tx_type IN ('purchase','fee') THEN amount_cents ELSE 0 END),0) AS spend_cents,
    COALESCE(SUM(CASE WHEN tx_type='deposit' THEN ABS(amount_cents) ELSE 0 END),0) AS income_cents,
    COALESCE(SUM(CASE WHEN tx_type IS NULL THEN amount_cents ELSE 0 END),0) AS untyped_cents,
    COUNT(CASE WHEN tx_type IS NULL THEN 1 END) AS untyped_n
   FROM transactions
   WHERE status='confirmed'
     AND transaction_date >= '2026-05-01' AND transaction_date <= '2026-05-31'`);
const s = sums[0].values[0];
console.log('  spend  :', '$' + (s[0]/100).toFixed(2));
console.log('  income :', '$' + (s[1]/100).toFixed(2));
console.log('  untyped:', '$' + (s[2]/100).toFixed(2), '(' + s[3] + ' rows)');
