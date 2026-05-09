import initSql from 'sql.js';
import fs from 'fs';
const SQL = await initSql();
const db = new SQL.Database(fs.readFileSync('D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db'));
const q = (s, p=[]) => {
  const r = db.exec(s, p);
  if (!r[0]) return [];
  return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c,i)=>[c,row[i]])));
};
console.log('\n=== sample NULL-tx_type tx rows ===');
console.table(q(`SELECT id, gmail_message_id, merchant, amount_cents FROM transactions WHERE tx_type IS NULL LIMIT 5`));
console.log('\n=== email_imports count ===');
console.table(q(`SELECT COUNT(*) n FROM email_imports`));
console.log('\n=== JOIN: NULL-tx transactions + email subject ===');
const rows = q(`
  SELECT t.gmail_message_id gmid, t.amount_cents, t.merchant,
         e.raw_subject, e.is_transaction
    FROM transactions t
    LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
   WHERE t.tx_type IS NULL
   ORDER BY ABS(t.amount_cents) DESC`);
console.log('count:', rows.length);
for (const r of rows.slice(0, 30)) console.log(`  $${(r.amount_cents/100).toFixed(2).padStart(10)}  ${(r.merchant||'NULL').padEnd(22)}  is_tx=${r.is_transaction}  ${r.raw_subject||'(no email_imports row found)'}`);
