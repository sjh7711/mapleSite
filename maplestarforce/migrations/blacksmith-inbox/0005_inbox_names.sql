-- Admission checks the normalized name inside the creation transaction. This
-- lookup includes only unexpired inboxes, allowing reuse after disposal/expiry.
-- A non-unique index preserves pre-existing inboxes with duplicate names.
CREATE INDEX blacksmith_inbox_name_expiry ON blacksmith_inboxes(lower(name),expires_at);
