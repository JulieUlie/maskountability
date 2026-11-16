-- Private queue for public claim submissions. Nothing here is published automatically.
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  company TEXT NOT NULL,
  claim TEXT NOT NULL,
  source_url TEXT,
  evidence TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status, created_at);
