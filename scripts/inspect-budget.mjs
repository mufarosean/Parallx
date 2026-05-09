// Read-only inspection of the budget DB. Throw-away.
import initSql from 'sql.js';
import fs from 'fs';

const DB_PATH = 'D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db';

const SQL = await initSql();
const db = new SQL.Database(fs.readFileSync(DB_PATH));

function q(sql, params = []) {
  const r = db.exec(sql, params);
  if (!r[0]) return [];
  return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c, i) => [c, row[i]])));
}

const sep = (t) => console.log('\n=== ' + t + ' ===');

sep('tx_type breakdown');
console.table(q("SELECT tx_type, COUNT(*) n, SUM(amount_cents) sum_cents FROM transactions GROUP BY tx_type"));

sep('status breakdown');
console.table(q("SELECT status, COUNT(*) n FROM transactions GROUP BY status"));

sep('source breakdown');
console.table(q("SELECT source, COUNT(*) n FROM transactions GROUP BY source"));

sep('rows that look like income by merchant text');
console.table(q(`
  SELECT id, merchant, amount_cents, tx_type, transaction_date, status, source, gmail_message_id
    FROM transactions
   WHERE LOWER(COALESCE(merchant,'')) LIKE '%payroll%'
      OR LOWER(COALESCE(merchant,'')) LIKE '%paycheck%'
      OR LOWER(COALESCE(merchant,'')) LIKE '%direct dep%'
      OR LOWER(COALESCE(merchant,'')) LIKE '%salary%'
      OR LOWER(COALESCE(merchant,'')) LIKE '%deposit%'
      OR LOWER(COALESCE(merchant,'')) LIKE '%payment from%'
      OR LOWER(COALESCE(merchant,'')) LIKE '%credit%'`));

sep('top 20 rows by amount with tx_type=purchase (potential income misclassified)');
console.table(q("SELECT merchant, amount_cents, tx_type, transaction_date, status, source FROM transactions WHERE tx_type='purchase' ORDER BY amount_cents DESC LIMIT 20"));

sep('top 20 rows by amount magnitude (|amount|) regardless of type');
console.table(q("SELECT merchant, amount_cents, tx_type, transaction_date, status, source FROM transactions ORDER BY ABS(amount_cents) DESC LIMIT 20"));

sep('all tx_type=purchase rows with NEGATIVE amount (refunds/credits)');
console.table(q("SELECT merchant, amount_cents, tx_type, transaction_date, status FROM transactions WHERE tx_type='purchase' AND amount_cents<0"));

sep('email_imports: classifier results so far');
console.table(q(`SELECT is_transaction, is_balance, COUNT(*) n FROM email_imports GROUP BY is_transaction, is_balance`));

sep('email_imports vs transactions — show the email subject for top-amount purchases');
console.table(q(`
  SELECT t.amount_cents, t.merchant, t.tx_type, t.transaction_date,
         e.raw_subject, e.raw_snippet
    FROM transactions t
    LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
   WHERE t.source='gmail' AND t.tx_type='purchase'
   ORDER BY t.amount_cents DESC LIMIT 15`));

sep('schema: transactions table columns');
console.table(q("PRAGMA table_info(transactions)"));
