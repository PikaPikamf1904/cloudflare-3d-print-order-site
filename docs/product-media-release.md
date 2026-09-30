# Direct product uploads and galleries

The feature was unstarted in this checkout. The new implementation stores original
file bytes and small still previews in private R2, and ordered metadata in D1.
There is no binary or base64 image content in D1. Existing `image_url` and
`image_alt` remain intact as the fallback when a product has no uploaded media.

## Editing and save behavior

Open Admin → Products → View details → Edit product → **Upload photos or GIFs**.
The normal multiple-file picker works with desktop files and mobile photo/file
selection. Desktop dropping is also supported. A new product must be saved once
before attaching media.

Each upload has a waiting/uploading/saved/failed state. Retry reuses its identifier
and verifies the file digest, so a lost response does not duplicate a successful
upload. Uploads and replacements persist immediately. A failed replacement keeps
the previous media published. Successful replacement preserves its position and
alt text. Cover selection moves an image to the first position. Earlier/later
buttons work with touch and keyboard; alt text is editable. Removal requires
confirmation and persists with **Save media** or **Save product**.

Uploading or saving media does not save/reset other product fields. Separate media
revisions reject stale edits; a conflict leaves the form intact. Reload saved media
is explicit and confirms discarding unsaved media settings. Canceling product edits
retains uploads that already succeeded. Save product saves pending media settings
first, then the product fields; if product saving fails, the form remains intact and
the media settings may already be saved.

## Validation and limits

`public/media-tools.js` centralizes 10 uploaded items and 10 MiB per original file.
The D1 capacity trigger mirrors the item limit and serializes concurrent attachments.
Replacements work at the limit. The Worker bounds streamed bodies and multipart
overhead, validates the actual container and compressed pixels, and rejects type
mismatches, SVG/HTML, trailing payloads, broken frames and malformed compression.
Original GIF/WebP bytes are retained exactly. JPEG uses `jpeg-js`; WebP uses a
bundled `@jsquash/webp` decoder WASM; PNG uses native bounded zlib decompression;
GIF uses bounded dictionary validation for every frame.

Additional resource bounds: 16 million pixels per image/frame, 16,384 pixels per
side, 500 animation frames, 128 million total animation-frame pixels, and an
80 MiB decoded PNG/JPEG memory bound. Photos exceeding these bounds should be
exported at a smaller resolution. Still previews are PNG, at most 256 KiB; the
editor makes previews no larger than 240 × 240 without cropping. The normal
uploads are JPEG/JPG, PNG, WebP and GIF. The legacy URL field additionally retains
its previous raster formats. HEIC is not accepted; choose an exported JPEG/PNG
from a phone that stores HEIC originals.

Every mutation uses the existing header admin authentication and rejects foreign
Origin/cross-site requests. R2 keys are generated independently of filenames.
Customers can read only enabled, unarchived product media. Responses set their
validated type, `nosniff`, same-origin resource policy, an ETag and a five-minute
public cache lifetime; authenticated previews are private/no-store. Already cached
public images can remain visible for up to five minutes after hiding/removing them.

Cards and thumbnails use still previews, so they do not load all full animations.
The expanded modal displays the entire image with `object-fit: contain`, position,
previous/next, thumbnail controls, keyboard arrows, touch swipe, Close/Escape and
focus return. Reduced motion requires explicit animation playback. Gallery actions
are independent of cart actions. Zero images do not open a gallery; one image has
disabled previous/next controls.

## Consistency and cleanup

Upload bytes first, then attach metadata in an atomic D1 batch. Capacity or stale
revision failures clean only the attempt's unique, unreferenced object keys. A retry
uses the same media identifier but independent attempt keys. Replacement/removal
marks old metadata deleted before deleting storage. Deleted identifiers remain as
tombstones so an old upload retry cannot resurrect removed media.

If D1 cannot establish whether an object is referenced, keep the object. If deletion
fails, keep the deleted metadata and log deferred cleanup. This intentionally prefers
an orphan over deleting a referenced file. For maintenance, reconcile the private
R2 `products/` prefix against both `object_key` and `preview_key` of all ready/pending
rows. Only delete keys proven unreferenced after checking D1 successfully; exclude
objects created within the last 24 hours, since uploads write storage before D1.
Retain tombstone rows. Do not configure a blanket bucket expiration lifecycle.

## Local checks and live state

Run `npm run test:local`. The aggregate now includes media API tests with disposable
local D1/R2, SQLite/R2 failure doubles, and a fresh headless Chrome profile. The
browser suite exercises the real picker with multiple files, save preservation,
replacement failure/retry, ordering/cover/alt/removal, 360px layout, gallery/cart
separation, keyboard/Escape/focus, synthesized touch swipe, reduced motion and
actual changing GIF/WebP screenshot pixels. It does not prove behavior on a physical
phone or in production R2. Original byte equality is checked independently.

The initial baseline passed 113 checks. No catalog expectations needed changing:
this checkout contains migrations through 0010 and still seeds the older six-product
catalog. Tests separately model the user-reported production prices, colors and
visibility in disposable SQLite and assert that all media mutations leave those
values and locked history unchanged. Do not apply the test fixture to a user DB.

A read-only public catalog check on September 29, 2026 confirmed Ring Standard/Blue/
Yellow at $1.50; Kirby White/Green at $0.20 and Red at $0.25; Infinity Cube White/Green
at $1.75; Weighted Infinity Cube White/Green at $2.25; both octopus products absent
from the sale catalog. It also contains **Passthrough Cone** in Blue/Yellow/Green at
$1.50. Preserve that additional product. The live catalog response has no media
array. Remote migration records and R2 provisioning have not been inspected.

## Release steps — prepared only; none performed in this task

1. Review the local diff, including the six files that were already dirty at task
   start. Obtain release authorization. Do not change prices/colors/visibility,
   historical snapshots, manual Cash/Greenlight workflows or payment/tax settings.
2. Inspect migration records and catalog read-only in the target account:

   ```powershell
   npx wrangler d1 migrations list enrichment-3d-print-orders-db --remote
   npx wrangler d1 execute enrichment-3d-print-orders-db --remote --command "SELECT name FROM d1_migrations ORDER BY id"
   npx wrangler d1 execute enrichment-3d-print-orders-db --remote --command "SELECT p.id,p.name,p.enabled,p.archived_at,c.color,c.price_cents,c.enabled AS color_enabled FROM catalog_products p JOIN catalog_product_colors c ON c.product_id=p.id ORDER BY p.sort_order,c.sort_order"
   ```

   Confirm the reported 0011/0012 are already applied. They are absent locally and
   deliberately reserved; do not recreate or rerun them. Verify that **only
   `0013_product_media.sql` is pending**. Stop and reconcile any unexpected pending
   migration or catalog discrepancy before proceeding. Obtain a current private D1
   backup using the established deployment procedure; do not publish it or include
   its contents in task output.
3. Confirm the intended private R2 bucket exists in the same account. If it does not,
   create it after authorization:

   ```powershell
   npx wrangler r2 bucket create enrichment-3d-print-product-media
   ```

   `wrangler.jsonc` binds that bucket as `PRODUCT_MEDIA`. Keep public r2.dev/custom
   bucket access disabled; the Worker controls publication. Use the existing admin
   secret. No new secret, token, payment provider or public bucket URL is required.
4. Apply only the reviewed pending media migration, then bundle and deploy:

   ```powershell
   npx wrangler d1 migrations apply enrichment-3d-print-orders-db --remote
   npm run test:local
   npx wrangler deploy --dry-run
   npx wrangler deploy --keep-vars
   ```

   This sequence is conditional on the pending-list check in step 2. The migration
   adds two catalog media revision columns and `product_media` with indexes/triggers;
   it never changes catalog/business data. Deploy the Worker and static assets
   together. A rollback to the previous Worker is compatible with the additive
   schema and retains uploaded R2 files.
5. After deployment, verify the catalog and locked receipts read-only. Separately
   authorize a hidden disposable product for actual provider upload/playback tests
   from a PC and a physical phone. Confirm every supported format, preview, replacement,
   retry, cover/order, reduced motion, keyboard and touch behavior, and remove the
   test media afterward. Do not place an order or payment as part of this smoke check.

No commit, push, deployment, remote resource creation or production migration was
performed during implementation.

## Final validation and file inventory

Final `npm run test:local`: **159 passed, 0 failed across 11 suites**. Of these,
113 are the existing baseline checks, 22 are new local workerd/D1/R2 media API
checks, 10 use real disposable SQLite with R2/failure doubles, and 14 are new actual
headless Chrome media checks. The Chrome animation checks decode screenshot pixels
and observe two different frame colors for each format. Syntax checks,
`git diff --check`, and the final Wrangler dry run passed. Physical phone testing,
production R2 writes and remote migration inspection were not run.

A read-only fetch of the live public `product-admin.js` also confirmed no upload
picker and no `ProductMediaEditor`: **the feature is not live yet**. No admin
credentials or customer/order data were accessed for those public checks.

Implementation files added:

- `migrations/0013_product_media.sql`
- `src/media.js`, `src/image-validation.js`, `src/compressed-validation.js`,
  `src/gif-lzw.js`, `src/webp-decoder.js`
- `public/media-tools.js`, `public/product-media-admin.js`,
  `public/product-gallery.js`
- `docs/product-media-release.md`

Existing implementation/configuration files extended:

- `src/index.js`, `src/catalog.js`
- `public/admin.html`, `public/admin.js`, `public/admin.css`,
  `public/product-admin.js`, `public/product-tools.js`
- `public/index.html`, `public/app.js`, `public/styles.css`
- `wrangler.jsonc`, `package.json`, `package-lock.json`

Verification added/extended:

- `tests/media-integration.mjs`, `tests/media-failures.mjs`,
  `tests/media-browser.mjs`, `tests/png-pixel.mjs`
- `tests/fixtures/media/*`, `tests/fixtures/reported-production-catalog.sql`
- `tests/full-local-verification.mjs`
- Ignored local logs/screenshots under `test-artifacts/`, including
  `media-final-local.log`, `media-dry-run.log`, `media-editor-mobile.png`,
  `media-gallery-mobile.png`, and captured GIF/WebP frames.

At task start, `src/index.js`, `public/order.js`,
`tests/admin-redesign-integration.mjs`, `tests/bug-reports-integration.mjs`,
`tests/catalog-integration.mjs`, and `tests/manual-payments-integration.mjs` were
already modified. Their changes were preserved; only `src/index.js` needed further
feature integration. There were no repository `AGENTS.md` files found for this
checkout.

## Release status — September 29, 2026

**Blocked on R2 enablement.** `wrangler r2 bucket list` returns Cloudflare API error
10042 ("Please enable R2 through the Cloudflare Dashboard"). R2 must be enabled by the
account owner in Dashboard → R2 (this requires accepting R2 terms and a payment method,
even for free-tier usage). The Worker cannot deploy with the `PRODUCT_MEDIA` binding
until `enrichment-3d-print-product-media` exists. Nothing was deployed or migrated.

Verified read-only: account `da89f8e9…`, Worker `enrichment-3d-print-orders` live version
`a1299cbc-c7b3-4ed3-8e09-93996546b366` (Sept 22), D1 `enrichment-3d-print-orders-db`
with 0001–0012 applied and only 0013 (plus the new 0014) pending. Catalog matches the
required prices; no product has an `image_url` set.

Additional fixes found during release prep:

- **Cloudinary URLs**: the validator rejected extensionless delivery URLs, the SDK
  `?_a=` query, `%20` names and pasted whitespace. Cloudinary `image/upload` URLs are
  now accepted (query dropped); share-page links get a specific message. The legacy URL
  field still requires alt text of at least 3 characters.
- **Ring could not be saved in the admin** (any field, including the image URL):
  0012 inserted Ring Blue/Yellow with `public_id` NULL (confirmed in production).
  `0014_backfill_variant_public_ids.sql` backfills the IDs; data-only.
- **Drag and drop**: the whole Photos section is the drop target with a hover state;
  stray drops elsewhere no longer open the file and discard unsaved edits; files added
  during an upload are queued. Covered by a real Chrome drag-event test.
- Admin CSP now allows `blob:` previews.

Local: `npm run test:local` 161 passed, 0 failed; `wrangler deploy --dry-run` passed.

### Release sequence once R2 is enabled

```powershell
npx wrangler r2 bucket create enrichment-3d-print-product-media
npx wrangler d1 export enrichment-3d-print-orders-db --remote --output backups/pre-media-<timestamp>.sql
npx wrangler d1 migrations list enrichment-3d-print-orders-db --remote   # expect only 0013, 0014
npx wrangler d1 migrations apply enrichment-3d-print-orders-db --remote  # before deploy: new code reads product_media
npx wrangler deploy
```

### Rollback

- Worker: `npx wrangler rollback a1299cbc-c7b3-4ed3-8e09-93996546b366`. The old Worker
  ignores the additive 0013 columns/table and the 0014 IDs, so no schema rollback is needed.
- Data: 0013/0014 change no business data. Last resort only (discards later orders):
  `npx wrangler d1 time-travel restore enrichment-3d-print-orders-db --timestamp=<pre-migration ISO time>`,
  or restore from the private export in `backups/`.
- R2: leave uploaded objects in place; they are unreachable without the media Worker.
