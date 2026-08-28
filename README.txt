3D PRINT ORDER SITE

Local development only
----------------------
This project uses the existing D1 binding in wrangler.jsonc. It never creates,
replaces, or seeds a remote database. Apply migrations locally first:

  npx wrangler d1 migrations apply enrichment-3d-print-orders-db --local
  npx wrangler deploy --dry-run

Before any future deployment, apply the already-reviewed forward-only migrations
0003 through 0006 to the existing remote database, then deploy. Do not use a
database-create command or broad database replacement command.

Secrets
-------
Secrets are never put in wrangler.jsonc, HTML, JavaScript, D1, or this archive.
For a real deployment set these interactively (do not paste values into source):

  wrangler secret put STRIPE_SECRET_KEY
  wrangler secret put STRIPE_WEBHOOK_SECRET
  wrangler secret put PAYPAL_CLIENT_ID
  wrangler secret put PAYPAL_CLIENT_SECRET

Use Stripe test keys and PayPal sandbox while testing. Admin settings only show
whether the necessary credential bindings are configured; they never return a
secret. Stripe Checkout uses the order's locked D1 total and raw-body signed
webhooks. PayPal Orders v2 create/capture is server-controlled and validates the
locked total again before marking an order paid.

URLs after deployment
---------------------
Customer storefront: https://YOUR-WORKER.workers.dev/
Admin dashboard:     https://YOUR-WORKER.workers.dev/admin
Customer receipt:    https://YOUR-WORKER.workers.dev/order/3D-XXXXXXXX

QR generation
-------------
Install the small QR CLI development dependency once, then run:

  npm install --save-dev qrcode
  node scripts/generate-qr.mjs https://YOUR-WORKER.workers.dev/

The script refuses placeholder or non-HTTPS URLs and writes customer-qr.png and
customer-qr.svg. It only encodes the public customer URL.

Safety
------
The PowerShell deployment helper performs a dry run only. It intentionally does
not create a database, execute migrations, or set secrets. Existing historical
orders, including Ava's $7.50 record, and all submitted line-item price snapshots
are preserved by the migrations and application code.
