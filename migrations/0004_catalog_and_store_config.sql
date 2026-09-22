CREATE TABLE IF NOT EXISTS catalog_products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS catalog_product_colors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL REFERENCES catalog_products(id), color TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents >= 0), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), sort_order INTEGER NOT NULL, UNIQUE(product_id, color)
);
CREATE TABLE IF NOT EXISTS store_config (
  id INTEGER PRIMARY KEY CHECK(id=1), store_name TEXT NOT NULL, ordering_open INTEGER NOT NULL DEFAULT 1 CHECK(ordering_open IN (0,1)), absence_enabled INTEGER NOT NULL DEFAULT 0 CHECK(absence_enabled IN (0,1)), absence_message TEXT NOT NULL DEFAULT '', payment_instructions TEXT NOT NULL DEFAULT '', price_disclaimer TEXT NOT NULL, payment_links_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO catalog_products(id,name,sort_order) VALUES ('ring','Ring',10),('octopus','Regular Octopus',20),('half-octopus','Half-size Octopus',30),('kirby','Kirby',40),('infinity-cube','Infinity Cube',50),('weighted-cube','Weighted Infinity Cube',60);
INSERT OR IGNORE INTO catalog_product_colors(product_id,color,price_cents,sort_order) VALUES ('ring','Standard',75,10),('octopus','White',100,10),('octopus','Green',100,20),('octopus','Red',110,30),('octopus','Multicolor',125,40),('half-octopus','White',66,10),('half-octopus','Green',66,20),('half-octopus','Red',75,30),('half-octopus','Multicolor',85,40),('kirby','White',20,10),('kirby','Green',20,20),('kirby','Red',25,30),('infinity-cube','White',75,10),('infinity-cube','Green',75,20),('weighted-cube','White',125,10),('weighted-cube','Green',125,20);
INSERT OR IGNORE INTO store_config(id,store_name,price_disclaimer) VALUES (1,'Enrichment 3D Print Shop','Prices are subject to change. Once you submit an order, the checkout price is locked in for that order.');
CREATE INDEX IF NOT EXISTS idx_catalog_colors_product ON catalog_product_colors(product_id,sort_order);
