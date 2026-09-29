-- Catalog update: raise non-Kirby prices by $1 and remove octopus products.
-- Existing orders keep their locked historical line-item prices.

UPDATE catalog_product_colors
SET price_cents = price_cents + 100
WHERE product_id NOT IN ('kirby','octopus','half-octopus');

UPDATE catalog_products
SET enabled = 0
WHERE id IN ('octopus','half-octopus');
