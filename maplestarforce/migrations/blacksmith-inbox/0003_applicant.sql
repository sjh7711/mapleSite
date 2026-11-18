ALTER TABLE blacksmith_requests ADD COLUMN applicant_hash TEXT;
ALTER TABLE blacksmith_requests ADD COLUMN submitter_ip_hash TEXT;
ALTER TABLE blacksmith_requests ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX blacksmith_requests_active_applicant ON blacksmith_requests(inbox_id, applicant_hash)
  WHERE applicant_hash IS NOT NULL AND status IN ('waiting','working');
CREATE UNIQUE INDEX blacksmith_requests_active_ip ON blacksmith_requests(inbox_id, submitter_ip_hash)
  WHERE submitter_ip_hash IS NOT NULL AND status IN ('waiting','working');
CREATE INDEX blacksmith_requests_active_name ON blacksmith_requests(inbox_id, nickname)
  WHERE status IN ('waiting','working');
CREATE TABLE blacksmith_submissions (
  request_id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  submitted_at INTEGER NOT NULL
);
CREATE INDEX blacksmith_submissions_ip_time ON blacksmith_submissions(ip_hash, submitted_at);
CREATE INDEX blacksmith_submissions_expiry ON blacksmith_submissions(submitted_at);
CREATE TABLE blacksmith_nickname_claims (
  inbox_id TEXT NOT NULL REFERENCES blacksmith_inboxes(id) ON DELETE CASCADE,
  nickname_key TEXT NOT NULL,
  applicant_hash TEXT,
  PRIMARY KEY (inbox_id, nickname_key)
);
INSERT INTO blacksmith_nickname_claims(inbox_id,nickname_key,applicant_hash)
  SELECT inbox_id,lower(nickname),NULL FROM blacksmith_requests GROUP BY inbox_id,lower(nickname);
