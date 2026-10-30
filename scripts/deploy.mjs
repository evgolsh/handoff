#!/usr/bin/env node
/**
 * One-command Cloudflare setup & deploy for Handoff:
 *   1. Checks Cloudflare login (`wrangler whoami` -> `wrangler login` if needed)
 *   2. Ensures the D1 database (wrangler.jsonc's, or yours named `handoff`) and the file store exist: the KV namespace
 *      wrangler.jsonc binds as FILES (or, if wrangler.jsonc binds an R2 bucket instead, that bucket)
 *   3. Creates the tables (migrations/0001_schema.sql, through wrangler d1 migrations apply)
 *   4. Deploys the Worker and prints the live /connect URL
 *   5. Seeds initial members (default: --members owner,teammate) if `members` is empty, and makes the first
 *      one an admin of the console (/console)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], ...opts });

/** Runs a wrangler step quietly; on failure, prints what wrangler said and stops. */
function quiet(label, cmd, args) {
  try {
    return run(cmd, args);
  } catch (e) {
    console.error(`\n${label} failed:\n${e.stdout ?? ""}${e.stderr ?? e.message}`);
    process.exit(1);
  }
}

function ensureWranglerAuth() {
  try {
    const out = run("npx", ["wrangler", "whoami"]);
    if (out.includes("You are not authenticated")) throw new Error("unauthenticated");
  } catch {
    console.log("Signing in to Cloudflare...");
    execFileSync("npx", ["wrangler", "login"], { stdio: "inherit" });
  }
}

function ensureD1AndStore() {
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
      const created = quiet("Creating the database", "npx", ["wrangler", "d1", "create", "handoff"]);
      const m = /"database_id"\s*:\s*"([0-9a-f-]+)"/i.exec(created) ?? /database_id\s*=\s*"([0-9a-f-]+)"/i.exec(created);
      if (m?.[1]) db = { uuid: m[1] };
    }
    const dbId = idOf(db);
    if (!dbId || !idMatch) throw new Error("Could not find or create the D1 database. Run: npx wrangler d1 create handoff, and put its id in wrangler.jsonc.");
    raw = raw.replace(idMatch[0], `${idMatch[1]}${dbId}${idMatch[3]}`);
    fs.writeFileSync(cfgPath, raw);
    console.log(`Database:  handoff (${dbId})`);
  }

  // The file store. Default: a Workers KV namespace (free plan, no payment method): the one wrangler.jsonc names if
  // it is in your account, otherwise yours titled "handoff-FILES", created if needed, with its id written into
  // wrangler.jsonc. If wrangler.jsonc binds an R2 bucket instead (BLOBS), that bucket is created if needed.
  const kvMatch = /("binding"\s*:\s*"FILES"\s*,\s*"id"\s*:\s*")([^"]*)(")/.exec(raw);
  if (kvMatch) {
    let spaces = [];
    try {
      spaces = JSON.parse(run("npx", ["wrangler", "kv", "namespace", "list"]));
    } catch {
      spaces = [];
    }
    if (!spaces.some((n) => n.id === kvMatch[2])) {
      let ns = spaces.find((n) => n.title === "handoff-FILES");
      if (!ns) {
        const created = quiet("Creating the file store", "npx", ["wrangler", "kv", "namespace", "create", "FILES"]);
        const m = /"id"\s*:\s*"([0-9a-f]+)"/i.exec(created);
        if (m?.[1]) ns = { id: m[1] };
      }
      if (!ns?.id) throw new Error("Could not find or create the KV namespace. Run: npx wrangler kv namespace create FILES, and put its id in wrangler.jsonc.");
      raw = raw.replace(kvMatch[0], `${kvMatch[1]}${ns.id}${kvMatch[3]}`);
      fs.writeFileSync(cfgPath, raw);
      console.log(`Files:     KV namespace handoff-FILES (${ns.id})`);
    }
  }
  const bucket = /"bucket_name"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
  if (bucket) {
    try {
      const buckets = run("npx", ["wrangler", "r2", "bucket", "list"]);
      if (!buckets.includes(bucket)) {
        quiet("Creating the bucket", "npx", ["wrangler", "r2", "bucket", "create", bucket]);
        console.log(`Files:     R2 bucket ${bucket}`);
      }
    } catch {
      // Already exists or created.
    }
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
    quiet(`Adding member ${handle}`, "npx", ["wrangler", "d1", "execute", "DB", "--remote", "--command", sql]);
    seeded.push({ handle, code });
  }
  if (seeded.length) {
    const first = seeded[0].handle;
    quiet(`Making ${first} an admin`, "npx", ["wrangler", "d1", "execute", "DB", "--remote", "--command", `INSERT OR IGNORE INTO admin_members (handle) VALUES ('${first}');`]);
  }
  return seeded;
}

ensureWranglerAuth();
ensureD1AndStore();

// The schema. wrangler prints every migration file it applies; one line is enough here.
const migrated = quiet("Preparing the database", "npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote"]);
console.log(migrated.includes("No migrations to apply") ? "Schema:    up to date" : "Schema:    ready");

// The static files (fonts, demo) are built, not committed: a fresh clone has no public/ folder, and wrangler
// refuses to deploy without it. npm run deploy does this through its predeploy script.
quiet("Building the static files", "node", ["scripts/assets.mjs"]);

console.log("Deploying...");
const deployOut = quiet("Deploying the Worker", "npx", ["wrangler", "deploy"]);

const urlMatch = /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i.exec(deployOut);
const publicUrl = urlMatch ? urlMatch[0] : "https://handoff.<your-subdomain>.workers.dev";

const argMembers = process.argv.find((a) => a.startsWith("--members="))?.split("=")[1];
const handles = (argMembers ?? "owner,teammate").split(",");
const seeded = seedMembersIfEmpty(handles);

console.log(`\nHandoff is live at ${publicUrl}`);
console.log(`  Server address for assistants:  ${publicUrl}/mcp`);
console.log(`  Setup for each assistant:       ${publicUrl}/connect`);
console.log(`  Console:                        ${publicUrl}/console`);
if (seeded.length) {
  console.log("\nSign-in details, shown once. Save them in a password manager:");
  for (const m of seeded) console.log(`  ${m.handle.padEnd(16)} ${m.code}`);
  console.log(`\n${seeded[0].handle} is the console's admin. Add members or reset a code in the console, or with npm run member:add -- <username>.`);
}
console.log("");
