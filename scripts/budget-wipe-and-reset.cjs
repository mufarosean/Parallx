const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DB = 'D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const bak = `${DB}.bak-pre-wipe-${stamp}`;

// Backup main db file (WAL/SHM will be checkpointed when the app reopens it;
// the .bak is a point-in-time copy of the materialized state).
console.log('Backup ->', bak);
fs.copyFileSync(DB, bak);
// Also copy WAL/SHM if present so the backup is restorable even if the app
// is currently running and the WAL has uncheckpointed pages.
for (const ext of ['-wal', '-shm']) {
  if (fs.existsSync(DB + ext)) fs.copyFileSync(DB + ext, bak + ext);
}

const db = new DatabaseSync(DB);

const before = {};
for (const t of ['transactions', 'email_imports', 'balance_snapshots', 'sync_log', 'sync_state',
                 'accounts', 'categories', 'categorization_rules', 'recurring_series', 'recurring_occurrences']) {
  before[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
}
console.log('\nBEFORE:');
for (const [k,v] of Object.entries(before)) console.log('  ', String(v).padStart(6), k);

// Use a single transaction so an interruption can't half-wipe.
db.exec('BEGIN IMMEDIATE');
try {
  db.exec(`
    DELETE FROM transactions;
    DELETE FROM email_imports;
    DELETE FROM balance_snapshots;
    DELETE FROM sync_log;
    DELETE FROM sync_state;
  `);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

const after = {};
for (const t of Object.keys(before)) {
  after[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
}
console.log('\nAFTER:');
for (const [k,v] of Object.entries(after)) console.log('  ', String(v).padStart(6), k, v !== before[k] ? `(was ${before[k]})` : '');

// Sanity: verify nothing user-curated changed.
const preserved = ['accounts','categories','categorization_rules','recurring_series','recurring_occurrences'];
const broken = preserved.filter(t => after[t] !== before[t]);
if (broken.length) { console.log('\n!! UNEXPECTED CHANGE in:', broken.join(', ')); process.exit(2); }
console.log('\nPreserved (unchanged):', preserved.join(', '));
