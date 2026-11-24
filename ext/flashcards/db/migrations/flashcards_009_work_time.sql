-- Time worked on cards, counted by the app's clock (work.js): seconds with a
-- card showing in a study session while the person is at the desk, by local
-- day and card. `groups` is the card's tags and deck as they were when the
-- time was counted (JSON: [{ group, label }]), so the day's record stays what
-- it was when a card is retagged or deleted. `reviewed` and `was_right` say
-- whether the card was graded that day and whether its last grade of the day
-- was Good or Easy; they follow fc_reviews, an undone grade included.
CREATE TABLE IF NOT EXISTS fc_work_time (
  day       TEXT    NOT NULL,
  card_id   INTEGER NOT NULL,
  groups    TEXT    NOT NULL DEFAULT '[]',
  seconds   INTEGER NOT NULL DEFAULT 0,
  reviewed  INTEGER NOT NULL DEFAULT 0,
  was_right INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, card_id)
);
