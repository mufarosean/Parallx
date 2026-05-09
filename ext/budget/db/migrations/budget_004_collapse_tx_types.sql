-- Budget extension — collapse redundant tx_types (M63 P3)
--
-- Eliminates two redundant tx_type values:
--
--   • 'refund'      → 'purchase' with negative amount_cents.
--                     The sign of the amount already encodes direction; carrying
--                     a separate type forced every spend query to UNION two
--                     CASE branches and undercounted negatives in roll-ups.
--
--   • 'cc_payment'  → 'transfer'.
--                     Paying a credit card from checking IS a transfer between
--                     the user's own accounts. A separate label only existed
--                     because the LLM used it; downstream we treated the two
--                     identically (both excluded from spend).
--
-- The CHECK constraint installed in 002 still allows the old labels, so no
-- table rebuild is required — only data updates.

PRAGMA foreign_keys = ON;

UPDATE transactions SET tx_type = 'purchase' WHERE tx_type = 'refund';
UPDATE transactions SET tx_type = 'transfer' WHERE tx_type = 'cc_payment';
