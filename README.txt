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

Payments
--------
Cash remains enabled. Greenlight is a manual external payment link: opening it
does not mark an order paid, and only an authenticated administrator may record
a payment after independently confirming the full amount. Automated online
payment processors remain disabled and require a separate future authorization.
No payment credentials belong in this repository or in D1.

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
not create a database, execute migrations, or set secrets. Existing production orders and all submitted line-item price snapshots are
preserved by the migrations and application code. Publishable migrations contain
schema and configuration only; synthetic history fixtures live under tests/.

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


Catalog update (migration 0011)
-------------------------------
`migrations/0011_catalog_price_update_remove_octopus.sql` raises all non-Kirby catalog prices by $1.00 and disables both octopus products so they no longer appear in the storefront. Existing submitted orders keep their locked historical prices.
