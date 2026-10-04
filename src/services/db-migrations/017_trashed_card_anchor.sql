-- 017_trashed_card_anchor.sql — where a trashed page's card was.
--
-- Moving a page to the Trash removes its card from the parent page; Restore
-- used to append the card at the end of the parent.  The card's place is now
-- kept here (JSON: the id of the block it was inside, or null for the page
-- itself, and the id of the block before it) and Restore puts it back there.
ALTER TABLE pages ADD COLUMN trashed_card_anchor TEXT DEFAULT NULL;
