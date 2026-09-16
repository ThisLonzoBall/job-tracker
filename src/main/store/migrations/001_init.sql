-- Raw Gmail messages. Retained in full: re-running an improved classifier over
-- stored bodies is how history gets rebuilt, so this table is never pruned.
CREATE TABLE IF NOT EXISTS messages (
  gmail_id           TEXT PRIMARY KEY,
  thread_id          TEXT,
  from_addr          TEXT,
  subject            TEXT,
  received_at        INTEGER NOT NULL,
  body               TEXT,
  label              TEXT NOT NULL DEFAULT 'INBOX',   -- INBOX | SENT
  triaged            INTEGER NOT NULL DEFAULT 0,
  classified_at      INTEGER,
  classifier_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_thread   ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received_at);
-- Drives the "what still needs classifying" queue.
CREATE INDEX IF NOT EXISTS idx_messages_pending  ON messages(triaged, classified_at);

CREATE TABLE IF NOT EXISTS applications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company          TEXT NOT NULL,
  company_norm     TEXT NOT NULL,   -- lowercased, suffix-stripped, for matching
  role             TEXT,
  job_url          TEXT,            -- strongest join key when captured
  source           TEXT NOT NULL,   -- email | sent_mail | extension | manual
  first_seen_at    INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_norm ON applications(company_norm);
CREATE INDEX IF NOT EXISTS idx_applications_url  ON applications(job_url);

-- Append-only. Stage is a fold over these rows, never a column that gets
-- overwritten, so reprocessing recomputes history instead of corrupting it.
CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  gmail_id       TEXT REFERENCES messages(gmail_id),
  type           TEXT NOT NULL,
  occurred_at    INTEGER NOT NULL,
  source         TEXT NOT NULL,
  confidence     REAL NOT NULL DEFAULT 1.0,
  extracted      TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_application ON events(application_id, occurred_at);

-- Makes replaying a message a no-op rather than a duplicate event. Partial so
-- that extension and manual captures, which have no gmail_id, are not collapsed
-- into a single row by NULL comparison rules.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe
  ON events(application_id, gmail_id, type)
  WHERE gmail_id IS NOT NULL;

-- Items the classifier was not confident enough to apply on its own.
CREATE TABLE IF NOT EXISTS review_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_id    TEXT REFERENCES messages(gmail_id),
  payload     TEXT NOT NULL,      -- JSON: what was extracted, and from what
  reason      TEXT NOT NULL,      -- low_confidence | parse_failure | ambiguous_match
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_review_open ON review_queue(resolved_at);

-- history_id, last_full_sync, capture_secret, schema bookkeeping.
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
