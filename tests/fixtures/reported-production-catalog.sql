-- Disposable test DB only. Never apply to production or local user databases.
UPDATE catalog_products SET enabled=0 WHERE id IN ('octopus','half-octopus');
UPDATE catalog_product_colors SET price_cents=150 WHERE product_id='ring';
INSERT INTO catalog_product_colors(product_id,color,price_cents,enabled,sort_order,public_id) VALUES
('ring','Blue',150,1,20,'fixture-ring-blue'),('ring','Yellow',150,1,30,'fixture-ring-yellow');
UPDATE catalog_product_colors SET price_cents=175 WHERE product_id='infinity-cube';
UPDATE catalog_product_colors SET price_cents=225 WHERE product_id='weighted-cube';
