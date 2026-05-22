// Self-contained test for migration 008 + sync-loop skip-check fix.
// Builds an empty SQLite DB in memory, applies migrations 001 + 008,
// seeds rows that mimic the broken-pipeline state ("neither tx nor
// balance"), and asserts:
//   (1) migration 008 backfills malformed=1 on those broken rows
//   (2) skip-check `WHERE gmail_message_id=? AND malformed=0` returns
//       NOTHING for broken rows (so they are retried)
//   (3) skip-check returns the row after a successful retry that uses
//       INSERT OR REPLACE with malformed=0
//   (4) rows that DID record a transaction or balance are left alone
//       (malformed=0) so we don't churn through good history
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const MIG_DIR = path.join(__dirname, '..', 'ext', 'budget', 'db', 'migrations');

let failures = 0;
function assert(cond, label) {
  if (cond) { console.log('  PASS ' + label); }
  else { console.log('  FAIL ' + label); failures++; }
}

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Apply 001 + 008 only — that is all the test cares about.
  const sql001 = fs.readFileSync(path.join(MIG_DIR, 'budget_001_initial.sql'), 'utf8');
  const sql008 = fs.readFileSync(path.join(MIG_DIR, 'budget_008_email_imports_malformed.sql'), 'utf8');

  console.log('Applying migration 001...');
  db.exec(sql001);

  // Seed pre-migration rows (no `malformed` column exists yet).
  console.log('Seeding 3 rows on the OLD schema...');
  db.run(
    `INSERT INTO email_imports (gmail_message_id, received_at, raw_subject, raw_snippet, is_transaction, is_balance, classifier_model)
     VALUES (?,?,?,?,?,?,?)`,
    ['msg-broken-1', '2026-05-18T10:00:00Z', 'Your daily summary', 'snippet', 0, 0, 'qwen3.5:4b'],
  );
  db.run(
    `INSERT INTO email_imports (gmail_message_id, received_at, raw_subject, raw_snippet, is_transaction, is_balance, classifier_model)
     VALUES (?,?,?,?,?,?,?)`,
    ['msg-broken-2', '2026-05-19T11:00:00Z', 'You made a $42 transaction', 'snippet', 0, 0, 'qwen3.5:4b'],
  );
  db.run(
    `INSERT INTO email_imports (gmail_message_id, received_at, raw_subject, raw_snippet, is_transaction, is_balance, classifier_model)
     VALUES (?,?,?,?,?,?,?)`,
    ['msg-good-1',   '2026-05-10T09:00:00Z', 'You made a $99 transaction', 'snippet', 1, 0, 'qwen3.5:4b'],
  );

  console.log('Applying migration 008...');
  db.exec(sql008);

  // --- Test 1: malformed column exists ----------------------------------
  const cols = db.exec("PRAGMA table_info(email_imports)")[0].values.map(r => r[1]);
  assert(cols.includes('malformed'), 'email_imports has malformed column');

  // --- Test 2: backfill marks broken rows malformed=1 -------------------
  const flagged = db.exec(
    "SELECT gmail_message_id, malformed FROM email_imports ORDER BY gmail_message_id"
  )[0].values;
  const byId = Object.fromEntries(flagged.map(([id, m]) => [id, m]));
  assert(byId['msg-broken-1'] === 1, 'broken-1 backfilled to malformed=1');
  assert(byId['msg-broken-2'] === 1, 'broken-2 backfilled to malformed=1');
  assert(byId['msg-good-1']   === 0, 'good-1 left at malformed=0');

  // --- Test 3: skip-check ignores malformed rows ------------------------
  const skipCheck = (id) => {
    const r = db.exec("SELECT 1 AS x FROM email_imports WHERE gmail_message_id=? AND malformed=0", [id]);
    return r.length > 0 && r[0].values.length > 0;
  };
  assert(!skipCheck('msg-broken-1'), 'broken-1 is retry-eligible (skip-check returns nothing)');
  assert(!skipCheck('msg-broken-2'), 'broken-2 is retry-eligible');
  assert( skipCheck('msg-good-1'),   'good-1 stays skipped (already-processed)');

  // --- Test 4: INSERT OR REPLACE on a successful retry ------------------
  // Simulate the sync loop re-processing msg-broken-2 with a working pipeline:
  // Stage 1 now succeeds → is_transaction=1, malformed=0.
  db.run(
    `INSERT OR REPLACE INTO email_imports (gmail_message_id, received_at, raw_subject, raw_snippet, is_transaction, is_balance, classifier_model, processed_at, malformed)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['msg-broken-2', '2026-05-19T11:00:00Z', 'You made a $42 transaction', 'snippet', 1, 0, 'gpt-oss:20b', '2026-05-21T12:00:00Z', 0],
  );
  const retryRow = db.exec(
    "SELECT is_transaction, malformed, classifier_model FROM email_imports WHERE gmail_message_id='msg-broken-2'"
  )[0].values[0];
  assert(retryRow[0] === 1, 'after retry, broken-2.is_transaction=1');
  assert(retryRow[1] === 0, 'after retry, broken-2.malformed=0');
  assert(retryRow[2] === 'gpt-oss:20b', 'after retry, classifier_model overwritten');
  assert( skipCheck('msg-broken-2'), 'after retry, broken-2 is now skipped on subsequent syncs');

  // --- Test 5: still exactly one row per gmail_message_id ---------------
  const count = db.exec("SELECT COUNT(*) FROM email_imports WHERE gmail_message_id='msg-broken-2'")[0].values[0][0];
  assert(count === 1, 'INSERT OR REPLACE did not duplicate the row');

  console.log('\n' + (failures === 0 ? 'OK — all tests passed' : 'FAIL — ' + failures + ' assertion(s) failed'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
