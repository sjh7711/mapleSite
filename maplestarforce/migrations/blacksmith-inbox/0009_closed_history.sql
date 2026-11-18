ALTER TABLE blacksmith_inboxes ADD COLUMN termination_reason TEXT NOT NULL DEFAULT 'owner'
  CHECK(termination_reason IN ('owner','admin'));

-- Closed inboxes are independent of active admission, names and credentials.
CREATE TABLE blacksmith_inbox_history (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL,
  end_reason TEXT NOT NULL CHECK(end_reason IN ('owner','admin','expired')),
  last_submitted_at INTEGER,
  last_completed_at INTEGER,
  waiting INTEGER NOT NULL,
  working INTEGER NOT NULL,
  done INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  item_count INTEGER NOT NULL
);
CREATE INDEX blacksmith_history_ended ON blacksmith_inbox_history(ended_at DESC,id DESC);
CREATE INDEX blacksmith_history_expiry ON blacksmith_inbox_history(retain_until);
CREATE TABLE blacksmith_inbox_history_pages (
  inbox_id TEXT NOT NULL REFERENCES blacksmith_inbox_history(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  requests TEXT NOT NULL,
  PRIMARY KEY(inbox_id,page)
);

-- A BEFORE DELETE trigger snapshots children before ON DELETE CASCADE runs.
-- This also covers expiry sweeps and old deployment URLs in one transaction.
-- Never copy owner/applicant credentials, IP hashes, or nickname reservations.
CREATE TRIGGER blacksmith_archive_before_delete BEFORE DELETE ON blacksmith_inboxes
WHEN OLD.expires_at > CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-259200000
BEGIN
  INSERT INTO blacksmith_inbox_history (
    id,name,created_at,expires_at,ended_at,retain_until,end_reason,
    last_submitted_at,last_completed_at,waiting,working,done,request_count,item_count
  ) SELECT OLD.id,OLD.name,OLD.created_at,OLD.expires_at,
    MIN(OLD.expires_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),
    MIN(OLD.expires_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))+259200000,
    CASE WHEN OLD.expires_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
      THEN 'expired' ELSE OLD.termination_reason END,
    OLD.last_submitted_at,OLD.last_completed_at,
    COALESCE(SUM(status='waiting'),0),COALESCE(SUM(status='working'),0),COALESCE(SUM(status='done'),0),
    COUNT(*),COALESCE(SUM(item_count),0)
    FROM blacksmith_requests WHERE inbox_id=OLD.id;

  -- One bounded page per 20 applications, rather than a duplicate write per
  -- equipment item. The 48 KB input limit keeps a page below D1's row limit.
  INSERT INTO blacksmith_inbox_history_pages(inbox_id,page,requests)
    SELECT OLD.id,CAST(position/20 AS INTEGER),json_group_array(json_object(
      'id',id,'nickname',nickname,'itemCount',item_count,'status',status,
      'createdAt',created_at,'editCount',version,'items',json(items)
    )) FROM (
      SELECT id,nickname,item_count,status,created_at,version,items,
        ROW_NUMBER() OVER (ORDER BY created_at ASC,id ASC)-1 AS position
      FROM blacksmith_requests WHERE inbox_id=OLD.id
      ORDER BY created_at ASC,id ASC
    ) GROUP BY CAST(position/20 AS INTEGER);
END;
