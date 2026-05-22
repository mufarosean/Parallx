// Test for cursor-rollback fix on top of migration 008.
//
// Reproduces the user's real state:
//   - sync_state.last_synced_at = 2026-05-21T19:55:04Z (advanced past the
//     broken May-17-onward emails)
//   - 23 email_imports rows with malformed=1 between 2026-05-17 and 19
//
// Asserts:
//   (1) Without the rollback, sinceIso = cursor = 2026-05-21 → Gmail
//       would filter out the May-17 malformed emails (BUG).
//   (2) With the rollback, sinceIso = oldest malformed row's received_at
//       → Gmail returns those emails so the retry pipeline can run.
//   (3) After a sync that processes no NEW messages, the saved cursor
//       does NOT regress below the original high-water mark.
//   (4) After a sync that processes a NEWER message, the cursor advances.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const MIG_DIR = path.join(__dirname, '..', 'ext', 'budget', 'db', 'migrations');
let failures = 0;
const assert = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) failures++; };

// Inlined copy of the production cursor logic so we test the algorithm,
// not async plumbing. Exact mirror of ext/budget/main.js:6397-6422 and
// the floored save at line 6678.
function computeSince(cursorIso, oldestMalformed) {
  return (oldestMalformed && oldestMalformed < cursorIso) ? oldestMalformed : cursorIso;
}
function saveCursor(newestSeenIso, cursorFloor) {
  return newestSeenIso > cursorFloor ? newestSeenIso : cursorFloor;
}

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec(fs.readFileSync(path.join(MIG_DIR, 'budget_001_initial.sql'), 'utf8'));
  db.exec(fs.readFileSync(path.join(MIG_DIR, 'budget_008_email_imports_malformed.sql'), 'utf8'));

  // Reproduce the user's real state.
  const CURSOR_ISO = '2026-05-21T19:55:04.000Z';
  db.run("INSERT OR REPLACE INTO sync_state (key,value) VALUES ('last_synced_at', ?)", [JSON.stringify(CURSOR_ISO)]);

  // Seed 3 rows representing the broken May-17-onward emails (post-migration
  // they will be malformed=1 because is_transaction=0 AND is_balance=0).
  for (const [id, received] of [
    ['m-2026-05-17', '2026-05-17T10:00:00Z'],
    ['m-2026-05-18', '2026-05-18T11:00:00Z'],
    ['m-2026-05-19', '2026-05-19T12:00:00Z'],
  ]) {
    db.run(
      `INSERT INTO email_imports (gmail_message_id, received_at, raw_subject, is_transaction, is_balance, classifier_model, malformed)
       VALUES (?,?,?,?,?,?,?)`,
      [id, received, 'broken', 0, 0, 'qwen3.5:4b', 1],
    );
  }
  // And one good row from May 10 (will stay malformed=0).
  db.run(
    `INSERT INTO email_imports (gmail_message_id, received_at, raw_subject, is_transaction, is_balance, classifier_model, malformed)
     VALUES (?,?,?,?,?,?,?)`,
    ['m-2026-05-10', '2026-05-10T09:00:00Z', 'good', 1, 0, 'qwen3.5:4b', 0],
  );

  const oldestMalformed = db.exec(
    "SELECT MIN(received_at) FROM email_imports WHERE malformed=1"
  )[0].values[0][0];

  // --- Test 1 + 2: cursor rollback --------------------------------------
  const sinceIso = computeSince(CURSOR_ISO, oldestMalformed);
  assert(oldestMalformed === '2026-05-17T10:00:00Z', 'oldest malformed row is May 17');
  assert(sinceIso === '2026-05-17T10:00:00Z', 'sinceIso rolled back to May 17, NOT stuck at May 21');
  assert(sinceIso < CURSOR_ISO, 'rolled-back since is older than saved cursor');

  // --- Test 3: cursor does not regress after a no-new-messages sync -----
  const savedAfterNoNew = saveCursor(sinceIso, CURSOR_ISO);
  assert(savedAfterNoNew === CURSOR_ISO,
    'cursor stays at high-water mark when no new messages arrived');

  // --- Test 4: cursor advances when a newer message arrives -------------
  const newestSeenIso = '2026-05-21T23:00:00.000Z';
  const savedAfterNew = saveCursor(newestSeenIso, CURSOR_ISO);
  assert(savedAfterNew === newestSeenIso,
    'cursor advances past the high-water mark for a genuinely new message');

  // --- Test 5: when there are NO malformed rows, no rollback happens ----
  db.run("UPDATE email_imports SET malformed=0");
  const oldestMalformed2 = db.exec(
    "SELECT MIN(received_at) FROM email_imports WHERE malformed=1"
  )[0].values[0][0];
  assert(oldestMalformed2 === null, 'no malformed rows present');
  const sinceIso2 = computeSince(CURSOR_ISO, oldestMalformed2);
  assert(sinceIso2 === CURSOR_ISO, 'with zero malformed rows, since stays at cursor (no wasted re-pull)');

  // --- Test 6: against the user's REAL DB ------------------------------
  console.log('\n--- Real DB integration check ---');
  try {
    const realDb = new SQL.Database(fs.readFileSync(
      'D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db'));
    const realCursor = JSON.parse(realDb.exec("SELECT value FROM sync_state WHERE key='last_synced_at'")[0].values[0][0]);
    const realOldestMalformed = realDb.exec(
      "SELECT MIN(received_at) FROM email_imports WHERE malformed=1"
    )[0].values[0][0];
    const realSince = computeSince(realCursor, realOldestMalformed);
    console.log('  Real saved cursor:        ' + realCursor);
    console.log('  Real oldest malformed:    ' + realOldestMalformed);
    console.log('  Real effective sinceIso:  ' + realSince);
    assert(realSince < realCursor, 'on real DB, sinceIso rolls back before the saved cursor');
    assert(realSince === realOldestMalformed, 'on real DB, sinceIso lands exactly on oldest malformed row');
  } catch (e) {
    console.log('  (real DB unreadable: ' + e.message + ')');
  }

  console.log('\n' + (failures === 0 ? 'OK — all tests passed' : 'FAIL — ' + failures + ' assertion(s) failed'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
