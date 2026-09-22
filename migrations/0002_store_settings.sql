CREATE TABLE IF NOT EXISTS store_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), paypal_enabled INTEGER NOT NULL DEFAULT 0 CHECK (paypal_enabled IN (0, 1)), paypal_me_url TEXT NOT NULL DEFAULT '', cash_app_enabled INTEGER NOT NULL DEFAULT 0 CHECK (cash_app_enabled IN (0, 1)), cash_app_url TEXT NOT NULL DEFAULT '', absence_enabled INTEGER NOT NULL DEFAULT 0 CHECK (absence_enabled IN (0, 1)), return_date TEXT NOT NULL DEFAULT '', absence_message TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO store_settings (id, absence_message, updated_at) VALUES (1, 'Orders are still welcome, but I will be gone until [RETURN DATE]. Printing and delivery will resume when I return.', CURRENT_TIMESTAMP);
