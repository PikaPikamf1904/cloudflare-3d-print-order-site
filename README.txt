3D PRINT ORDER SITE

Local development only
----------------------
This project uses the existing D1 binding in wrangler.jsonc. It never creates or
replaces a remote database. For disposable local database testing only:

  npx wrangler d1 migrations apply enrichment-3d-print-orders-db --local
  npx wrangler deploy --dry-run

Before any future remote migration, inspect Wrangler's remote migration list,
make a verified backup, and apply only reviewed pending migrations with explicit
authorization. Never use a database-create or broad database replacement command.

Frontend
--------
The active frontend is plain HTML, CSS, and JavaScript under public/. It has no
framework build step and no Bolt runtime dependency. The responsive storefront,
receipt, and private admin dashboard share an accessible purple/yellow/blue
design system with light and dark themes.

Friendly routes:

  /                 customer storefront
  /admin            private admin dashboard
  /order/ORDER-ID   public privacy-limited receipt
  /bug-report       local copyable problem report
  /privacy          privacy information
  /terms            shop terms
  /accessibility    accessibility information

Unknown browser routes return the designed 404 page. Unexpected non-API browser
errors use the designed error page. API failures remain safe JSON responses.

Local frontend validation
-------------------------
Start a local Worker in one terminal, then run the API/static suites:

  npx wrangler dev --local --port 8787
  npm run test:storefront
  npm run test:frontend
  npm run test:admin

For the real-browser suite, start Wrangler with a disposable local admin key and
run Chrome headlessly. This key is only a local test value and is not a real
secret:

  npx wrangler dev --local --port 8787 --var ADMIN_KEY:local-ui-test-key
  npm run test:browser

The browser suite verifies desktop and 360px layouts, catalog/cart behavior,
dark mode, receipt privacy, admin login/dashboard/detail views, custom 404, and
browser console errors. Screenshots are written to ignored test-artifacts/.

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

Bug reports (migration 0008)
----------------------------
`migrations/0008_bug_reports.sql` is a forward-only pending migration. It creates
only the private `bug_reports` table and its indexes; it does not alter orders,
catalog, payment, or store-setting data. Apply it only after the normal remote
D1 backup and operator review. The public `/bug-report` form accepts an
allowlisted category, a concise description, optional order/contact details,
and explicitly consented minimal diagnostics. It does not collect passwords,
cookies, browser storage, auth headers, or payment data. The authenticated
Admin **Bug reports** tab supports status, priority, private notes, and
soft-delete/restore. For a disposable-local D1 test run: `node
tests/bug-reports-integration.mjs`.
