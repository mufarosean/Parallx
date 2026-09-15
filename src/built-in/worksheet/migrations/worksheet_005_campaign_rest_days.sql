-- Rest days for the campaign: weekdays that carry no quota, stored as a JSON
-- array of weekday numbers (0 = Sunday .. 6 = Saturday). The daily target is
-- set over working days; the streak and the pace step over rest days.
ALTER TABLE ws_campaign ADD COLUMN rest_days TEXT NOT NULL DEFAULT '[]';
