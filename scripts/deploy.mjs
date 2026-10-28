#!/usr/bin/env node
/**
 * One-command Cloudflare setup & deploy for Handoff:
 *   1. Checks Cloudflare login (`wrangler whoami` -> `wrangler login` if needed)
 *   2. Ensures the D1 database (wrangler.jsonc's, or yours named `handoff`) and R2 bucket `handoff-attachments` exist
 *   3. Applies remote D1 migrations
 *   4. Deploys the Worker and prints the live /connect URL
 *   5. Seeds initial members (default: --members owner,teammate) if `members` is empty, and makes the first
 *      one an admin of the console (/console)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], ...opts });

function ensureWranglerAuth() {
  try {
    const out = run("npx", ["wrangler", "whoami"]);
    if (out.includes("You are not authenticated")) throw new Error("unauthenticated");
  } catch {
    console.log("Signing in to Cloudflare...");
    execFileSync("npx", ["wrangler", "login"], { stdio: "inherit" });
  }
}

function ensureD1AndR2() {
  const cfgPath = "wrangler.jsonc";
  let raw = fs.readFileSync(cfgPath, "utf8");
  const idMatch = /("database_id"\s*:\s*")([^"]*)(")/.exec(raw);
  const configuredId = idMatch?.[2] ?? "";

  // The D1 database: the one wrangler.jsonc names if it is in your account; otherwise yours named "handoff",
  // created if needed, and its id written into wrangler.jsonc (a clone carries the id of the repository's owner).
  let list = [];
  try {
    list = JSON.parse(run("npx", ["wrangler", "d1", "list", "--json"]));
  } catch {
    list = [];
  }
  const idOf = (d) => d?.uuid ?? d?.database_id;
  if (!list.some((d) => idOf(d) === configuredId)) {
    let db = list.find((d) => d.name === "handoff");
    if (!db) {
      console.log("Creating D1 database 'handoff'...");
      const created = run("npx", ["wrangler", "d1", "create", "handoff"]);
      const m = /"database_id"\s*:\s*"([0-9a-f-]+)"/i.exec(created) ?? /database_id\s*=\s*"([0-9a-f-]+)"/i.exec(created);
      if (m?.[1]) db = { uuid: m[1] };
    }
    const dbId = idOf(db);
    if (!dbId || !idMatch) throw new Error("Could not find or create the D1 database. Run: npx wrangler d1 create handoff, and put its id in wrangler.jsonc.");
    raw = raw.replace(idMatch[0], `${idMatch[1]}${dbId}${idMatch[3]}`);
    fs.writeFileSync(cfgPath, raw);
    console.log(`Using D1 database ${dbId} (written to wrangler.jsonc).`);
  }

  // Ensure R2 bucket exists
  try {
    const buckets = run("npx", ["wrangler", "r2", "bucket", "list"]);
    if (!buckets.includes("handoff-attachments")) {
      console.log("Creating R2 bucket 'handoff-attachments'...");
      execFileSync("npx", ["wrangler", "r2", "bucket", "create", "handoff-attachments"], { stdio: "inherit" });
    }
  } catch {
    // Already exists or created.
  }
}

function seedMembersIfEmpty(handles) {
  try {
    const out = run("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--json", "--command", "SELECT COUNT(*) AS n FROM members;"]);
    const parsed = JSON.parse(out);
    const count = parsed?.[0]?.results?.[0]?.n ?? 0;
    if (count > 0) return [];
  } catch {
    // Proceed to seed.
  }
  const seeded = [];
  for (const h of handles) {
    const handle = h.trim().toLowerCase();
    if (!handle) continue;
    if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(handle) || ["team", "all"].includes(handle)) {
      console.error(`Skipping "${handle}": use [a-z0-9._-], and not team or all.`);
      continue;
    }
    const code = `hf-${crypto.randomBytes(12).toString("base64url")}`;
    const salt = crypto.createHash("sha256").update(crypto.randomBytes(16)).digest("hex");
    const hash = crypto.pbkdf2Sync(code, salt, 100_000, 32, "sha256").toString("hex");
    const now = new Date().toISOString();
    const sql = `INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at) VALUES ('${handle}', '${salt}', '${hash}', '${now}');`;
    execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--command", sql], { stdio: "inherit" });
    seeded.push({ handle, code });
  }
  if (seeded.length) {
    const first = seeded[0].handle;
    execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--command", `INSERT OR IGNORE INTO admin_members (handle) VALUES ('${first}');`], { stdio: "inherit" });
  }
  return seeded;
}

ensureWranglerAuth();
ensureD1AndR2();

console.log("Applying D1 migrations...");
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote"], { stdio: "inherit" });

console.log("Deploying Handoff Worker...");
const deployOut = run("npx", ["wrangler", "deploy"]);
process.stdout.write(deployOut);

const urlMatch = /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i.exec(deployOut);
const publicUrl = urlMatch ? urlMatch[0] : "https://handoff.<your-subdomain>.workers.dev";

const argMembers = process.argv.find((a) => a.startsWith("--members="))?.split("=")[1];
const handles = (argMembers ?? "owner,teammate").split(",");
const seeded = seedMembersIfEmpty(handles);

console.log("\n============================================================");
console.log("✓ Handoff is live and wired!");
console.log(`  Connect page: ${publicUrl}/connect`);
console.log(`  MCP endpoint: ${publicUrl}/mcp`);
console.log(`  Console:      ${publicUrl}/console`);
if (seeded.length) {
  console.log("\nInitial teammate logins (save these codes):");
  for (const m of seeded) console.log(`  - ${m.handle}: ${m.code}`);
  console.log(`${seeded[0].handle} is an admin of the console. More admins: npm run admin -- <handle>`);
  console.log("Add members, reset codes and disconnect assistants in the console, or with: npm run member:add -- <handle>");
}
console.log("============================================================\n");
