CREATE TABLE IF NOT EXISTS starforce_price_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  prices TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT
);
INSERT OR IGNORE INTO starforce_price_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS starforce_admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS starforce_admin_sessions_expiry
  ON starforce_admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS starforce_admin_attempts (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  resets_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS starforce_admin_attempts_expiry
  ON starforce_admin_attempts (resets_at);
