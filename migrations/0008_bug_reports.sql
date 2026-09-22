-- Forward-only bug report storage. This migration does not alter existing orders,
-- catalog, payment, or store setting tables.
CREATE TABLE IF NOT EXISTS bug_reports (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('store_catalog','cart','checkout','receipt','admin_login','accessibility','other')),
  description TEXT NOT NULL,
  page_path TEXT NOT NULL,
  order_id TEXT,
  contact_email TEXT,
  diagnostics_json TEXT,
  submission_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','resolved','closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  admin_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status_created ON bug_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_deleted_created ON bug_reports(deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_fingerprint_created ON bug_reports(submission_fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_order_id ON bug_reports(order_id);
