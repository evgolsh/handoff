-- Assistants whose client_id is an https URL (a client metadata document, as Claude Code uses) are kept in
-- oauth_clients like registered ones. fetched_at says when the document was last read; it is read again after a day.
ALTER TABLE oauth_clients ADD COLUMN fetched_at TEXT;
