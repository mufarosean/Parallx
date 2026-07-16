-- 004_widget_provider.sql — M86: record which tool provided a widget's type
-- at the moment the instance was added, so the unavailable-placeholder can
-- say "provided by X, currently unavailable" (and offer re-enabling) when
-- that tool is disabled or uninstalled. NULL for pre-M86 instances.

ALTER TABLE dashboard_widgets ADD COLUMN provider_tool_id TEXT;
