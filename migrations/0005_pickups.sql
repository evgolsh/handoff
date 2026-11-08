-- Who picked up a handoff, where and when. A recipient's first read in an assistant ('assistant', with the
-- assistant's name) and their first open in the browser ('browser') are kept; later ones change nothing. The
-- sender sees them in Assets and in their assistant's inbox. Rows go when their packet is deleted.
CREATE TABLE IF NOT EXISTS packet_pickups (
  packet_id TEXT NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  reader    TEXT NOT NULL,
  via       TEXT NOT NULL CHECK (via IN ('assistant', 'browser')),
  client    TEXT,
  at        TEXT NOT NULL,
  PRIMARY KEY (packet_id, reader, via)
);

-- The name of the assistant a handoff was sent from (oauth_clients.client_name at send time).
ALTER TABLE packets ADD COLUMN sent_via TEXT;
