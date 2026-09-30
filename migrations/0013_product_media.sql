-- 0011/0012 are reported production catalog migrations: deliberately reserved.
-- No catalog prices, colors, visibility or order snapshots are changed.
ALTER TABLE catalog_products ADD COLUMN media_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE catalog_products ADD COLUMN media_guard TEXT NOT NULL DEFAULT '';
CREATE TABLE product_media (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES catalog_products(id),
  object_key TEXT NOT NULL UNIQUE,
  preview_key TEXT,
  preview_size INTEGER,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  digest TEXT NOT NULL,
  animated INTEGER NOT NULL DEFAULT 0,
  alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK(state IN ('pending','ready','deleted')),
  replace_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX product_media_order ON product_media(product_id,state,sort_order,id);
CREATE UNIQUE INDEX product_media_replacement ON product_media(replace_id) WHERE state='pending' AND replace_id IS NOT NULL;
-- SQLite serializes reservations, including simultaneous requests on different Workers.
CREATE TRIGGER product_media_capacity BEFORE INSERT ON product_media
WHEN NEW.state IN ('ready','pending') AND NEW.replace_id IS NULL AND
  (SELECT COUNT(*) FROM product_media WHERE product_id=NEW.product_id AND (state='ready' OR (state='pending' AND replace_id IS NULL)))>=10
BEGIN SELECT RAISE(ABORT,'media_limit'); END;
CREATE TRIGGER product_media_replace BEFORE INSERT ON product_media
WHEN NEW.replace_id IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM product_media WHERE id=NEW.replace_id AND product_id=NEW.product_id AND state='ready')
BEGIN SELECT RAISE(ABORT,'media_replace_conflict'); END;
