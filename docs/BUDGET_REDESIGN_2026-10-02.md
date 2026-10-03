# Budget redesign, 2026-10-02

Built from the "Budget Redesign" canvas (Overview, Review, Transactions, Plan,
Net Worth and Goals, Merchants and Rules). Commits on
`fix/light-mode-and-accent-contrast`: 32b11190 (shell), 674de89e (Overview),
3cf45df4 (Review), 0df48682 (Transactions), a1b23e4a (Plan), b1e88986 (Rules
and cleanup), and the Net Worth and docs commit after it.

## The shape

- **One tab.** Budget opens as one editor (`budget:main`). The sidebar holds
  the month at a glance (what is left to spend, days left, a daily amount),
  the sections with the review count, and the sync status with Sync Now.
  Sync Log and Import / Export are reached from the header's ⋯, with Sync
  Now, Reprocess History… and Budget Settings…. Every old `budget.open*`
  command still works (`COMMAND_ROUTES`), and a tab restored from before
  folds itself into the one tab.
- **One month model.** `readMonthPlan(monthKey)` is the only source of the
  month's numbers: limits, spent, bills paid and bills still to come (from
  Bills), and `computeMonthPlan` turns them into what is left
  (`limit − spent − bills to come`), the everyday budget (limits less the
  bills inside them) and the pace. The sidebar, Overview and Plan all read
  it, so they cannot disagree. Bills are committed money, not pace: rent on
  the 1st no longer reads as "over budget".
- **Ledger changes refresh everything.** `notifyLedgerChanged()` fires from
  Review, the transaction drawer, the chat tools that write, CSV import,
  Reprocess, Plan limits and Categories; every page and the sidebar redraw.

## The pages

- **Overview.** What is left, the everyday pace chart, what the last sync
  did (new rows, AI-typed transfers, possible duplicates, rules learned) with
  Review N, income against a usual month, bills paid and to come, goals,
  spending by category (each row opens its transactions), bills coming up,
  accounts.
- **Review.** One row at a time with the queue on the left: why the sync set
  it aside (read from the notes it writes), the email subject, a side-by-side
  for a possible duplicate, the verdict (Expense, Fee, Income, Transfer,
  Duplicate when flagged, Ignore), the category for that type, and Confirm,
  which moves on and offers Undo in the page. "Remember" is offered only
  where a rule really works: the sync applies rules to expenses, so only an
  Expense can be remembered, and the line says when an existing rule already
  does it or a rule of yours would win instead.
- **Transactions.** Days, newest first, each with what was spent. Quick
  filters: All, Spending, Income, Transfers, Needs Review (every month, the
  same rows the sidebar counts) and Hidden. A deep link's narrowing (a
  category, a day) is a chip that removes itself. Money in is green with +,
  transfers muted. The drawer adds How It Got Here: the email and subject (or
  CSV, or by hand), who typed it, who put it in its category (your rule, a
  learned rule, the AI, you) and whether it waits or was hidden and why.
- **Plan › Budgets.** The month as an allocation of expected income
  (the average of the last three completed months): Bills, Everyday (each
  category's limit, what it spent, the bills inside it, a suggestion from
  the last three months), Goals (what each needs a month to make its date)
  and what is not yet given a job. Above it, "left to spend" with its sum
  written out. A month ahead counts every time a bill falls due in it.
- **Net Worth and Goals.** Holdings by class, each saying where its balance
  comes from (balance emails, or you update it) and when; goals use the same
  "$X a month to make <date>" as Plan.
- **Merchants and Rules.** Every rule and every merchant still left to the
  AI (with Make a Rule…). The rule form's dry run says how many past
  purchases match and which would move, and that categories you set by hand
  stay; "Also change the past ones" applies it.

## Judgment calls

- Undo after a Review verdict is a bar in the page, not a notification:
  notifications with buttons are modal prompts in Parallx.
- Goals have no stored monthly amount, so Plan shows what each goal needs to
  make its date (computed, `goalMonthlyNeed`), not an editable allocation.
  Storing one would need a migration; not done.
- Categories' own limit is the default for any month without a limit in
  Plan; the column is now named "Default limit" to say so.
- "Needs Review" in Transactions ignores the month, because the sidebar
  count does.

## Removed

The old dashboard (`renderDashboardSection`) and everything only it used
(heatmap, donut, insights, trend and cash-flow charts, the account filter),
the old review and transactions tables, the per-row badges, and 160 CSS
rules with them: about 3,000 lines. The older pages lost their Refresh and
Sync Now buttons. Budget's style ratchet: raw colours 38 → 30, px font
sizes 38 → 12, emoji 5 → 3.

## Fixed on the way

- The budget-sync skill never seeded: it called `require()` in the renderer
  and passed relative paths to the fs capability. It ships as
  `skills/budget-sync.js` and is written by workspace URI.
- After a sync's rule promotion, `last_run_status` is saved again with the
  rules learned.
- A transaction added by hand is stored with `source='manual'`.
- The sync's tags (`[cross-check: …]`, `[possible duplicate of …]`,
  `[hidden: …]`) stay stored but out of the drawer's editable note.

## Tests

`budgetMonthPlan`, `budgetReview`, `budgetTransactions`,
`budgetPlanAllocation`, `budgetRuleDryRun` (pure functions through
`__testables`), plus the style ratchet. In-app checks with a seeded ledger
(149 transactions, June to October 2) in dark and light, wide and narrow:
Review's verdicts, Remember, Undo and the database after; Transactions'
filters, deep link and drawer; Plan's numbers against the sidebar and
Overview ($2,221.39 left, $1,865.49 bills paid, $319.97 to come, $8,250
expected income) and a limit change flowing to the sidebar.

## Not done

- Remember for fees (the sync applies rules to purchases only).
- An editable monthly amount per goal.
- A non-modal toast with an action in the kit; Review has its own bar.

## Layout pass, 2026-10-03

Seen in the app (`tests/ui-polish/budget-pages.mjs`, dark and light, 1600
and 1100 wide), after the owner found the pages squeezed and lopsided:

- **One page column.** Every page had its own width (920, 980, 1180 or the
  whole pane), all left-aligned, while the header's ⋯ sat at the pane's far
  edge. The header and every page now share one centred 1180px column
  (`.budget-page`), as Planner's Today does.
- **Actions in the header.** Add Transaction…, New Rule…, Add Category…, Add
  Asset or Debt… and New Goal… were buttons floating in the page body; they
  are the kit page header's primary and secondary actions
  (`setPageActions`).
- **The older pages on the same system.** Bills, Trends, Reconcile,
  Categories, Sync Log and Import / Export drew with the pre-redesign
  classes: VS Code colours, 11px tables with zebra rows, square "ledger"
  cards, toolbars touching the cards under them. Those classes now use the
  `--px-*` tokens, 40px rows and the Overview's card; `makeButton` is the
  kit's button, so there is one button everywhere and no second blue
  primary (Detect Bills is secondary; Show Cancelled is a filter chip). The
  Plan views get the page's vertical rhythm. Trends' two charts sit side by
  side in cards and scale to them.
- **Categories' columns line up.** Its Actions cell was `display: flex`,
  which stops a cell being a table cell and pulled every column out from
  under its heading. Rename and Archive moved to a ⋯ menu per row, as on
  Merchants and Rules; the "Active" pill went (archived rows say so).
- **Net Worth and Goals** puts holdings and goals side by side, the synced
  accounts below as their own table with names you retype in place and a ⋯
  for Archive; on a narrow pane Transactions and As of step aside.
- **Overview** lists every category with spending this month, not only the
  ones with a limit, so its left column is not empty before limits are set;
  a category without a limit is drawn faintly against the month's largest.
- **Plan**: the suggestion button says the amount (Use $520.00).
- Numbers right-align in every table (a `.budget-table td` rule was
  outranking `.budget-amount`).

**A numbers fix found on the way.** The month counted spending and bills in
every category against the limits of the categories that have one, so a
mortgage paid from an unlimited Housing put the month "$850 over plan" and
Everyday at $0. `planScope()` now measures the plan on limited categories
only, keeps all-category totals for what Overview reports as spent and
paid, and Plan says how much went to categories without a limit. Tested in
`budgetMonthPlan` and `budgetPlanAllocation`.

Dropdowns were checked open (Transactions' accounts, Trends' range,
Net Worth's kinds, the transaction drawer's fields): they are the core
`.ui-dropdown` throughout, mounted in the body layer, and none is clipped.

## Bugs found reviewing the redesign, 2026-10-03

After the owner found bugs, four reviewers read the Budget code by area
(money math; Review and Transactions; the other pages and the shell; copy
and consistency), each finding needing a concrete failing case. Fixed in
23e06ce9, b56717cc, 28fec40e and the copy commit after them; each money
and parsing fix has a unit test.

- **Money.** Weekly bills counted once in the current month; an overdue,
  unpaid bill dropped out of "still to come"; any charge whose merchant
  contained a bill's name paid it (a $999 Apple Store purchase paid
  iCloud), and two bills could count one charge; a refund made a bill's
  usual amount negative; the pace line and the pace sentence measured
  different things; a goal due within a month asked for twice what was
  left; a month's limit could not be cleared over a category default;
  income had opposite signs on Overview and Trends.
- **Data.** Double clicks inserted twice; the drawer kept a wrong-kind
  category after a type change and marked a note edit as a type change;
  "Remember" did nothing on a turned-off learned rule; Review's Duplicate
  could hide the only copy; note tags broke on "]"; "Also change the past
  ones" overrode a rule that wins first; rules kept filing into archived
  categories; CSV import broke on multi-line notes, ignored status and
  accepted dates no month shows; Reconcile compared against today.
- **Refresh.** Pages could paint an older read over a newer one
  (`serialRefresh`); six pages never redrew after a sync; bills and kind
  changes left "left to spend" stale; a split editor could leave the
  sidebar driving nothing; bills were read with one query per bill.
- **Copy.** One word per thing (Limits, spending, bills, Net Worth and
  Goals), sentence case for labels and headings, `…` only on what opens a
  dialog, one error pattern ("Could not …"), local times in the Sync Log,
  readable dates everywhere, the kit's close button on the drawers.
