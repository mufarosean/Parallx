-- Budget extension — manual assets & liabilities (Net Worth)
--
-- Holdings that are NOT sourced from transaction email: investments,
-- real estate, vehicles, other assets, and loans / other liabilities.
-- Combined with the synced account balances (v_account_latest_balance) to
-- produce a real net-worth figure.
--
-- value_cents is stored as a POSITIVE magnitude; `kind` decides whether it
-- adds to assets or liabilities. Net worth = SUM(asset values) − SUM(liability
-- values).

CREATE TABLE IF NOT EXISTS manual_balances (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'asset'
                     CHECK(kind IN ('asset','liability')),
    asset_class  TEXT NOT NULL DEFAULT 'other_asset'
                     CHECK(asset_class IN ('cash','investment','real_estate','vehicle','other_asset','credit','loan','other_liability')),
    value_cents  INTEGER NOT NULL DEFAULT 0,
    as_of_date   TEXT,
    notes        TEXT,
    archived     INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS manual_balances_kind_idx ON manual_balances(kind);
