CREATE TABLE IF NOT EXISTS soul_ether_price_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  prices TEXT NOT NULL DEFAULT '[18,18,18,70]',
  updated_at TEXT
);
INSERT OR IGNORE INTO soul_ether_price_config (id) VALUES (1);
