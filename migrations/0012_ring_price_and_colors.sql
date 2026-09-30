-- Ring catalog update: set price to $1.50 and add Blue and Yellow options.
UPDATE catalog_product_colors
SET price_cents = 150
WHERE product_id = 'ring';

INSERT OR IGNORE INTO catalog_product_colors(product_id,color,price_cents,enabled,sort_order)
VALUES
  ('ring','Blue',150,1,20),
  ('ring','Yellow',150,1,30);
