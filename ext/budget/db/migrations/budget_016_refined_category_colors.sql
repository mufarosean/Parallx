-- Budget extension — refined category palette (replaces both the original
-- bright defaults and the short-lived pastel set with a harmonized, vivid-but-
-- not-neon palette). Maps from BOTH prior values so it lands correctly whether
-- or not migration 015 (pastel) had already been applied. Idempotent; only
-- touches rows still on a known default colour.

-- Groceries
UPDATE categories SET color='#5cb87a' WHERE color IN ('#22c55e','#7ed6a5');
-- Dining
UPDATE categories SET color='#e8924a' WHERE color IN ('#f97316','#f0b07e');
-- Transport
UPDATE categories SET color='#5b8fd6' WHERE color IN ('#3b82f6','#8fb3e8');
-- Utilities
UPDATE categories SET color='#e3c04e' WHERE color IN ('#eab308','#e6cb7a');
-- Shopping
UPDATE categories SET color='#e07ba0' WHERE color IN ('#ec4899','#e8a3c4');
-- Health
UPDATE categories SET color='#e0625e' WHERE color IN ('#ef4444','#e89595');
-- Entertainment
UPDATE categories SET color='#b07fb0' WHERE color IN ('#a855f7','#c2a3e6');
-- Subscriptions
UPDATE categories SET color='#5bb5bf' WHERE color IN ('#06b6d4','#84cdd6');
-- Travel
UPDATE categories SET color='#b08968' WHERE color IN ('#0ea5e9','#93c2ea');
-- Other
UPDATE categories SET color='#98a2b3' WHERE color IN ('#94a3b8','#b3bccb');
-- Income
UPDATE categories SET color='#4e9e6a' WHERE color IN ('#16a34a','#7fcf9b');
-- Transfer
UPDATE categories SET color='#7d8aa0' WHERE color IN ('#64748b','#9aa7b8');
