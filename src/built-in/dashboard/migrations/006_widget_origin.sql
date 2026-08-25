-- 006_widget_origin.sql — workbench widgets: remember the dashboard page a
-- widget was adopted FROM, so "Return To Dashboard" can send it home (and
-- fall back to a default page when home is gone). NULL for widgets that
-- never left a dashboard and for instances created directly in the
-- workbench. Set/cleared by moveWidgetToPage as widgets cross the
-- workbench boundary.

ALTER TABLE dashboard_widgets ADD COLUMN origin_page_id TEXT;
