-- Forward-only support for audited Cash and Greenlight manual payments.
-- Existing orders, locked line items, totals, and provider payment history are untouched.
CREATE TABLE IF NOT EXISTS manual_payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL CHECK(method IN ('cash','greenlight')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  private_reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','reversed')),
  created_at TEXT NOT NULL,
  reversed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_manual_payments_order
  ON manual_payments(order_id, created_at DESC);

UPDATE store_config
SET payment_links_json = json_set(
      CASE WHEN json_valid(payment_links_json) THEN payment_links_json ELSE '{}' END,
      '$.cash.enabled', json('true'),
      '$.greenlight.enabled', json('true'),
      '$.greenlight.url', 'https://gl.me/u/gqpcpm2TtjkK',
      '$.stripe.enabled', json('false'),
      '$.stripe.cashAppEnabled', json('false'),
      '$.paypal.enabled', json('false'),
      '$.venmo.enabled', json('false')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
