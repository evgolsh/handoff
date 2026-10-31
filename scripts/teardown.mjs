#!/usr/bin/env node
/**
 * Removes a Handoff deployment from the Cloudflare account wrangler is signed in to:
 *   npm run teardown
 * It deletes the Worker, the D1 database and the file store (KV namespace, or R2 bucket) that wrangler.jsonc
 * names, after you type the Worker's name to confirm. Packets, files and members are gone for good.
 * Afterwards, `npm run setup` starts from scratch (it writes new ids into wrangler.jsonc).
 */
import fs from "node:fs";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";

const run = (args, opts = {}) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], ...opts });
const cfg = fs.readFileSync("wrangler.jsonc", "utf8");
const pick = (re) => re.exec(cfg)?.[1] ?? null;
const worker = pick(/"name"\s*:\s*"([^"]+)"/);
const dbId = pick(/"database_id"\s*:\s*"([^"]*)"/);
const dbName = pick(/"database_name"\s*:\s*"([^"]+)"/);
const kvId = pick(/"binding"\s*:\s*"FILES"\s*,\s*"id"\s*:\s*"([^"]*)"/);
const bucket = pick(/"bucket_name"\s*:\s*"([^"]+)"/);

let who = "";
try {
  who = run(["whoami"]);
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

// Each wrangler command runs in the terminal, so anything it asks is visible and answerable.
function step(label, args) {
  try {
    execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
    console.log(`Deleted  ${label}`);
  } catch {
    console.error(`Could not delete ${label} (already gone, or see wrangler's message above).`);
  }
}

step(`Worker ${worker}`, ["delete", worker, "--skip-confirmation"]);
if (dbId) step(`D1 database ${dbName}`, ["d1", "delete", dbName, "--skip-confirmation"]);
if (kvId) step(`KV namespace ${kvId}`, ["kv", "namespace", "delete", "--namespace-id", kvId]);
if (bucket) step(`R2 bucket ${bucket}`, ["r2", "bucket", "delete", bucket]);
console.log("\nDone. To start again: npm run setup -- --members=<you>,<teammate>");
