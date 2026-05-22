const { DatabaseSync } = require('node:sqlite');
const path = 'D:\\Documents\\Parallx Workspaces\\Personal Workspace\\.parallx\\extensions\\budget\\data.db';
const db = new DatabaseSync(path);

console.log('── May email_imports breakdown ──');
const breakdown = db.prepare(`
  SELECT
    SUM(CASE WHEN is_transaction=1 THEN 1 ELSE 0 END) AS tx_classified,
    SUM(CASE WHEN is_balance=1 THEN 1 ELSE 0 END)     AS bal_classified,
    SUM(CASE WHEN malformed=1 THEN 1 ELSE 0 END)      AS malformed,
    SUM(CASE WHEN is_transaction=0 AND is_balance=0 AND malformed=0 THEN 1 ELSE 0 END) AS clean_skip,
    COUNT(*)                                           AS total
  FROM email_imports
  WHERE received_at >= '2026-05-01' AND received_at < '2026-06-01'
`).get();
console.log(JSON.stringify(breakdown, null, 2));

const bigRun = '0d14443a-8c5d-4867-acc9-3d27fa5be4cc';
console.log('\n── Big run stages ──');
console.log(JSON.stringify(db.prepare(`
  SELECT stage, level, COUNT(*) AS n
  FROM sync_log WHERE run_id=? GROUP BY stage, level ORDER BY n DESC
`).all(bigRun), null, 2));

console.log('\n── Big run sample warns (25) ──');
console.log(JSON.stringify(db.prepare(`
  SELECT ts, stage, msg_id, substr(message,1,200) AS message
  FROM sync_log WHERE run_id=? AND level='warn'
  ORDER BY id ASC LIMIT 25
`).all(bigRun), null, 2));

console.log('\n── For 8 most-recent May malformed msgs: their sync_log entries ──');
const m = db.prepare(`
  SELECT gmail_message_id, received_at, substr(raw_subject,1,80) AS subject
  FROM email_imports
  WHERE received_at >= '2026-05-01' AND received_at < '2026-06-01' AND malformed=1
  ORDER BY received_at DESC LIMIT 8
`).all();
for (const x of m) {
  console.log(`\nmsg=${x.gmail_message_id}  ${x.received_at}  "${x.subject}"`);
  const logs = db.prepare(`
    SELECT level, stage, substr(message,1,300) AS message
    FROM sync_log WHERE msg_id=? ORDER BY id ASC
  `).all(x.gmail_message_id);
  if (logs.length===0) console.log('  (no sync_log entries)');
  else for (const l of logs) console.log(`  [${l.level}] ${l.stage}: ${l.message}`);
}
