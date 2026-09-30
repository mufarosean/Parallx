-- Stacks are retired (2026-09-28). A stack kept several photos under one card.
-- It could be filled but never opened or undone, and when the photo on top was
-- deleted the ones under it stayed out of every view for good. Every photo and
-- video is a card of its own in the library.
--
-- This releases whatever is still in a stack. The two tables stay, empty, so a
-- library that an older build of Parallx opens still reads.

DELETE FROM mo_stack_members;
DELETE FROM mo_stacks;
