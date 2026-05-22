// Run AFTER you've reloaded the extension and clicked Sync Now.
// Diffs the current DB state against scripts/.budget-baseline.json
// and prints exactly what changed.
const fs = require('fs');
const initSqlJs = require('sql.js');

(async () => {
  const baseline = JSON.parse(fs.readFileSync(__dirname + '/.budget-baseline.json', 'utf8'));
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db'));
  const q = sql => { const r = db.exec(sql); return r.length ? r[0].values : []; };

  const now = {
    cursor: JSON.parse(q("SELECT value FROM sync_state WHERE key='last_synced_at'")[0][0]),
    lastRunAt: JSON.parse(q("SELECT value FROM sync_state WHERE key='last_run_at'")[0][0]),
    lastRunStatus: JSON.parse(q("SELECT value FROM sync_state WHERE key='last_run_status'")[0][0]),
    emailsTotal: q('SELECT COUNT(*) FROM email_imports')[0][0],
    emailsMalformed: q('SELECT COUNT(*) FROM email_imports WHERE malformed=1')[0][0],
    emailsSinceMay17: q("SELECT COUNT(*) FROM email_imports WHERE received_at >= '2026-05-17'")[0][0],
    transactionsTotal: q('SELECT COUNT(*) FROM transactions')[0][0],
    transactionsSinceMay17: q("SELECT COUNT(*) FROM transactions WHERE transaction_date >= '2026-05-17'")[0][0],
  };

  const sameRun = now.lastRunAt === baseline.lastRunAt;
  console.log('=== Sync ran? ' + (sameRun ? 'NO — lastRunAt unchanged. Click Sync Now in the app.' : 'YES') + ' ===\n');

  console.log('Field                       BEFORE                              AFTER                               Δ');
  console.log('--------------------------------------------------------------------------------------------------------');
  for (const k of Object.keys(now)) {
    const b = baseline[k], n = now[k];
    const bs = typeof b === 'object' ? JSON.stringify(b) : String(b);
    const ns = typeof n === 'object' ? JSON.stringify(n) : String(n);
    let delta = '';
    if (typeof b === 'number') delta = (n - b > 0 ? '+' : '') + (n - b);
    else if (bs !== ns) delta = 'CHANGED';
    console.log(k.padEnd(27) + ' ' + bs.slice(0, 36).padEnd(36) + ' ' + ns.slice(0, 36).padEnd(36) + ' ' + delta);
  }

  console.log('\n=== sync_log entries since baseline ===');
  for (const r of q(`SELECT ts, level, stage, message FROM sync_log WHERE ts > '${baseline.lastRunAt}' ORDER BY ts LIMIT 50`))
    console.log('  [' + r[1] + '] ' + r[2] + ': ' + String(r[3]).substring(0,160));

  console.log('\n=== Latest 8 transactions ===');
  for (const r of q("SELECT transaction_date, merchant, amount_cents, status, tx_type FROM transactions ORDER BY transaction_date DESC, id DESC LIMIT 8"))
    console.log('  ' + r[0] + '  ' + String(r[1]||'').padEnd(28) + ' $' + (r[2]/100).toFixed(2).padStart(10) + '  ' + r[3] + '  ' + r[4]);

  // Verdict
  console.log('\n=== VERDICT ===');
  const newTx = now.transactionsTotal - baseline.transactionsTotal;
  const malformedDrop = baseline.emailsMalformed - now.emailsMalformed;
  if (sameRun) {
    console.log('  Cannot verify yet — sync has not run since baseline.');
  } else if (newTx > 0 && now.cursor > baseline.cursor) {
    console.log('  PASS — ' + newTx + ' new transactions, cursor advanced to ' + now.cursor + ', ' + malformedDrop + ' malformed rows cleared.');
  } else if (newTx === 0 && now.lastRunStatus.errors === 0 && now.lastRunStatus.confirmed === 0) {
    console.log('  FAIL — sync ran but extracted zero transactions. Check sync_log above for the model output.');
  } else {
    console.log('  PARTIAL — newTx=' + newTx + ' malformedDrop=' + malformedDrop + ' status=' + JSON.stringify(now.lastRunStatus));
  }
})().catch(e => { console.error(e); process.exit(2); });
