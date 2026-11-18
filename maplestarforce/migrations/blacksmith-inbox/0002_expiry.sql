ALTER TABLE blacksmith_inboxes DROP COLUMN code_hash;
ALTER TABLE blacksmith_inboxes ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
UPDATE blacksmith_inboxes SET expires_at = MAX(created_at, COALESCE(
  (SELECT MAX(created_at) FROM blacksmith_requests WHERE inbox_id = blacksmith_inboxes.id), created_at
)) + 43200000;
CREATE INDEX blacksmith_inboxes_expiry ON blacksmith_inboxes(expires_at);
DROP TRIGGER blacksmith_request_insert;
CREATE TRIGGER blacksmith_request_insert AFTER INSERT ON blacksmith_requests BEGIN
  UPDATE blacksmith_inboxes SET revision = revision + 1,
    expires_at = MAX(expires_at, NEW.created_at + 43200000) WHERE id = NEW.inbox_id;
END;
