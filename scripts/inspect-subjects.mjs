import initSql from 'sql.js';
import fs from 'fs';
const SQL = await initSql();
const db = new SQL.Database(fs.readFileSync('D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db'));
const q = (s, p=[]) => {
  const r = db.exec(s, p);
  if (!r[0]) return [];
  return r[0].values.map(row => Object.fromEntries(r[0].columns.map((c,i)=>[c,row[i]])));
};

// Top 30 by amount magnitude with their email subject
console.log('\n=== top 30 transactions joined to email subject ===');
const rows = q(`
  SELECT t.amount_cents, t.merchant, t.tx_type, t.transaction_date,
         e.raw_subject
    FROM transactions t
    LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
   ORDER BY ABS(t.amount_cents) DESC LIMIT 30`);
for (const r of rows) {
  console.log(`  $${(r.amount_cents/100).toFixed(2).padStart(10)}  ${(r.merchant||'NULL').padEnd(22)}  ${(r.tx_type||'NULL').padEnd(9)}  ${r.transaction_date}  ${r.raw_subject||'(no subject)'}`);
}

// Distinct subject patterns that look like deposits
console.log('\n=== subjects matching deposit keywords ===');
const dep = q(`
  SELECT DISTINCT e.raw_subject, COUNT(*) n
    FROM transactions t
    JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
   WHERE LOWER(e.raw_subject) LIKE '%deposit%'
      OR LOWER(e.raw_subject) LIKE '%paid%'
      OR LOWER(e.raw_subject) LIKE '%received%'
      OR LOWER(e.raw_subject) LIKE '%transfer%'
   GROUP BY e.raw_subject ORDER BY n DESC`);
for (const r of dep) console.log(`  [${String(r.n).padStart(2)}] ${r.raw_subject}`);

// Subjects matching transfer / cc payment
console.log('\n=== subjects matching credit card / payment ===');
const xfer = q(`
  SELECT DISTINCT e.raw_subject, COUNT(*) n
    FROM transactions t
    JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id
   WHERE LOWER(e.raw_subject) LIKE '%credit card%'
      OR LOWER(e.raw_subject) LIKE '%payment%'
   GROUP BY e.raw_subject ORDER BY n DESC`);
for (const r of xfer) console.log(`  [${String(r.n).padStart(2)}] ${r.raw_subject}`);
