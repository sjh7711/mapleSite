ALTER TABLE blacksmith_inboxes ADD COLUMN creator_hash TEXT;
CREATE UNIQUE INDEX blacksmith_creator ON blacksmith_inboxes(creator_hash) WHERE creator_hash IS NOT NULL;
CREATE INDEX blacksmith_requests_status_date ON blacksmith_requests(inbox_id,status,created_at,id);

-- A claim survives withdrawal. Rejection releases only claims belonging to
-- that request, so rejecting an older request cannot unlock a newer one.
ALTER TABLE blacksmith_nickname_claims ADD COLUMN request_id TEXT;
UPDATE blacksmith_nickname_claims SET request_id=(SELECT id FROM blacksmith_requests AS r
  WHERE r.inbox_id=blacksmith_nickname_claims.inbox_id AND lower(r.nickname)=blacksmith_nickname_claims.nickname_key
  AND (r.applicant_hash=blacksmith_nickname_claims.applicant_hash OR r.applicant_hash IS NULL AND blacksmith_nickname_claims.applicant_hash IS NULL)
  ORDER BY r.created_at DESC,r.id DESC LIMIT 1);
CREATE INDEX blacksmith_claim_request ON blacksmith_nickname_claims(inbox_id,request_id);

CREATE TRIGGER blacksmith_history_limit AFTER UPDATE OF status ON blacksmith_requests
WHEN NEW.status='done' AND OLD.status<>'done'
BEGIN
  DELETE FROM blacksmith_requests WHERE id IN (SELECT id FROM blacksmith_requests
    WHERE inbox_id=NEW.inbox_id AND status='done' ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET 1000);
END;
