-- Keep all existing waiting/working applications, even if the old 200-slot
-- limit allowed more than 50. They must drain before new admission is allowed.
-- Enforce admission in D1 as well, so older deployment URLs cannot bypass it.
CREATE TRIGGER blacksmith_active_insert BEFORE INSERT ON blacksmith_requests
WHEN NEW.status IN ('waiting','working') AND
  (SELECT COUNT(*) FROM blacksmith_requests WHERE inbox_id=NEW.inbox_id AND status IN ('waiting','working')) >= 50
BEGIN
  SELECT RAISE(ABORT, 'blacksmith_active_capacity');
END;
CREATE TRIGGER blacksmith_active_reopen BEFORE UPDATE OF status ON blacksmith_requests
WHEN OLD.status='done' AND NEW.status IN ('waiting','working') AND
  (SELECT COUNT(*) FROM blacksmith_requests WHERE inbox_id=NEW.inbox_id AND status IN ('waiting','working')) >= 50
BEGIN
  SELECT RAISE(ABORT, 'blacksmith_active_capacity');
END;
DROP TRIGGER blacksmith_history_limit;
CREATE TRIGGER blacksmith_history_limit AFTER UPDATE OF status ON blacksmith_requests
WHEN NEW.status='done' AND OLD.status<>'done'
BEGIN
  DELETE FROM blacksmith_requests WHERE id IN (SELECT id FROM blacksmith_requests
    WHERE inbox_id=NEW.inbox_id AND status='done' ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET 300);
END;
-- Apply the new completed-history policy to existing inboxes as well.
DELETE FROM blacksmith_requests WHERE id IN (
  SELECT id FROM (
    SELECT id,ROW_NUMBER() OVER (PARTITION BY inbox_id ORDER BY created_at DESC,id DESC) AS position
    FROM blacksmith_requests WHERE status='done'
  ) WHERE position>300
);
