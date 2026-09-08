import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
const db = new DatabaseSync(path.join(process.argv[2], 'workspace/.parallx/data.db'), { readOnly: true });
console.log(JSON.stringify(db.prepare('SELECT id, workspace_id, plan_json, origin FROM chat_sessions').all(), null, 2));
db.close();
