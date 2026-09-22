-- Synthetic local-only fixture. It contains no production customer data.
INSERT INTO orders
  (id, created_at, first_name, class_color, email, payment_method, notes, total_cents, status, source)
VALUES
  ('legacy-test-history', '2000-01-01T00:00:00.000Z', 'Test Customer', 'Yellow', '', 'Cash', 'Synthetic locked-price fixture', 750, 'Historical', 'Legacy');

INSERT INTO order_items
  (order_id, product_id, product_name, color, quantity, unit_price_cents, line_total_cents)
VALUES
  ('legacy-test-history', 'weighted-cube', 'Weighted Infinity Cube', 'Fixture', 1, 125, 125),
  ('legacy-test-history', 'infinity-cube', 'Infinity Cube', 'Fixture', 1, 75, 75),
  ('legacy-test-history', 'octopus', 'Octopus', 'Fixture', 1, 100, 100);
