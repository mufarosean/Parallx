# Budget extension review, 2026-09-21

Asked for: a thorough review of `ext/budget` (10,357 lines, built months ago
with a smaller model), the gaps and bugs found, the fixes made, and what to
build next, streamlining without hiding what the AI does.

The extension is in better shape than its age suggests. The sync pipeline is
deterministic JS with one small model call per stage, the stall watchdog and
circuit breaker are sound, money is integer cents, every categorisation
carries its source (rule, AI, manual, seed) and the row shows it as a badge.
The defects found are at the seams: a tool whose schema and handler disagree,
a classifier decision that nothing checks, and a rule learner that can
overrule the user.

## Fixed today

1. **`budget.updateTransaction` dropped the fields its own schema advertised.**
   The tool told the model to send `category`, `tx_type` and
   `transaction_date`; the handler read `categoryId`, `txType` and
   `transactionDate`, so a category name or a type from the model was ignored
   and the reply still said "updated". This is why the rows the local model
   "fixed" were still transfers. The handler now reads every spelling,
   resolves a category by name, validates the type, the status and the date,
   marks the category manual with the rule link cleared, stamps `updated_at`,
   learns the same exact-merchant rule the editor drawer learns, and replies
   with exactly what changed and whether a rule was learned.
2. **A transfer was the model's word and nothing checked it.** Stage one
   decides the type; the code trusted it, never categorised a transfer, and
   left it out of every spending total. Two changes: the prompt now says what
   a transfer is not (a Zelle send, a bill payment to a payee, autopay to an
   insurer, any charge, "even when the email says payment"), and a transfer
   whose payee does not look like one of the user's own accounts lands in
   review with the reason written on the row, never silently confirmed.
3. **Possible duplicates.** The same charge can arrive in two emails (an
   alert, then a posting; a payment scheduled, then received). A match on
   amount, payee and a two-day window from a different email now goes to
   review as "possible duplicate of <id>" and is counted in the run summary.
4. **Reprocess patterns.** The subject patterns that backfill untyped rows
   are now a module constant, first match wins, with the Zelle send and the
   bill-payment-to-a-payee patterns above the transfer ones; "payment to
   your <account>" stays a transfer. Unit-tested.
5. **Learned rules could overrule the user.** Rule promotion (three AI
   answers for one merchant become a rule) only looked for disagreeing AI
   rows. It now also refuses when the user set a different category by hand.
6. **Confirmation.** `updateTransaction`, `resolveReview` and
   `renameCategory` mutate the ledger and did not ask; they do now, like
   `setBudget`, `addRule` and `deleteTransaction` always did.

Tests: `tests/unit/budgetReviewFixes.test.ts` (payee-looks-like-an-account,
subject patterns, JSON-through-prose); the existing budget tests still pass.

**Records already in the ledger are not touched by any of this.** The rows
mistyped before today need `tx_type` set to `purchase`, which the repaired
tool can now actually do, or the Type field in the editor drawer.

## Open gaps, not fixed

- **The type has no provenance.** A category says who set it (rule, AI, you);
  a type does not. Add `tx_type_source` and show it the same way, so a
  transfer the AI chose reads differently from one you set.
- **Pending versus posted.** `posted` exists on the row and nothing sets it
  from email. A "pending" alert followed by a "posted" alert should update
  one row, not produce a duplicate for review.
- **Merchant normalisation.** Rules and recurring detection match raw payee
  text ("SQ *COFFEE SHOP 0042"). A normalised merchant key (strip processor
  prefixes, store numbers, city suffixes) would make rules hit more and the
  recurring detector cleaner.
- **The category prompt sees only merchant and amount.** Adding the email
  subject and the account kind would let the model tell a card annual fee
  from a purchase at the same payee.
- **Balance snapshots** are inserted without a check for an identical
  snapshot from a resent summary.
- **`budget.runSync` runs without confirmation.** Defensible, since it only
  reads Gmail and writes the ledger, but it is a long run on the study
  machine's GPU; a confirmation with the expected email count would be kinder.
- **Two review mechanisms.** `pending_review` (per email) and
  `status='review'` (per transaction) both exist; the queue shows the latter.
  Fold the first into the second or retire it.

## What to build next

Each of these streamlines a real loop without hiding a decision.

1. **Type provenance and a "what the AI decided" strip.** Every row shows
   the type's source beside the category's source, and the run summary
   lists the decisions the model made that a person may want to check:
   transfers, low-confidence extractions, learned rules. One click on any of
   them opens the row.
2. **Review queue with one-key verdicts.** For each queued row: This Is A
   Purchase, This Is A Transfer, Duplicate (merge into the other), Ignore.
   Each verdict teaches the matching rule and says so on the spot.
3. **Pending to posted.** Treat a later email for the same charge as an
   update to the row, flipping `posted`, instead of a second row.
4. **Merchant normalisation with a merchant table.** Payee text maps to a
   merchant record with a display name, a category default and a rule; the
   Rules page becomes a merchant page.
5. **Scheduled sync through Automations.** The app has Automations over the
   cron service; a morning sync with the run summary posted to the activity
   journal is one automation away, and the journal is where the app's
   awareness loop reads.
6. **Counterparty accounts for transfers.** A credit card payment from
   checking is one transfer with two sides; linking both accounts makes net
   worth and cash flow right without a category.
7. **Rule dry-run.** Before saving a rule, show how many past rows it would
   match and which categories they carry now.
8. **Issuer presets.** The Gmail query defaults to one issuer; a preset list
   (Chase, Amex, Capital One, Discover) with their subject patterns would let
   another card join without writing Gmail search syntax.

## Built after the review, same day ("I trust you to do the work")

1. **Type provenance.** `tx_type_source` (migration 017): `ai` on import,
   `subject` from Reprocess, `manual` from the editor drawer, the review
   queue and the chat tools, `csv` from an import. Shown as a small badge
   beside the type in the transactions table and the review queue, the way
   the category's source already was.
2. **What the AI decided, on the Overview.** The Needs Attention panel now
   lists the transfers the AI typed this month with the money kept out of
   spending (Check opens them), the possible duplicates flagged on the last
   sync (Open Review), and the rules learned on the last sync (Open Rules).
3. **Review queue verdicts.** The type is a dropdown on the row: choose
   Purchase or Transfer, pick a category, Confirm. The reason the row is in
   review is written under the type. A row flagged as a possible duplicate
   gets a one-key Duplicate button that hides it with the reason noted.
4. **Rule dry-run.** The rule form shows, as you type, how many past
   transactions the pattern would match and which categories they carry now.
5. **Activity journal.** A completed sync leaves one line in the app's
   activity language with its counts, so a scheduled sync (an Automation
   over `budget.sync`) and the awareness loop read the same thing.
6. **Merchant normalisation.** `normalizeMerchant` strips processor prefixes
   (SQ *, TST*, PAYPAL *), store numbers and a trailing state; a `contains`
   rule matches the normalised payee as well as the raw text, so one rule
   covers a chain. `exact` stays exact on the raw text.

Still open from the list above: pending-to-posted as an update rather than a
second row, counterparty accounts for transfers, issuer presets, the second
review table, balance-snapshot dedupe.
