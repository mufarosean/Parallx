-- XP cash-outs (docs/PROBLEM_BANK.md): XP is worth cash at
-- worksheet.xpCashRate (dollars per 100 XP), and Cash Out on the Dashboard
-- records what the student paid themself. What is left to cash out is the
-- campaign's XP minus the cash-outs since it began.
CREATE TABLE IF NOT EXISTS ws_xp_cashout (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  at    INTEGER NOT NULL,
  xp    INTEGER NOT NULL,
  cents INTEGER NOT NULL
);
