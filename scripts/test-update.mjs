import initSqlJs from "sql.js";
import fs from "node:fs";
const SQL = await initSqlJs();
const buf = fs.readFileSync("D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db");
const db = new SQL.Database(buf);

// Try the exact UPDATE from migration 005 deposit block.
db.run(`UPDATE transactions
   SET tx_type = 'deposit'
 WHERE user_overridden = 0
   AND gmail_message_id IS NOT NULL
   AND gmail_message_id IN (
     SELECT gmail_message_id FROM email_imports
      WHERE LOWER(COALESCE(raw_subject,'')) LIKE '%direct deposit posted%'
   )`);
console.log("changes:", db.getRowsModified());

console.log("after:", JSON.stringify(db.exec("SELECT tx_type, COUNT(*) n FROM transactions GROUP BY tx_type")));
