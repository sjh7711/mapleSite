CREATE TABLE blacksmith_applicant_blocks (
  inbox_id TEXT NOT NULL REFERENCES blacksmith_inboxes(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  applicant_hash TEXT,
  ip_hash TEXT,
  blocked_at INTEGER NOT NULL,
  PRIMARY KEY(inbox_id,request_id)
);
CREATE INDEX blacksmith_applicant_block_identity ON blacksmith_applicant_blocks(inbox_id,applicant_hash);
CREATE INDEX blacksmith_applicant_block_ip ON blacksmith_applicant_blocks(inbox_id,ip_hash);
