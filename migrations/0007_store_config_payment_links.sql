-- Existing production data already contains payment_links_json. Keep this pending
-- migration forward-only and idempotent without rebuilding or replacing that table.
CREATE INDEX IF NOT EXISTS idx_store_config_updated_at ON store_config(updated_at);
