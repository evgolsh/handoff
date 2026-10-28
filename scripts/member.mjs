#!/usr/bin/env node
/**
 * Adds a member, or gives an existing member a new access code, in D1 (`members` table). A new code signs
 * out every assistant of that member at once (they sign in again with the new code).
 * The console (/console, Members) does the same from a browser.
 * Usage:
 *   npm run member:add -- <handle> [access_code] [--local]
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const isLocal = args.includes("--local");
const positional = args.filter((a) => !a.startsWith("-"));
const rawHandle = (positional[0] ?? "").trim().toLowerCase();

// "team" and "all" address every member in handoff_send (src/auth/builtin.ts RESERVED_HANDLES).
if (!rawHandle || !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(rawHandle) || ["team", "all"].includes(rawHandle)) {
  console.error("Usage: npm run member:add -- <handle> [access_code] [--local]   (team and all are reserved)");
  console.error("Example: npm run member:add -- tom");
  process.exit(1);
}

const accessCode =
  positional[1] && positional[1].length >= 6
    ? positional[1]
    : `hf-${crypto.randomBytes(12).toString("base64url")}`;

const salt = crypto.createHash("sha256").update(crypto.randomBytes(16)).digest("hex");
const hash = crypto.pbkdf2Sync(accessCode, salt, 100_000, 32, "sha256").toString("hex");
const now = new Date().toISOString();

// The handle matches [a-z0-9._-] and the other values are hex or ISO time, so they are safe in the SQL text.
const sql = [
  // An existing member gets a new code: sign out the assistants that used the old one (src/store/events.ts revokeAccess).
  `INSERT INTO access_revocations (subject, client_id, revoked_at) SELECT '${rawHandle}', '*', '${now}' WHERE EXISTS (SELECT 1 FROM members WHERE handle = '${rawHandle}') ON CONFLICT(subject, client_id) DO UPDATE SET revoked_at = excluded.revoked_at;`,
  `UPDATE oauth_refresh_tokens SET revoked_at = '${now}' WHERE subject = '${rawHandle}' AND revoked_at IS NULL;`,
  `INSERT INTO members (handle, code_salt, code_hash, created_at) VALUES ('${rawHandle}', '${salt}', '${hash}', '${now}') ON CONFLICT(handle) DO UPDATE SET code_salt = excluded.code_salt, code_hash = excluded.code_hash;`,
].join(" ");

execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "DB", isLocal ? "--local" : "--remote", "--command", sql],
  { stdio: "inherit" },
);

console.log(`\n✓ Member "${rawHandle}" ready (${isLocal ? "local" : "remote"} D1).`);
console.log(`  Handle:      ${rawHandle}`);
console.log(`  Access code: ${accessCode}\n`);
