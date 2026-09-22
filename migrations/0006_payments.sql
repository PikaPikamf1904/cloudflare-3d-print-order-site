CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL CHECK(provider IN ('cash','stripe','paypal')),
  provider_payment_id TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  raw_event_id TEXT,
  UNIQUE(provider, provider_payment_id),
  UNIQUE(provider, raw_event_id)
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, created_at DESC);
