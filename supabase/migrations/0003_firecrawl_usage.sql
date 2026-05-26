-- Persist Firecrawl API key usage so it survives worker restarts.
-- Worker reads the key list from FIRECRAWL_API_KEYS env var and upserts
-- usage counters into this table after each scrape.
--
-- Important: this table stores only the *key name* (e.g. 'key-1', 'key-7').
-- The actual fc-... secret never touches the database — it lives only in
-- the worker's environment variables.

CREATE TABLE IF NOT EXISTS firecrawl_key_usage (
  key_name TEXT PRIMARY KEY,
  credits_used INT NOT NULL DEFAULT 0,
  monthly_limit INT NOT NULL DEFAULT 1000,
  exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  last_used_at TIMESTAMPTZ,
  exhausted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only the service role should touch this table.
ALTER TABLE firecrawl_key_usage ENABLE ROW LEVEL SECURITY;
-- No policies — service_role bypasses RLS, no anon access at all.
