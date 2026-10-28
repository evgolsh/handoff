// Regression tests for the independent implementation review of 2026-10-24.
import { describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { verifyBearer } from "../src/auth/verify";
import { redactSecrets } from "../src/app";
import { configFrom } from "../src/env";
import { HandoffService } from "../src/domain/service";
import { uploadCommands } from "../src/mcp/commands";
import { D1Repository } from "../src/store/d1";
import { R2BlobStore } from "../src/store/blobs";
import { SignJWT, importJWK } from "jose";
import privateJwk from "./fixtures/test-private-jwk.json";
import { AUDIENCE, ISSUER, ORIGIN, PDF, alice, call, errorText, expectOk, rpc, send, sha256Hex } from "./helpers";

/** Splits a POSIX sh command into words. Throws on any character outside quotes that a shell would treat specially. */
function shWords(cmd: string): string[] {
  const words: string[] = [];
  let cur = "";
  let inWord = false;
  for (let i = 0; i < cmd.length; ) {
    const ch = cmd[i]!;
    if (ch === "'") {
      const end = cmd.indexOf("'", i + 1);
      if (end < 0) throw new Error("unterminated quote");
      cur += cmd.slice(i + 1, end);
      inWord = true;
      i = end + 1;
    } else if (ch === "\\" && cmd[i + 1] === "'") {
      cur += "'";
      inWord = true;
      i += 2;
    } else if (ch === " ") {
      if (inWord) words.push(cur);
      cur = "";
      inWord = false;
      i++;
    } else if (/[A-Za-z0-9_./:@%+=,-]/.test(ch)) {
      cur += ch;
      inWord = true;
      i++;
    } else {
      throw new Error(`unquoted special character ${JSON.stringify(ch)}`);
    }
  }
  if (inWord) words.push(cur);
  return words;
}

const PS_QUOTES = "'‘’‚‛";

/** Replaces each PowerShell single-quoted literal with L and returns the skeleton plus the literal values. */
function psLiterals(cmd: string): { skeleton: string; literals: string[] } {
  let skeleton = "";
  const literals: string[] = [];
  for (let i = 0; i < cmd.length; ) {
    if (!PS_QUOTES.includes(cmd[i]!)) {
      skeleton += cmd[i++];
      continue;
    }
    let lit = "";
    i++;
    for (;;) {
      if (i >= cmd.length) throw new Error("unterminated literal");
      const ch = cmd[i]!;
      if (PS_QUOTES.includes(ch)) {
        if (i + 1 < cmd.length && PS_QUOTES.includes(cmd[i + 1]!)) {
          lit += cmd[i + 1];
          i += 2;
          continue;
        }
        i++;
        break;
      }
      lit += ch;
      i++;
    }
    literals.push(lit);
    skeleton += "L";
  }
  return { skeleton, literals };
}

const PS_SKELETON =
  "$f = (Resolve-Path -LiteralPath L).ProviderPath; Invoke-RestMethod -Method Put -Uri L -ContentType L -Body ([IO.File]::ReadAllBytes($f))";

describe("R1: upload commands never execute a file name or type", () => {
  const url = "https://handoff.test/v1/uploads/at_x?ticket=AbC-_1";
  const names = [
    "proof$(printf FILENAME_EXPANDED).txt",
    "back`printf X`tick.pdf",
    `it's "quoted".pdf`,
    "spaces in name.pdf",
    "-rf.pdf",
    "-",
    "semi;colon&amp|pipe>out.pdf",
    "‘smart’ quotes‚‛.pdf",
    "$HOME ${PATH} %USERPROFILE%.pdf",
    "[wild]*?.pdf",
    "tab\tand\\back.pdf",
    "x'",
  ];

  it.each(names)("POSIX command keeps %j as one literal argument", (name) => {
    const { curl } = uploadCommands(name, url, "application/pdf");
    expect(shWords(curl)).toEqual(["curl", "-sS", "-X", "PUT", "--data-binary", `@./${name}`, "-H", "content-type: application/pdf", url]);
  });

  it.each(names)("PowerShell command keeps %j inside literals", (name) => {
    const { powershell } = uploadCommands(name, url, "application/pdf");
    const { skeleton, literals } = psLiterals(powershell);
    expect(skeleton).toBe(PS_SKELETON);
    expect(literals).toEqual([`.\\${name}`, url, "application/pdf"]);
  });

  it("the tool reduces the name to a base name, quotes it, and refuses a type that is not accepted", async () => {
    const a = await alice();
    const r = expectOk(await call(a, "handoff_upload_url", { filename: "../dir/proof$(printf X)\n.pdf", mime_type: "application/pdf" }));
    expect(r.method).toBe("PUT");
    expect(r.headers).toEqual({ "content-type": "application/pdf" });
    const words = shWords(String(r.curl));
    expect(words[5]).toBe("@./proof$(printf X).pdf");
    expect(words[8]).toBe(r.upload_url);
    expect(psLiterals(String(r.powershell)).skeleton).toBe(PS_SKELETON);

    for (const bad of ["text/plain$(printf MIME_EXPANDED)", 'text/plain"; printf TYPE_ESCAPED; #', "application/x-sh", "text/html"]) {
      const res = await call(a, "handoff_upload_url", { filename: "proof.txt", mime_type: bad });
      expect(res.isError).toBe(true);
      expect(errorText(res)).toContain("unsupported_type");
    }
    const canon = expectOk(await call(a, "handoff_upload_url", { filename: "n.md", mime_type: "Text/Markdown; charset=UTF-8" }));
    expect(canon.headers).toEqual({ "content-type": "text/markdown" });
  });

  it("without a declared type the command sends application/octet-stream and the upload succeeds", async () => {
    const a = await alice();
    const r = expectOk(await call(a, "handoff_upload_url", { filename: "codeword.pdf" }));
    expect(shWords(String(r.curl))[7]).toBe("content-type: application/octet-stream");
    const put = await SELF.fetch(String(r.upload_url), { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: PDF });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { mime_type: string }).mime_type).toBe("application/pdf");
  });
});

describe("R2: one writer per upload slot over HTTP", () => {
  it("two concurrent PUTs to one slot: exactly one succeeds, and the stored bytes match the stored checksum", async () => {
    const a = await alice();
    const created = await SELF.fetch(`${ORIGIN}/v1/uploads`, {
      method: "POST",
      headers: { authorization: `Bearer ${a}`, "content-type": "application/json" },
      body: JSON.stringify({ filename: "race.pdf" }),
    });
    const { attachment_id, upload_url } = (await created.json()) as { attachment_id: string; upload_url: string };
    const bodies = ["A", "B"].map((x) => new TextEncoder().encode(`%PDF-1.4\n${x}\n%%EOF`));
    const results = await Promise.all(
      bodies.map((body) => SELF.fetch(upload_url, { method: "PUT", headers: { authorization: `Bearer ${a}`, "content-type": "application/pdf" }, body })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const p = await send(a, { attachment_ids: [attachment_id] });
    const dl = await SELF.fetch(`${ORIGIN}/v1/attachments/${attachment_id}/original?packet_id=${p.packet_id}`, { headers: { authorization: `Bearer ${a}` } });
    const bytes = new Uint8Array(await dl.arrayBuffer());
    expect(await sha256Hex(bytes)).toBe(dl.headers.get("x-checksum-sha256"));
    // A published file accepts no further bytes.
    const again = await SELF.fetch(upload_url, { method: "PUT", headers: { authorization: `Bearer ${a}`, "content-type": "application/pdf" }, body: bodies[0] });
    expect(again.status).toBe(409);
  });
});

describe("R3: cleanup finishes deletions it claimed earlier", () => {
  it("a row left with claim 'delete' is removed with its bytes on the next run", async () => {
    const svc = new HandoffService(new D1Repository(env.DB), new R2BlobStore(env.BLOBS), configFrom(env));
    const owner = { subject: `user_${crypto.randomUUID()}`, scopes: [], clientId: "t", token: "" };
    const slot = await svc.createUpload(owner, { filename: "x.pdf" });
    await svc.receiveBytes(slot, PDF, { mime_type: "application/pdf" });
    await env.DB.prepare("UPDATE attachments SET claim = 'delete' WHERE id = ?").bind(slot.id).run();
    await expect(svc.send(owner, { title: "t", brief: "b", attachment_ids: [slot.id], idempotency_key: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
    await svc.cleanup();
    expect(await env.DB.prepare("SELECT id FROM attachments WHERE id = ?").bind(slot.id).first()).toBeNull();
    expect(await env.BLOBS.head(slot.blob_key)).toBeNull();
  });
});

describe("R4: development tokens", () => {
  const devCfg = (tokens: unknown, origin = "http://localhost:8787") => configFrom({ ...env, HANDOFF_ENV: "dev", DEV_TOKENS: JSON.stringify(tokens) }, origin);

  it("production ignores DEV_TOKENS entirely", async () => {
    const cfg = configFrom({ ...env, HANDOFF_ENV: "production", DEV_TOKENS: JSON.stringify({ "dev-token-1": "user_dev" }) });
    expect(cfg.devTokens.size).toBe(0);
    await expect(verifyBearer(cfg, "dev-token-1", env.DB)).rejects.toMatchObject({ error: "invalid_token" });
  });

  it("dev mode ignores DEV_TOKENS on a request that did not come to localhost", async () => {
    for (const origin of ["https://handoff.example.workers.dev", "", "http://localhost.evil.example"]) {
      expect(devCfg({ "dev-token-1": "user_dev" }, origin).devTokens.size, origin).toBe(0);
    }
    expect(devCfg({ "dev-token-1": "user_dev" }, "http://127.0.0.1:8787").devTokens.size).toBe(1);
  });

  it("dev mode accepts only configured own tokens with a string subject", async () => {
    const cfg = devCfg({ "dev-token-1": "user_dev", "dev-token-2": 5, "dev-token-3": "" });
    expect((await verifyBearer(cfg, "dev-token-1", env.DB)).subject).toBe("user_dev");
    for (const t of ["dev-token-2", "dev-token-3", "toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      await expect(verifyBearer(cfg, t, env.DB)).rejects.toMatchObject({ error: "invalid_token" });
    }
  });
});

describe("R5: token claims", () => {
  it("a signed token whose subject is not a string is refused", async () => {
    const now = Math.floor(Date.now() / 1000);
    const bearer = await new SignJWT({ sub: 42 as unknown as string, scope: "handoff", client_id: "test-client" })
      .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .sign(await importJWK(privateJwk, "ES256"));
    expect((await rpc(bearer, "tools/list")).status).toBe(401);
  });
});

describe("R7: log redaction", () => {
  it("removes ticket-length tokens and keeps short ids", () => {
    const ticket = "pL03lYr1vhT9gi02GjpioTZFV0F9uu04S3peYZhS8BQ";
    expect(redactSecrets(`failed /v1/dl/${ticket} for at_hn6cul6nm7z6pm5i2kjt`)).toBe("failed /v1/dl/[redacted] for at_hn6cul6nm7z6pm5i2kjt");
  });
});
