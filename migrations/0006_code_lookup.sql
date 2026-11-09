-- Sign-in by username and access code, without the team: a short hash of the access code (16 bits, so it names
-- no code by itself) narrows the search to a few members, and the salted hash still decides. Set whenever a code
-- is set; a code set before this column gets it at its member's next sign-in.
ALTER TABLE members ADD COLUMN code_lookup TEXT;
CREATE INDEX IF NOT EXISTS members_code_lookup ON members(code_lookup);
