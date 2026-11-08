#!/usr/bin/env node
/**
 * Grants or revokes console access (/console) for an existing member. Only the operator can do this:
 *   npm run admin -- <username> [--revoke] [--local | --hosted]
 * --hosted runs it on the hosted service (wrangler.hosted.jsonc).
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const handle = (args.find((a) => !a.startsWith("--")) ?? "").trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(handle) || args.some((a) => a.startsWith("--") && !["--local", "--revoke", "--hosted"].includes(a))) {
  console.error("Usage: npm run admin -- <existing-username> [--revoke] [--local | --hosted]");
  process.exit(1);
}
const revoke = args.includes("--revoke");
const sql = revoke
  ? `DELETE FROM admin_members WHERE handle = '${handle}';`
  : `INSERT OR IGNORE INTO admin_members (handle) SELECT handle FROM members WHERE handle = '${handle}'; SELECT handle FROM admin_members WHERE handle = '${handle}';`;
const output = execFileSync("npx", ["wrangler", "d1", "execute", "DB", args.includes("--local") ? "--local" : "--remote", ...(args.includes("--hosted") ? ["-c", "wrangler.hosted.jsonc"] : []), "--json", "--command", sql], { encoding: "utf8" });
const results = JSON.parse(output);
if (!revoke && !results.some((r) => r.results?.some((row) => row.handle === handle))) {
  console.error("No such member. Add it with npm run member:add first.");
  process.exit(1);
}
console.log(revoke ? `Console access revoked for ${handle}.` : `Console access granted to ${handle}. Sign in at /console with that member's username and access code.`);
