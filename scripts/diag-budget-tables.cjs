const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db');
const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
for (const x of t) {
  try {
    const c = db.prepare(`SELECT COUNT(*) c FROM "${x.name}"`).get();
    console.log(String(c.c).padStart(7), x.name);
  } catch (e) { console.log('    err', x.name, e.message); }
}
