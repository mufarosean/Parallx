const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/data.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t=>t.name).join(', '));
for (const t of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all().map(c=>c.name);
    console.log('  ', t.name, ':', cols.join(','));
  } catch {}
}
