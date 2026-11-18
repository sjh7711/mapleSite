CREATE TABLE blacksmith_inboxes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  code_hash TEXT,
  accepting INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE blacksmith_requests (
  id TEXT PRIMARY KEY,
  inbox_id TEXT NOT NULL REFERENCES blacksmith_inboxes(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  items TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','working','done')),
  created_at INTEGER NOT NULL
);
CREATE INDEX blacksmith_requests_inbox ON blacksmith_requests(inbox_id, created_at);
CREATE INDEX blacksmith_requests_duplicate ON blacksmith_requests(inbox_id, fingerprint, created_at);
CREATE TABLE blacksmith_limits (key_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, resets_at INTEGER NOT NULL);
CREATE INDEX blacksmith_limits_expiry ON blacksmith_limits(resets_at);
CREATE TRIGGER blacksmith_request_insert AFTER INSERT ON blacksmith_requests BEGIN
  UPDATE blacksmith_inboxes SET revision = revision + 1 WHERE id = NEW.inbox_id;
END;
CREATE TRIGGER blacksmith_request_update AFTER UPDATE ON blacksmith_requests BEGIN
  UPDATE blacksmith_inboxes SET revision = revision + 1 WHERE id = NEW.inbox_id;
END;
CREATE TRIGGER blacksmith_request_delete AFTER DELETE ON blacksmith_requests BEGIN
  UPDATE blacksmith_inboxes SET revision = revision + 1 WHERE id = OLD.inbox_id;
END;
