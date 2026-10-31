#!/usr/bin/env node
/**
 * Removes a Handoff deployment from the Cloudflare account wrangler is signed in to:
 *   npm run teardown
 * It deletes the Worker, the D1 database and the file store (KV namespace, or R2 bucket) that wrangler.jsonc
 * names, after you type the Worker's name to confirm. Packets, files and members are gone for good.
 * Afterwards, `npm run setup` starts from scratch (it writes new ids into wrangler.jsonc).
 *
 * Each wrangler command runs in your terminal: `wrangler delete` asks once more before it removes the Worker
 * (it has no flag to skip that question; its --force would also break Workers bound to this one). A resource
 * that is already gone is reported and skipped. Any other failure stops the run with wrangler's message and a
 * non-zero exit, so a Worker is never left behind quietly.
 */
import fs from "node:fs";
import readline from "node:readline/promises";
import { execFileSync, spawnSync } from "node:child_process";

const cfg = fs.readFileSync("wrangler.jsonc", "utf8");
const pick = (re) => re.exec(cfg)?.[1] ?? null;
const worker = pick(/"name"\s*:\s*"([^"]+)"/);
const dbId = pick(/"database_id"\s*:\s*"([^"]*)"/);
const dbName = pick(/"database_name"\s*:\s*"([^"]+)"/);
const kvId = pick(/"binding"\s*:\s*"FILES"\s*,\s*"id"\s*:\s*"([^"]*)"/);
const bucket = pick(/"bucket_name"\s*:\s*"([^"]+)"/);

let who = "";
try {
  who = execFileSync("npx", ["wrangler", "whoami"], { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"] });
} catch {
  console.error("Not signed in to Cloudflare. Run: npx wrangler login");
  process.exit(1);
}
const account = /│\s*([^│]+?)\s*│\s*([0-9a-f]{32})\s*│/.exec(who);
console.log(`Account: ${account ? `${account[1]} (${account[2]})` : "see npx wrangler whoami"}`);
console.log(`This removes, for good:`);
console.log(`  Worker        ${worker}`);
console.log(`  D1 database   ${dbName}${dbId ? ` (${dbId})` : ""}`);
if (kvId) console.log(`  KV namespace  FILES (${kvId})`);
if (bucket) console.log(`  R2 bucket     ${bucket}`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const typed = (await rl.question(`Type the Worker's name (${worker}) to confirm: `)).trim();
rl.close();
if (typed !== worker) {
  console.log("Nothing deleted.");
  process.exit(1);
}

// wrangler's questions and progress go to the terminal; its errors are captured so a not-found answer
// (the Cloudflare API code, or wrangler's own lookup message) can be told from a real failure.
function step(label, args, notFound) {
  const res = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["inherit", "inherit", "pipe"] });
  const err = (res.stderr ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  if (res.status === 0) {
    if (err.trim()) process.stderr.write(err);
    console.log(`Deleted  ${label}`);
    return;
  }
  if (notFound.test(err)) {
    console.log(`Skipped  ${label}: not in this account (already gone)`);
    return;
  }
  process.stderr.write(err.trim() ? err : `wrangler stopped (exit code ${res.status ?? res.signal}).\n`);
  console.error(`\nCould not delete ${label}. Nothing after it was touched; fix the cause above and run npm run teardown again.`);
  process.exit(1);
}

step(`Worker ${worker}`, ["delete", worker], /\[code: 10007\]/);
if (dbId) step(`D1 database ${dbName}`, ["d1", "delete", dbName, "--skip-confirmation"], /\[code: 7404\]|Couldn't find a D1 DB/);
if (kvId) step(`KV namespace ${kvId}`, ["kv", "namespace", "delete", "--namespace-id", kvId, "--skip-confirmation"], /\[code: 10013\]/);
if (bucket) step(`R2 bucket ${bucket}`, ["r2", "bucket", "delete", bucket], /\[code: 10006\]/);
console.log("\nDone. To start again: npm run setup -- --members=<you>,<teammate>");
