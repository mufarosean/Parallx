// One-off diagnostic — reads the Personal Workspace budget DB read-only.
// Uses sql.js (pure JS) to dodge native-module ABI mismatch with Electron build.
const fs = require('fs');
const initSqlJs = require('sql.js');

const dbPath = process.argv[2] || 'D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db';

(async () => {
  const SQL = await initSqlJs();
  const bytes = fs.readFileSync(dbPath);
  const db = new SQL.Database(bytes);

  const run = (sql) => {
    const stmt = db.prepare(sql);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const dump = (title, rows) => {
    console.log('\n=== ' + title + ' (' + rows.length + ') ===');
    for (const r of rows) console.log(JSON.stringify(r));
  };

  console.log('DB:', dbPath);

  dump('sync_state', run('SELECT key, value FROM sync_state'));

  dump('last 20 email_imports',
    run(`SELECT processed_at, is_transaction, is_balance, classifier_model,
                substr(raw_subject,1,80) AS subject
         FROM email_imports
         ORDER BY processed_at DESC LIMIT 20`));

  dump('email_imports counts by classifier_model + is_transaction',
    run(`SELECT classifier_model, is_transaction, is_balance, COUNT(*) AS n
         FROM email_imports
         GROUP BY classifier_model, is_transaction, is_balance
         ORDER BY n DESC`));

  dump('last 20 transactions',
    run(`SELECT created_at, status, tx_type, ai_confidence,
                merchant, amount_cents, extractor_model, substr(notes,1,80) AS notes
         FROM transactions
         ORDER BY created_at DESC LIMIT 20`));

  dump('transactions counts by status + tx_type',
    run(`SELECT status, tx_type, COUNT(*) AS n
         FROM transactions
         GROUP BY status, tx_type
         ORDER BY n DESC`));

  dump('last 30 sync_log',
    run(`SELECT ts, level, stage, substr(message,1,140) AS message
         FROM sync_log
         ORDER BY ts DESC LIMIT 30`));

  dump('runs (distinct run_id, last 5)',
    run(`SELECT run_id, MIN(ts) AS started, MAX(ts) AS ended, COUNT(*) AS log_rows
         FROM sync_log
         GROUP BY run_id ORDER BY started DESC LIMIT 5`));
})().catch(e => { console.error(e); process.exit(1); });
