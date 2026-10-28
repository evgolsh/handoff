#!/usr/bin/env node
// Weekly funnel snapshot of the GitHub side: stars, forks, watchers, views and clones over 14 days (GitHub keeps
// no more), and the top referrers. Appends one Markdown row to --out (default .quorum/METRICS.md, a private
// note) and prints it. Needs `gh` signed in with push access to the repository.
//
//   node scripts/metrics.mjs [--repo evgolsh/handoff] [--out .quorum/METRICS.md]
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const repo = arg("--repo", process.env.HANDOFF_REPO ?? "evgolsh/handoff");
const out = arg("--out", ".quorum/METRICS.md");

const api = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));
const r = api(`repos/${repo}`);
const views = api(`repos/${repo}/traffic/views`);
const clones = api(`repos/${repo}/traffic/clones`);
const referrers = api(`repos/${repo}/traffic/popular/referrers`);
let releases = 0;
try {
  for (const rel of api(`repos/${repo}/releases`)) for (const a of rel.assets ?? []) releases += a.download_count ?? 0;
} catch {
  // No releases yet.
}

const today = new Date().toISOString().slice(0, 10);
const top = referrers
  .slice(0, 3)
  .map((x) => `${x.referrer} ${x.uniques}`)
  .join(", ");
const row = `| ${today} | ${r.stargazers_count} | ${r.forks_count} | ${r.subscribers_count} | ${views.count} | ${views.uniques} | ${clones.count} | ${clones.uniques} | ${releases} | ${top || "—"} |`;
const header = `| date | stars | forks | watchers | views 14d | unique visitors 14d | clones 14d | unique cloners 14d | release downloads | top referrers (uniques) |
|---|---|---|---|---|---|---|---|---|---|
`;

mkdirSync(dirname(out), { recursive: true });
if (!existsSync(out)) writeFileSync(out, `# Handoff metrics\n\nGitHub side, one row per run (weekly on Monday). Views and clones are GitHub's rolling 14 days.\n\n${header}`);
appendFileSync(out, row + "\n");
console.log(header + row);
