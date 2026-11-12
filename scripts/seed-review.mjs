// Fills a directory reviewer's team with the sample set its review cases use (.quorum/DIRECTORIES.md):
//   from anna to joe: "School trip forms" (permission-slip.pdf, packing-list.md) and "Insurance renewal" (brief only);
//   from joe to anna: "Kitchen quote", picked up by anna;
//   in joe's Packets: the unsent file lease.pdf.
// It signs in as joe and as anna over the public OAuth flow and then uses only the MCP tools, as an assistant
// does. Packets live 720 hours, the longest the hosted service allows.
//
// Running it again adds nothing that is there already. A packet with less than 7 days left is revoked and sent
// again, and lease.pdf is uploaded again once the hourly cleanup has removed it (7 days after its upload), so
// running it every day keeps the set complete. The access codes come from the environment and are never printed.
//
//   THREADPACKET_URL=http://127.0.0.1:8787 REVIEW_TEAM=smiths JOE_CODE=… ANNA_CODE=… node scripts/seed-review.mjs
import { createHash, randomBytes, randomUUID } from "node:crypto";

const BASE = (process.env.THREADPACKET_URL ?? "").replace(/\/+$/, "");
const TEAM = process.env.REVIEW_TEAM ?? "";
const CODES = { joe: process.env.JOE_CODE ?? "", anna: process.env.ANNA_CODE ?? "" };
const HOURS = 720;
const REFRESH_MS = 7 * 24 * 3_600_000;
const CLIENT_NAME = "Threadpacket sample data";

if (!/^https?:\/\/[^/]+$/.test(BASE) || !TEAM || !CODES.joe || !CODES.anna) {
  console.error("Set THREADPACKET_URL (the server's origin), REVIEW_TEAM, JOE_CODE and ANNA_CODE.");
  process.exit(2);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** A one-page PDF with a few lines of text, small and valid. */
function pdf(lines) {
  const text = lines.map((l, i) => `BT /F1 14 Tf 72 ${720 - i * 24} Td (${l.replace(/[\\()]/g, "\\$&")}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

const FILES = {
  "permission-slip.pdf": { type: "application/pdf", bytes: pdf(["Hillside School: trip to the Science Museum", "Date: 14 March", "Parent signature: ______________", "Return by 6 March."]) },
  "packing-list.md": {
    type: "text/markdown",
    bytes: Buffer.from("# Packing list\n\n- Packed lunch and a water bottle\n- Rain jacket\n- Signed permission slip\n- A little pocket money for the museum shop\n"),
  },
  "lease.pdf": { type: "application/pdf", bytes: pdf(["Lease agreement, flat 4B", "Term: 12 months from 1 April", "Rent: due on the 1st of each month", "Notice: two months, in writing."]) },
};

const SET = [
  {
    key: "school-trip",
    from: "anna",
    to: "joe",
    title: "School trip forms",
    files: ["permission-slip.pdf", "packing-list.md"],
    brief:
      "Purpose: get Mia ready for the school trip to the Science Museum on 14 March.\n" +
      "Decisions: she goes; the trip fee is paid online (done).\n" +
      "Next step: print and sign permission-slip.pdf and return it by 6 March; check packing-list.md with her the night before.\n" +
      "Open question: does she need a packed lunch every day or only on the 14th?",
  },
  {
    key: "insurance",
    from: "anna",
    to: "joe",
    title: "Insurance renewal",
    files: [],
    brief:
      "Purpose: renew the home insurance before it ends on 31 March.\n" +
      "Decisions: stay with the current insurer if the price rises by less than 10%; otherwise compare two quotes.\n" +
      "Next step: ask the insurer for the renewal price and compare it with last year's price in the renewal letter.\n" +
      "Open question: should the bikes be added to the contents cover?",
  },
  {
    key: "kitchen",
    from: "joe",
    to: "anna",
    title: "Kitchen quote",
    files: [],
    pickedUp: true,
    brief:
      "Purpose: choose a builder for the kitchen.\n" +
      "Decisions: the second builder, who can start in May, over the cheaper first one, who can start only in September, because we need the kitchen before summer.\n" +
      "Next step: call the builder to confirm the May start and ask for a written quote.\n" +
      "Open question: is the worktop included in the price?",
  },
];

/** Signs a member in over the public OAuth flow (registration, sign-in form, PKCE token exchange). */
async function signIn(handle) {
  const redirect = "http://127.0.0.1:9/callback";
  const reg = await fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [redirect] }),
  });
  if (!reg.ok) throw new Error(`client registration failed: ${reg.status}`);
  const { client_id } = await reg.json();
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(12));
  const form = new URLSearchParams({
    client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    state,
    scope: "threadpacket",
    handle,
    access_code: CODES[handle],
  });
  const auth = await fetch(`${BASE}/authorize`, { method: "POST", body: form, redirect: "manual" });
  const location = auth.headers.get("location");
  const back = location ? new URL(location) : null;
  if (auth.status !== 302 || !back || back.searchParams.get("state") !== state || !back.searchParams.get("code")) {
    throw new Error(`sign-in as ${handle} failed (${auth.status}): check the username and access code`);
  }
  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code"), redirect_uri: redirect, client_id, code_verifier: verifier }),
  });
  if (!tok.ok) throw new Error(`token exchange for ${handle} failed: ${tok.status}`);
  const { access_token } = await tok.json();
  const sub = JSON.parse(Buffer.from(access_token.split(".")[1], "base64url").toString()).sub;
  if (sub !== `${TEAM}/${handle}`) throw new Error(`${handle}'s code belongs to another team, not ${TEAM}; nothing was changed`);
  return access_token;
}

let rpcId = 0;
/** Calls one MCP tool and returns its structured result; a tool error stops the script. */
async function tool(token, name, args = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json();
  if (body.error || body.result?.isError) throw new Error(`${name}: ${body.error?.message ?? body.result.content?.[0]?.text ?? res.status}`);
  return body.result.structuredContent;
}

/** Uploads one sample file the way the tool tells an assistant to, and returns its attachment id. */
async function upload(token, filename) {
  const f = FILES[filename];
  const slot = await tool(token, "threadpacket_upload_url", { filename, mime_type: f.type });
  const put = await fetch(slot.upload_url, { method: "PUT", headers: slot.headers, body: f.bytes });
  if (!put.ok) throw new Error(`upload of ${filename} failed: ${put.status}`);
  return slot.attachment_id;
}

async function seed() {
  const tokens = { joe: await signIn("joe"), anna: await signIn("anna") };
  const report = [];

  for (const item of SET) {
    const sender = tokens[item.from];
    const { packets } = await tool(sender, "threadpacket_inbox", { limit: 50 });
    const live = packets.filter((p) => p.title === item.title && p.from === item.from && p.to === item.to);
    const fresh = live.find((p) => Date.parse(p.expires_at) - Date.now() > REFRESH_MS);
    let packetId = fresh?.packet_id;
    for (const old of live.filter((p) => p !== fresh)) {
      await tool(sender, "threadpacket_revoke", { packet_id: old.packet_id });
      const ending = Date.parse(old.expires_at) - Date.now() <= REFRESH_MS;
      report.push(`revoked "${item.title}" (${old.packet_id}): ${ending ? "fewer than 7 days left" : "a second copy"}`);
    }
    if (!packetId) {
      const ids = [];
      for (const f of item.files) ids.push(await upload(sender, f));
      const sent = await tool(sender, "threadpacket_send", {
        title: item.title,
        brief: item.brief,
        to: item.to,
        ...(ids.length ? { attachment_ids: ids } : {}),
        idempotency_key: `review-seed-${item.key}-${randomUUID()}`,
        expires_in_hours: HOURS,
      });
      packetId = sent.packet_id;
      report.push(`sent "${item.title}" from ${item.from} to ${item.to} (${packetId}), expires ${sent.expires_at}`);
    } else {
      report.push(`kept "${item.title}" (${packetId}), expires ${fresh.expires_at}`);
    }
    // A recipient's first read is the pickup the sender sees; a later read records nothing new.
    if (item.pickedUp) await tool(tokens[item.to], "threadpacket_read", { packet_id: packetId });
  }

  const { unsent_files: unsent = [] } = await tool(tokens.joe, "threadpacket_inbox", { limit: 1 });
  if (unsent.some((f) => f.filename === "lease.pdf")) report.push("kept joe's unsent file lease.pdf");
  else report.push(`uploaded joe's unsent file lease.pdf (${await upload(tokens.joe, "lease.pdf")})`);

  console.log(`Review sample set on ${BASE}, team ${TEAM}:\n${report.map((l) => `- ${l}`).join("\n")}`);
}

try {
  await seed();
} catch (e) {
  console.error(`seed-review: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
}
