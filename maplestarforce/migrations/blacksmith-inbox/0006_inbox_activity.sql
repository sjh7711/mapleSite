ALTER TABLE blacksmith_inboxes ADD COLUMN last_submitted_at INTEGER;
ALTER TABLE blacksmith_inboxes ADD COLUMN last_completed_at INTEGER;

-- Expiry retains the latest accepted submission time even after withdrawal or
-- rejection. An empty inbox's creation time is not a submission.
UPDATE blacksmith_inboxes SET last_submitted_at = CASE
  WHEN expires_at > created_at + 43200000 THEN expires_at - 43200000
  ELSE (SELECT MAX(created_at) FROM blacksmith_requests WHERE inbox_id = blacksmith_inboxes.id)
END;
-- Earlier versions did not record completion times. Leave those unknown rather
-- than presenting a request's submission date as its completion date.
DROP TRIGGER blacksmith_request_insert;
CREATE TRIGGER blacksmith_request_insert AFTER INSERT ON blacksmith_requests BEGIN
  UPDATE blacksmith_inboxes SET revision = revision + 1,
    expires_at = MAX(expires_at, NEW.created_at + 43200000),
    last_submitted_at = MAX(COALESCE(last_submitted_at, NEW.created_at), NEW.created_at)
    WHERE id = NEW.inbox_id;
END;
CREATE TRIGGER blacksmith_request_complete AFTER UPDATE OF status ON blacksmith_requests
WHEN NEW.status = 'done' AND OLD.status <> 'done'
BEGIN
  UPDATE blacksmith_inboxes SET last_completed_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    WHERE id = NEW.inbox_id;
END;
