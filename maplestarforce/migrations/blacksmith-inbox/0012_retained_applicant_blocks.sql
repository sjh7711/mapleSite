-- Keep blocked applications outside both the active queue and completed quota.
ALTER TABLE blacksmith_applicant_blocks ADD COLUMN nickname TEXT;
ALTER TABLE blacksmith_applicant_blocks ADD COLUMN items TEXT;
ALTER TABLE blacksmith_applicant_blocks ADD COLUMN item_count INTEGER;
ALTER TABLE blacksmith_applicant_blocks ADD COLUMN created_at INTEGER;
ALTER TABLE blacksmith_applicant_blocks ADD COLUMN version INTEGER;
CREATE VIEW blacksmith_request_records AS
  SELECT id,inbox_id,nickname,items,item_count,status,created_at,version,completed_at,
    NULL AS blocked_at,(applicant_hash IS NOT NULL OR submitter_ip_hash IS NOT NULL) AS can_block
  FROM blacksmith_requests
  UNION ALL
  SELECT request_id,inbox_id,COALESCE(nickname,'이전 차단 신청'),items,COALESCE(item_count,0),
    'blocked',COALESCE(created_at,blocked_at),COALESCE(version,0),NULL,blocked_at,0
  FROM blacksmith_applicant_blocks;
CREATE TRIGGER blacksmith_block_insert_revision AFTER INSERT ON blacksmith_applicant_blocks
BEGIN
  UPDATE blacksmith_inboxes SET revision=revision+1 WHERE id=NEW.inbox_id;
END;
CREATE TRIGGER blacksmith_block_delete_revision AFTER DELETE ON blacksmith_applicant_blocks
BEGIN
  UPDATE blacksmith_inboxes SET revision=revision+1 WHERE id=OLD.inbox_id;
END;
DROP TRIGGER blacksmith_archive_before_delete;
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
    FROM blacksmith_request_records WHERE inbox_id=OLD.id;

  -- One bounded page per 20 applications, rather than a duplicate write per
  -- equipment item. The 48 KB input limit keeps a page below D1's row limit.
  INSERT INTO blacksmith_inbox_history_pages(inbox_id,page,requests)
    SELECT OLD.id,CAST(position/20 AS INTEGER),json_group_array(json_object(
      'id',id,'nickname',nickname,'itemCount',item_count,'status',status,
      'createdAt',created_at,'editCount',version,'blockedAt',blocked_at,'items',json(items)
    )) FROM (
      SELECT id,nickname,item_count,status,created_at,version,items,blocked_at,
        ROW_NUMBER() OVER (ORDER BY created_at ASC,id ASC)-1 AS position
      FROM blacksmith_request_records WHERE inbox_id=OLD.id
      ORDER BY created_at ASC,id ASC
    ) GROUP BY CAST(position/20 AS INTEGER);
END;
