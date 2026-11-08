-- One browser session per signed-in member, for every page, in member_sessions; the console checks admin_members
-- on each request. The console's own sessions end here, and so do sessions under the old cookie names: everyone
-- signs in once more.
DROP TABLE IF EXISTS admin_sessions;
DELETE FROM member_sessions;
