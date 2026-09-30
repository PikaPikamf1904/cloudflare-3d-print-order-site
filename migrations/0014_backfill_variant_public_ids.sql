-- 0012 inserted Ring Blue/Yellow without public_id, so the admin editor could not save
-- the Ring product ("Keep existing variants..."). Backfill IDs the same way as 0009.
-- Data-only: prices, colors, visibility and order snapshots are unchanged.
UPDATE catalog_product_colors SET public_id = 'var-' || lower(hex(randomblob(16))) WHERE public_id IS NULL;
