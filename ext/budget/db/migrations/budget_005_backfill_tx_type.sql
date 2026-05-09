-- Migration 005 — Reclassify tx_type from cached email subjects.
--
-- Two problems this migration fixes simultaneously:
--   (1) Older sync runs left tx_type = NULL on extracted rows.
--   (2) `reprocessHistory` previously blanket-set every NULL row to
--       'purchase' regardless of the email content, mis-typing real
--       deposits (paychecks) and transfers (credit-card / mortgage
--       payments) as spend.
--
-- The cached email subject in `email_imports` is ground truth. We
-- reclassify by joining against subject patterns observed in real Chase
-- emails. Rows that the user has manually overridden (user_overridden=1)
-- are NEVER touched.
--
-- Patterns are matched in the order: deposit → transfer → fee → purchase.
-- Anything we cannot confidently classify keeps whatever tx_type it has;
-- the Dashboard "Untyped" card and the budget.reclassifyUntyped command
-- handle the rest.

-- DEPOSIT — direct deposit, Zelle in, paycheck.
UPDATE transactions
   SET tx_type = 'deposit',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE user_overridden = 0
   AND gmail_message_id IS NOT NULL
   AND gmail_message_id IN (
     SELECT gmail_message_id FROM email_imports
      WHERE LOWER(COALESCE(raw_subject,'')) LIKE '%direct deposit posted%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%direct deposit%posted%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%you got paid%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%you received money with zelle%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%payment received from%'
   );

-- TRANSFER — credit-card payment (both directions: scheduled outbound
-- from checking, and received inbound on the credit card), mortgage
-- payment, and explicit account-to-account transfers.
UPDATE transactions
   SET tx_type = 'transfer',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE user_overridden = 0
   AND gmail_message_id IS NOT NULL
   AND gmail_message_id IN (
     SELECT gmail_message_id FROM email_imports
      WHERE LOWER(COALESCE(raw_subject,'')) LIKE '%credit card payment is scheduled%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%we''ve received your%payment%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%we received your%payment%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%automatic payment%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%mortgage payment%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%transfer to your%account%'
   );

-- FEE.
UPDATE transactions
   SET tx_type = 'fee',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE user_overridden = 0
   AND gmail_message_id IS NOT NULL
   AND gmail_message_id IN (
     SELECT gmail_message_id FROM email_imports
      WHERE LOWER(COALESCE(raw_subject,'')) LIKE '%overdraft fee%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%atm fee%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%late fee%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%service fee%'
   );

-- HIDE daily-balance-summary rows that got extracted as transactions.
-- These should never have been transactions in the first place; their
-- balance information lives in the balance_snapshots table.
UPDATE transactions
   SET status = 'hidden',
       notes = COALESCE(notes,'') || ' [auto-hidden: daily summary]',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE user_overridden = 0
   AND status = 'confirmed'
   AND gmail_message_id IS NOT NULL
   AND gmail_message_id IN (
     SELECT gmail_message_id FROM email_imports
      WHERE LOWER(COALESCE(raw_subject,'')) LIKE '%daily summary for account%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%daily account summary%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%account balance alert%'
   );

-- PURCHASE — anything that's still NULL but matches a clear purchase
-- subject. We do NOT overwrite existing tx_type values here; the
-- previous deposit/transfer/fee blocks already corrected the only
-- subjects we're confident about, and everything else stays as-is.
UPDATE transactions
   SET tx_type = 'purchase',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE user_overridden = 0
   AND tx_type IS NULL
   AND gmail_message_id IS NOT NULL
   AND gmail_message_id IN (
     SELECT gmail_message_id FROM email_imports
      WHERE LOWER(COALESCE(raw_subject,'')) LIKE '%you made a $%transaction with%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%you sent %from account%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%debit card transaction of%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%transaction alert%'
         OR LOWER(COALESCE(raw_subject,'')) LIKE '%card was used%'
   );
