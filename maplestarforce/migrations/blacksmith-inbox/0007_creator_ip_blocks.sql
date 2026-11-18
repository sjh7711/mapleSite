-- Store only a one-way identifier from Cloudflare's trusted client IP header.
-- Older inboxes have no reliable creation IP and remain NULL.
ALTER TABLE blacksmith_inboxes ADD COLUMN creator_ip_hash TEXT;
CREATE TABLE blacksmith_creator_ip_blocks (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL UNIQUE,
  source_name TEXT NOT NULL,
  blocked_at INTEGER NOT NULL
);
-- No inbox foreign key: disposal and automatic expiry must not lift a block.
