-- 003_page_settings.sql — Cover image, display settings, and organization columns
-- Adds per-page settings for cover images, font preferences, display modes,
-- page locking, and favorites. Used by Capabilities 7–10.

-- Cover image — stored as base64 data URL or CSS gradient string
ALTER TABLE pages ADD COLUMN cover_url TEXT DEFAULT NULL;

-- Cover vertical offset for repositioning (0.0 = top, 1.0 = bottom)
ALTER TABLE pages ADD COLUMN cover_y_offset REAL NOT NULL DEFAULT 0.5;

-- Font family preference: 'default' | 'serif' | 'mono'
ALTER TABLE pages ADD COLUMN font_family TEXT NOT NULL DEFAULT 'default';

-- Full-width mode toggle (0 = normal 860px, 1 = expanded)
ALTER TABLE pages ADD COLUMN full_width INTEGER NOT NULL DEFAULT 0;

-- Small text mode toggle (0 = 16px, 1 = 14px)
ALTER TABLE pages ADD COLUMN small_text INTEGER NOT NULL DEFAULT 0;

-- Page lock toggle (0 = editable, 1 = read-only)
ALTER TABLE pages ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;

-- Favorite/pin toggle for sidebar favorites section
ALTER TABLE pages ADD COLUMN is_favorited INTEGER NOT NULL DEFAULT 0;
