-- Additive only: catalog changes never update order or order-item snapshots.
ALTER TABLE catalog_products ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN image_alt TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_products ADD COLUMN archived_at TEXT;
ALTER TABLE catalog_products ADD COLUMN version TEXT NOT NULL DEFAULT '';
ALTER TABLE catalog_product_colors ADD COLUMN public_id TEXT;
ALTER TABLE catalog_product_colors ADD COLUMN swatch TEXT NOT NULL DEFAULT '';
UPDATE catalog_product_colors SET public_id = 'var-' || lower(hex(randomblob(16))) WHERE public_id IS NULL;
CREATE UNIQUE INDEX catalog_variant_public_id ON catalog_product_colors(public_id);
CREATE INDEX catalog_visibility_sort ON catalog_products(archived_at, enabled, sort_order);
