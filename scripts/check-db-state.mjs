import initSqlJs from "sql.js";
import fs from "node:fs";
const SQL = await initSqlJs();
const buf = fs.readFileSync("D:/Documents/Parallx Workspaces/Personal Workspace/.parallx/extensions/budget/data.db");
const db = new SQL.Database(buf);

// Does user_overridden column even exist on transactions?
console.log("transactions columns:", JSON.stringify(db.exec("PRAGMA table_info(transactions)")));

// What is user_overridden for the paycheck row?
console.log("paycheck row:", JSON.stringify(db.exec("SELECT id, merchant, amount_cents, tx_type, user_overridden, gmail_message_id FROM transactions WHERE amount_cents=270365")));

// Does email_imports have raw_subject for those gmail_message_ids?
console.log("email rows:", JSON.stringify(db.exec("SELECT t.amount_cents, t.tx_type, t.user_overridden, e.raw_subject FROM transactions t LEFT JOIN email_imports e ON e.gmail_message_id = t.gmail_message_id WHERE t.amount_cents IN (270365, 186970, 90476) ORDER BY t.amount_cents DESC")));
