CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  first_name TEXT NOT NULL,
  class_color TEXT NOT NULL,
  email TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'New',
  source TEXT NOT NULL DEFAULT 'Website'
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  color TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

INSERT OR IGNORE INTO orders
  (id, created_at, first_name, class_color, email, payment_method, notes, total_cents, status, source)
VALUES
  ('legacy-olivia', '2026-08-20T12:00:00.000Z', 'Olivia', 'Unknown', '', 'Cash', 'Handwritten order', 125, 'Current', 'Legacy'),
  ('legacy-unknown', '2026-08-20T12:01:00.000Z', 'Unknown', 'Unknown', '', 'Cash', 'Name was not readable/available', 166, 'Current', 'Legacy'),
  ('legacy-andrew', '2026-08-20T12:02:00.000Z', 'Andrew', 'Unknown', '', 'Cash', 'Handwritten order', 100, 'Current', 'Legacy'),
  ('legacy-ava', '2026-05-01T12:00:00.000Z', 'Ava', 'Unknown', '', 'Cash', 'Historical/manual price preserved; current catalog would total $3.00', 750, 'Historical', 'Legacy');

INSERT INTO order_items (order_id, product_id, product_name, color, quantity, unit_price_cents, line_total_cents) VALUES
  ('legacy-olivia', 'octopus-multi', 'Octopus', 'Multicolor', 1, 125, 125),
  ('legacy-unknown', 'kirby-red', 'Kirby', 'Red', 1, 25, 25),
  ('legacy-unknown', 'half-octopus', 'Half-size Octopus', 'Standard', 1, 66, 66),
  ('legacy-unknown', 'ring', 'Ring', 'Standard', 1, 75, 75),
  ('legacy-andrew', 'kirby-red', 'Kirby', 'Red', 1, 25, 25),
  ('legacy-andrew', 'ring', 'Ring', 'Standard', 1, 75, 75),
  ('legacy-ava', 'weighted-cube', 'Weighted Infinity Cube', 'Unknown', 1, 125, 125),
  ('legacy-ava', 'infinity-cube', 'Infinity Cube', 'Unknown', 1, 75, 75),
  ('legacy-ava', 'octopus', 'Octopus', 'Unknown', 1, 100, 100);
