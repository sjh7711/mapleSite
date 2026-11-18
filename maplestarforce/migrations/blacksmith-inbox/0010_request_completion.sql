ALTER TABLE blacksmith_requests ADD COLUMN completed_at INTEGER;
CREATE INDEX blacksmith_request_completion ON blacksmith_requests(inbox_id,applicant_hash,completed_at DESC) WHERE status='done';
-- Existing completed requests have no known completion timestamp.
CREATE TRIGGER blacksmith_request_completion_time AFTER UPDATE OF status ON blacksmith_requests
WHEN NEW.status <> OLD.status
BEGIN
  UPDATE blacksmith_requests SET completed_at = CASE WHEN NEW.status='done'
    THEN CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) ELSE NULL END
    WHERE id=NEW.id;
END;
