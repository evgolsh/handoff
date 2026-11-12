-- Rename stored activity event names and the web packets area after the Handoff -> Threadpacket rename.
UPDATE events SET name = 'threadpacket_' || substr(name, 9) WHERE kind = 'tool' AND name LIKE 'handoff_%';
UPDATE events SET kind = 'packets' WHERE kind = 'assets';
