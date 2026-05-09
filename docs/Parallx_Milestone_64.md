# Milestone 64 — Budget extension UX consolidation

## Why

After M63 the budget extension's math is correct (verified May 2026: $1,321.06
spend / $3,035.95 income / 56% savings rate / $72,247.86 net worth on the
test ledger). But the UX is fragmented:

- The sidebar contributes **13 separate sections**, three of which (Dashboard,
  Cash Flow, Reports) re-render the same income/spend/category data three
  different ways.
- On the Dashboard, six of the eight headline cards (Net worth, Spend, Income,
  Savings rate, Review queue, Last sync) are visually styled like data tiles
  but have **no click handler** — they look interactive and aren't.
- The "AI activity" card's sub-text reads "click Reprocess to re-run rules"
  but the card has no click handler — a verbal pointer to a hidden command.
- Recent-activity rows on the Dashboard look like a ledger but can't be opened.
- Categories, Rules, Sync Log, Review Queue, Import/Export all live as
  top-level sidebar items even though they're settings/diagnostics surfaces.
- Reports + Cash Flow + Dashboard's category panel are three implementations
  of the same donut.

The user's verdict: "feels like a bunch of disjoint sheets."

## Audit (file:line citations)

| Section renderer | File | Issue |
|---|---|---|
| `SECTIONS` registry | `ext/budget/main.js` L188 | 13 entries surface in sidebar — fragmentation root |
| `renderSidebarNav` | `ext/budget/main.js` L651 | Iterates the registry, no grouping |
| `renderDashboardSection` | `ext/budget/main.js` L1575 | Top cards not clickable; "AI activity" subtext misleading; no MoM delta; recent rows not drillable |
| `makeCard` | `ext/budget/main.js` L1957 | Has no `onClick` parameter — interactivity has to be bolted on after |
| `renderCashFlowSection` | `ext/budget/main.js` L2066 | Duplicates Dashboard income/spend trends |
| `renderReportsSection` | `ext/budget/main.js` L2165 | Duplicates Dashboard category donut + Cash Flow trends |
| `renderAccountsSection` | `ext/budget/main.js` L1963 | Duplicates Dashboard account strip |
| `renderCategoriesSection` | `ext/budget/main.js` L1427 | Settings table on main nav |
| `renderRulesSection` | `ext/budget/main.js` L2544 | Settings/admin surface on main nav |
| `renderSyncLogSection` | `ext/budget/main.js` L1337 | Diagnostics on main nav |
| `renderImportExportSection` | `ext/budget/main.js` L2838 | Settings/operational surface on main nav |
| `renderReviewQueueSection` | `ext/budget/main.js` L1202 | Already a status filter in Transactions — duplicated |

## Plan

### Sidebar consolidation: 13 → 4

| Sidebar entry | sectionId | Wraps |
|---|---|---|
| Overview | `dashboard` | (unchanged) |
| Transactions | `transactions` | (unchanged; absorbs Review Queue via status filter) |
| Plan | `plan` (new wrapper) | Budgets, Recurring, Reconcile, Cash Flow, Reports |
| Settings | `settings` (new wrapper) | Accounts, Categories, Rules, Review Queue, Sync Log, Import/Export |

Each wrapper renders a horizontal tab strip and mounts the existing
per-section renderer underneath. Existing `budget.openX` commands remain — they
deep-link by setting `_navState.planTab` / `_navState.settingsTab` and opening
the wrapper. This preserves every cross-section navigation already wired up
(donut clicks, category clicks, account clicks).

### Dashboard interactivity

- `makeCard(label, value, sub, opts?)` — accept an optional `onClick` handler
  and add cursor + hover styling automatically.
- Net worth → Plan / Reconcile (or Settings / Accounts).
- Spend → Transactions filtered to `type=spend` for the picker month.
- Income → Transactions filtered to `type=deposit` for the picker month.
- Savings rate → Plan / Cash Flow.
- Review queue → Transactions filtered to `status=review`.
- Last sync → trigger Sync now (the most natural action for a "Last sync N hours ago" pill).
- Replace "AI activity" with a unified **Needs attention** card combining
  review-queue count + untyped count. Click → Transactions filtered to review.
- Recent activity rows clickable → Transactions filtered to that single date.

### MoM delta on Spend/Income

Add a previous-month query to `renderDashboardSection.refresh` and compute
`(current - prev) / prev * 100`. Show as `±X% vs last month` in the card sub.

### Manifest

Add two commands: `budget.openPlan`, `budget.openSettings`. Keep all 13 existing
`budget.openX` commands so palette deep-linking and existing buttons still work.

## Out of scope (for this milestone)

- Transaction detail modal (clicking a transaction → modal showing email
  subject + AI rationale + recategorize). Worth doing later but adds surface
  area; not blocking the consolidation.
- Refund storage convention (`tx_type='purchase'` + negative amount).
  Display layer handles it correctly; internal change is risky and unrelated
  to UX.
- Auto-promotion of AI categorizations to rules (already handled at 3+ matches
  per existing comment).

## Verification

1. `node scripts/verify-dashboard.mjs` — math unchanged.
2. Restart Parallx, open Budget sidebar — should see exactly 4 entries.
3. Click each top dashboard card — should drill into the right view.
4. Click a recent activity row — Transactions opens filtered to that date.
5. Existing donut/category/account-card clicks still work.
6. Old palette commands (`budget.openCategories`, `budget.openRules`, etc.)
   open Settings on the right tab.


---

## Pass 2 � Visual overhaul (this session)

The first pass shipped the structural cleanup (4 sidebar items, clickable cards,
MoM deltas). The user looked at it and said the dashboard was "ugly and not
really exciting": cards varied in size, status info ("Untyped", "Needs
attention", "Review queue", "Last sync") cluttered the grid, the Accounts
header rendered inline beside the cards, account ��6307 was permanently
mislabelled "Checking" with no UI to fix it, and there was no chart of changing
balance even though Chase emails balances daily.

### Changes

1. **Hero cards reduced to 4** (Net worth � Spend � Income � Savings rate),
   equal-height grid via `auto-fit minmax(200px, 1fr)`.
2. **Status chips** above the hero row replace the "Review" and "Untyped"
   cards. Pills only appear when the count is non-zero. Click ? drill into
   Transactions / re-run AI classifier.
3. **Last sync** moved from a card to a tiny meta line on the toolbar
   (`Last sync 2h ago � n new`). Refresh button removed � Sync Now covers it.
4. **Net-worth sparkline** (30-day, SVG, accent green) injected directly into
   the Net worth card. Reuses the same trend query as the chart below.
5. **Balance trend chart** � 90-day SVG line chart with three series (Cash,
   Credit owed, Net worth), gridlines, axis labels, hover crosshair + tooltip,
   and a legend. Driven by a single CTE that joins each `accounts` row against
   distinct `balance_snapshots.snapshot_date` and pulls the latest balance = d.
6. **Daily activity heatmap** � calendar grid (weeks � Sun-Sat), cell
   intensity = spend (or income, toggleable), tooltip shows date + amount,
   click filters Transactions by that exact day. New `dayYmd` field added to
   `_navState.txFilter` and honoured by `renderTransactionsSection`.
7. **Accounts grid** � `<h3>Accounts</h3>` now sits on its own line above a
   real `display: grid` of account cards, fixing the layout bug where the
   header rendered as a flex sibling of the cards.
8. **Account kind is editable** � each account card has an inline `<select>`
   for Checking � Savings � Credit card � Account that writes
   `UPDATE accounts SET kind=? WHERE id=?` and refreshes the dashboard.
   This fixes the bug where account ��6307 (a savings account) was permanently
   labelled "Checking" because the auto-classifier guessed wrong from a
   daily-summary email subject.

### New helpers in `ext/budget/main.js`

- `fmtRelativeTime(iso)` � "5m ago" / "yesterday" / fallback to date.
- `buildSparkline(values, opts)` � minimal SVG path with subtle area fill.
- `buildBalanceTrendChart(rows)` � full 90-day chart with hover.
- `buildDailyHeatmap(range, rows, onClick)` � month grid with spend/income toggle.
- `buildAccountCard(a, api, onChanged)` � now takes a refresh callback so the
  kind-edit `<select>` can re-render in place after the UPDATE.

### Verification

- `node --check ext/budget/main.js` clean.
- `node scripts/verify-dashboard.mjs` � math invariants unchanged.
- `npx vitest run` � 2655 pass, only the 3 pre-existing canvas-gate failures
  remain (unrelated to budget).
---

## Pass 3 — Chart redesign (interactive controls + typography)

User feedback after Pass 2: the trend chart used "weird fonts", the values
"looked squished", there were "no controls", "no way of selecting weeks", the
calendar showed only the current week's data, and the heatmap "size was not
dynamic and looked awful". Mandate: research finance dashboard UI extensively,
write principles to memory, then redesign.

Research saved to `/memories/repo/finance-ui-design-principles.md` (Carbon,
Material 2, Refactoring UI, Lunch Money). Key principles applied:

1. **SVG text needs an explicit `font-family`** or it falls back to serif on
   Windows. Set on the `<svg>` element AND in CSS `.budget-chart-axis`.
2. **Time-series charts must have a range selector.** Trend chart now has
   7D / 30D / 90D / All segmented control with active-state styling.
3. **Calendar heatmap needs prev/next month nav.** Heatmap now owns its own
   month state and accepts a `queryFn(year, month0)` callback so it can
   re-fetch when the user navigates.
4. **No raw `$X.XX` text inside heatmap cells** (hides the intensity gradient
   and creates visual noise). Cells now show only the day number + a discrete
   5-bucket intensity color; full amount appears on hover via `title`.
5. **Square aspect-ratio cells** (`aspect-ratio: 1/1`) that scale with the
   container, capped at `max-width: 460px` for the whole grid.
6. **Discrete intensity buckets** (5 steps) read more honestly than a smooth
   gradient. Color-mix with `--vscode-charts-red` / `green`.
7. **Headline delta** in the legend ("+$1,234 over 30D") gives the
   chart a takeaway in one glance.

### Changes in `ext/budget/main.js`

- `buildBalanceTrendChart(rows)` — now self-contained with header + segmented
  range pills. Auto-scales Y, draws Net worth solid + Cash/Credit dashed,
  hover crosshair + dot + tooltip, legend with delta. Increased viewBox to
  760×240, padL 64, padB 32 for axis breathing room.
- `buildDailyHeatmap({ initialYear, initialMonth0, queryFn, onDayClick })` —
  signature changed. Owns month nav (◀ / ▶), spend/income toggle, total
  label. Re-fetches data on month change. Highlights today.
- New helpers: `legendItem`, `fmtAxisMoney` ($72k / $1.2M abbreviation),
  `formatTrendDateLabel` (`5/15` for short ranges, `May 15` for long).
- New CSS: `.budget-segmented`, `.budget-segmented-btn`, `.budget-iconbtn`,
  `.budget-trend-header`, `.budget-trend-delta.is-up/.is-down`,
  `.budget-heatmap-header`, `.budget-heatmap-nav`, `.budget-heatmap-month`,
  `.budget-heatmap-dow-row`, `.budget-heatmap-cell.bucket-{1..4}` per mode,
  `.budget-heatmap-cell.is-today`, `.budget-chart-hover`, `.budget-chart-dot`.
- All SVG text gets `font-family: var(--vscode-font-family)` via CSS class
  AND inline on the `<svg>` element (defensive — some renderers skip
  inherited font on SVG text).

### Verification

- `node --check ext/budget/main.js` clean.
- `node scripts/verify-dashboard.mjs` — math unchanged, queries identical.
- `npx vitest run` — 2655 pass / 3 pre-existing canvas-gate failures.
