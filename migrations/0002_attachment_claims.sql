-- One actor at a time may change an attachment's bytes or delete it.
--   NULL             free: a staging slot that accepts bytes, or a ready file that a packet may link
--   'upload:<nonce>' one writer is receiving bytes; no other writer is accepted
--   'delete'         cleanup owns it; a send may no longer link it
-- A ready attachment always has claim NULL and its bytes never change.
ALTER TABLE attachments ADD COLUMN claim TEXT;
