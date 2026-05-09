// Simulate migration 007 against the live DB and run every dashboard query.
import initSqlJs from 'sql.js';
import fs from 'node:fs';

const DB_PATH = 'D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db';
const MIG_PATH = 'ext/budget/db/migrations/budget_007_subject_reclassify.sql';

const SQL = await initSqlJs();
const buf = fs.readFileSync(DB_PATH);
const db = new SQL.Database(buf);

console.log('=== BEFORE migration 007 ===');
const before = db.exec("SELECT tx_type, COUNT(*) n FROM transactions GROUP BY tx_type");
console.log(JSON.stringify(before, null, 2));

const status_before = db.exec("SELECT status, COUNT(*) n FROM transactions GROUP BY status");
console.log('status:', JSON.stringify(status_before));

// Apply migration 007
const sql = fs.readFileSync(MIG_PATH, 'utf8');
db.exec(sql);

console.log('\n=== AFTER migration 007 ===');
console.log(JSON.stringify(db.exec("SELECT tx_type, COUNT(*) n FROM transactions GROUP BY tx_type"), null, 2));
console.log('status:', JSON.stringify(db.exec("SELECT status, COUNT(*) n FROM transactions GROUP BY status")));

const range = ['2026-05-01', '2026-05-31'];

console.log('\n=== Q1: Dashboard spend / income (main.js L1729) ===');
const stmt1 = db.prepare(
  `SELECT COALESCE(SUM(CASE WHEN tx_type IN ('purchase','fee') THEN amount_cents ELSE 0 END),0) AS spend,
          COALESCE(SUM(CASE WHEN tx_type='deposit' THEN ABS(amount_cents) ELSE 0 END),0) AS income
     FROM transactions
    WHERE status='confirmed'
      AND transaction_date >= ? AND transaction_date <= ?`,
);
stmt1.bind(range);
stmt1.step();
const r1 = stmt1.getAsObject();
console.log(`  spend  : $${(r1.spend/100).toFixed(2)}`);
console.log(`  income : $${(r1.income/100).toFixed(2)}`);
console.log(`  net    : $${((r1.income - r1.spend)/100).toFixed(2)}`);

console.log('\n=== Q2: Untyped card ===');
const stmt2 = db.prepare(
  `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS sum_cents
     FROM transactions
    WHERE status='confirmed' AND tx_type IS NULL
      AND transaction_date >= ? AND transaction_date <= ?`,
);
stmt2.bind(range);
stmt2.step();
const r2 = stmt2.getAsObject();
console.log(`  untyped: ${r2.n} rows, $${(r2.sum_cents/100).toFixed(2)}`);

console.log('\n=== Q3: Review queue ===');
console.log(JSON.stringify(db.exec(`SELECT COUNT(*) n FROM transactions WHERE status='review'`)));

console.log('\n=== Q4: Spend by category (main.js L2202) ===');
const cats = db.exec(`
  SELECT COALESCE(c.name, 'Uncategorized') AS name, COALESCE(SUM(t.amount_cents),0) AS total_cents
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
   WHERE t.status='confirmed' AND t.tx_type IN ('purchase','fee')
     AND t.transaction_date >= '2026-05-01' AND t.transaction_date <= '2026-05-31'
   GROUP BY c.id ORDER BY total_cents DESC`);
if (cats[0]) {
  for (const row of cats[0].values) {
    console.log(`  ${row[0].padEnd(20)} $${(row[1]/100).toFixed(2)}`);
  }
}

console.log('\n=== Q5: Recent activity (transactions table view, L1062) ===');
const recent = db.exec(`
  SELECT t.transaction_date, t.merchant, t.amount_cents, t.tx_type, c.name AS cat
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
   WHERE t.status='confirmed' AND t.tx_type IN ('purchase','fee')
     AND t.transaction_date >= '2026-05-01' AND t.transaction_date <= '2026-05-31'
   ORDER BY t.transaction_date DESC, t.amount_cents DESC LIMIT 8`);
if (recent[0]) {
  for (const row of recent[0].values) {
    console.log(`  ${row[0]}  ${(row[1]||'NULL').padEnd(28)}  $${(row[2]/100).toFixed(2).padStart(10)}  ${row[3]}  ${row[4]||'-'}`);
  }
}

console.log('\n=== Q6: Deposits in range (income detail) ===');
const dep = db.exec(`
  SELECT t.transaction_date, t.merchant, t.amount_cents, e.raw_subject
    FROM transactions t LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
   WHERE t.status='confirmed' AND t.tx_type='deposit'
     AND t.transaction_date >= '2026-05-01' AND t.transaction_date <= '2026-05-31'
   ORDER BY t.transaction_date DESC`);
if (dep[0]) {
  for (const row of dep[0].values) {
    console.log(`  ${row[0]}  $${(Math.abs(row[2])/100).toFixed(2).padStart(10)}  ${row[3] || ''}`);
  }
}

console.log('\n=== Q7: Transfers in range (excluded from spend) ===');
const tr = db.exec(`
  SELECT t.transaction_date, t.amount_cents, e.raw_subject
    FROM transactions t LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
   WHERE t.status='confirmed' AND t.tx_type='transfer'
     AND t.transaction_date >= '2026-05-01' AND t.transaction_date <= '2026-05-31'
   ORDER BY t.transaction_date DESC`);
if (tr[0]) {
  for (const row of tr[0].values) {
    console.log(`  ${row[0]}  $${(row[1]/100).toFixed(2).padStart(10)}  ${row[2] || ''}`);
  }
}

console.log('\n=== Q8: Hidden rows (auto-hidden daily summaries) ===');
const hid = db.exec(`
  SELECT COUNT(*) n FROM transactions WHERE status='hidden' AND transaction_date >= '2026-05-01' AND transaction_date <= '2026-05-31'`);
console.log(JSON.stringify(hid));

console.log('\n=== Q9: Net worth (sum of latest balance per account) ===');
const nw = db.exec(`
  SELECT COALESCE(SUM(b.balance_cents),0) AS net
    FROM balance_snapshots b
    JOIN (SELECT account_id, MAX(snapshot_date) md FROM balance_snapshots GROUP BY account_id) m
      ON m.account_id = b.account_id AND m.md = b.snapshot_date`);
console.log(JSON.stringify(nw));
