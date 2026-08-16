-- M100: user-set colored flags on cards.
--
-- 0 = unflagged; 1..4 map to the four hue tokens the theme already ships
-- (red / yellow / green / blue), so flags follow the app theme in light and
-- dark without introducing a palette of their own.
--
-- Deliberately NOT called "rating": fc_reviews.rating is the 1-4 grade
-- (Again/Hard/Good/Easy) pressed on every card, and overloading the word
-- would make the scheduler and stats code ambiguous to read.

ALTER TABLE fc_cards ADD COLUMN flag INTEGER NOT NULL DEFAULT 0;

-- Partial: the vast majority of cards are unflagged, and every read is
-- "which cards carry a flag".
CREATE INDEX IF NOT EXISTS idx_fc_cards_flag ON fc_cards(flag) WHERE flag != 0;
