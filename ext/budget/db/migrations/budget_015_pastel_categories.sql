-- Budget extension — recolour the seeded categories to a soft pastel palette.
--
-- Only rewrites rows still on the original bright default colours, mapped to
-- their pastel equivalent — so any colour the user has customised is left
-- alone. Idempotent (re-running matches nothing once converted).

UPDATE categories SET color='#7ed6a5' WHERE color='#22c55e';  -- Groceries
UPDATE categories SET color='#f0b07e' WHERE color='#f97316';  -- Dining
UPDATE categories SET color='#8fb3e8' WHERE color='#3b82f6';  -- Transport
UPDATE categories SET color='#e6cb7a' WHERE color='#eab308';  -- Utilities
UPDATE categories SET color='#e8a3c4' WHERE color='#ec4899';  -- Shopping
UPDATE categories SET color='#e89595' WHERE color='#ef4444';  -- Health
UPDATE categories SET color='#c2a3e6' WHERE color='#a855f7';  -- Entertainment
UPDATE categories SET color='#84cdd6' WHERE color='#06b6d4';  -- Subscriptions
UPDATE categories SET color='#93c2ea' WHERE color='#0ea5e9';  -- Travel
UPDATE categories SET color='#b3bccb' WHERE color='#94a3b8';  -- Other
UPDATE categories SET color='#7fcf9b' WHERE color='#16a34a';  -- Income
UPDATE categories SET color='#9aa7b8' WHERE color='#64748b';  -- Transfer
