-- 005_page_refresh_policy.sql — M86 C4: page-level refresh schedules.
-- A dashboard page may carry its own refresh policy ("weekdays 7:00");
-- firing refreshes every widget on the page headlessly (dashboard main
-- schedules these — they run whether or not the page is open). NULL = off.

ALTER TABLE dashboard_pages ADD COLUMN refresh_policy_json TEXT;
