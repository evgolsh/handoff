import { beforeAll, describe, expect, it } from "vitest";
import { SELF, env } from "cloudflare:test";
import { handleOf, isTeam, qualify, shownRecipient, teamOf, tenantOf, tenantWhere } from "../src/domain/tenant";
import { ORIGIN, PDF, call, errorText, expectOk, send, token, uploadBytes } from "./helpers";

/**
 * Tenancy by qualified identity: on the control center a member is `tenant/handle`. Two tenants with the same
 * handle names must never see each other's packets, and `to: "tom"` means the sender's own tenant's tom.
 */
describe("tenants are isolated by their qualified identities", () => {
  const acmeTim = () => token("acme/tim");
  const acmeTom = () => token("acme/tom");
  const betaTom = () => token("beta/tom");
  const betaAnn = () => token("beta/ann");

  beforeAll(async () => {
    const at = new Date().toISOString();
    for (const h of ["acme/tim", "acme/tom", "beta/tom", "beta/ann"]) {
      await env.DB.prepare("INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at) VALUES (?, 's', 'h', ?)").bind(h, at).run();
    }
  });

  it("helpers split and join identities", async () => {
    expect(tenantOf("acme/tim")).toBe("acme");
    expect(tenantOf("tim")).toBe("");
    expect(handleOf("acme/tim")).toBe("tim");
    expect(qualify("acme", "tim")).toBe("acme/tim");
    expect(qualify("", "tim")).toBe("tim");
    expect(teamOf("acme")).toBe("acme/*");
    expect(teamOf("")).toBe("*");
    expect(isTeam("acme/*")).toBe(true);
    expect(isTeam("acme/tom")).toBe(false);
    expect(shownRecipient("acme/*")).toBe("*");
    expect(shownRecipient("acme/tom")).toBe("tom");
    expect(tenantWhere("m.handle", "acme")).toEqual({ sql: "(m.handle >= ? AND m.handle < ?)", binds: ["acme/", "acme0"] });
    expect(tenantWhere("m.handle", "")).toEqual({ sql: "instr(m.handle, '/') = 0", binds: [] });
    // The predicates, run by SQLite, pick exactly the tenant's identities.
    const pick = async (tenant: string) => {
      const w = tenantWhere("handle", tenant);
      const rows = await env.DB.prepare(`SELECT handle FROM members WHERE ${w.sql} ORDER BY handle`).bind(...w.binds).all<{ handle: string }>();
      return rows.results.map((r) => r.handle);
    };
    await env.DB.prepare("INSERT OR IGNORE INTO members (handle, code_salt, code_hash, created_at) VALUES ('acme-two/tim', 's', 'h', ?)").bind(new Date().toISOString()).run();
    expect(await pick("acme")).toEqual(["acme/tim", "acme/tom"]);
    expect(await pick("acme-two")).toEqual(["acme-two/tim"]);
    expect((await pick("")).every((h) => !h.includes("/"))).toBe(true);
  });

  it("to: 'tom' reaches the sender's own tom, shown by handle, and nobody in another tenant", async () => {
    const sent = await send(await acmeTim(), { to: "tom", title: "For acme's tom" });
    expect(sent).toMatchObject({ from: "tim", to: "tom" });

    const tomInbox = expectOk(await call(await acmeTom(), "handoff_inbox")) as { packets: Array<Record<string, unknown>> };
    expect(tomInbox.packets.map((p) => p.packet_id)).toContain(sent.packet_id);
    expect(tomInbox.packets.find((p) => p.packet_id === sent.packet_id)).toMatchObject({ from: "tim", to: "tom" });
    const view = expectOk(await call(await acmeTom(), "handoff_read", { packet_id: sent.packet_id }));
    expect(view).toMatchObject({ from: "tim", to: "tom", title: "For acme's tom" });

    // beta's tom has the same handle and a different identity: not found, not listed.
    const otherInbox = expectOk(await call(await betaTom(), "handoff_inbox")) as { packets: Array<Record<string, unknown>> };
    expect(otherInbox.packets.map((p) => p.packet_id)).not.toContain(sent.packet_id);
    expect(errorText(await call(await betaTom(), "handoff_read", { packet_id: sent.packet_id }))).toContain("not_found");
    expect(errorText(await call(await betaTom(), "handoff_revoke", { packet_id: sent.packet_id }))).toContain("not_found");
  });

  it("a team packet reaches the sender's tenant only", async () => {
    const sent = await send(await betaAnn(), { to: "team", title: "beta team" });
    expect(sent).toMatchObject({ from: "ann", to: "*" });
    const row = await env.DB.prepare("SELECT recipient FROM packets WHERE id = ?").bind(sent.packet_id).first<{ recipient: string }>();
    expect(row?.recipient).toBe("beta/*");

    const betaInbox = expectOk(await call(await betaTom(), "handoff_inbox")) as { packets: Array<Record<string, unknown>> };
    expect(betaInbox.packets.map((p) => p.packet_id)).toContain(sent.packet_id);
    const acmeInbox = expectOk(await call(await acmeTom(), "handoff_inbox")) as { packets: Array<Record<string, unknown>> };
    expect(acmeInbox.packets.map((p) => p.packet_id)).not.toContain(sent.packet_id);
    expect(errorText(await call(await acmeTom(), "handoff_read", { packet_id: sent.packet_id }))).toContain("not_found");
    // Only the sender revokes a team packet, within the tenant.
    expect(errorText(await call(await betaTom(), "handoff_revoke", { packet_id: sent.packet_id }))).toContain("only its sender");
  });

  it("a handle that exists only in another tenant is not a member here", async () => {
    const r = await call(await betaTom(), "handoff_send", { title: "t", brief: "b", to: "tim", idempotency_key: crypto.randomUUID() });
    expect(errorText(r)).toContain("not a member");
  });

  it("an attachment sent inside one tenant cannot be fetched from another", async () => {
    const tim = await acmeTim();
    const up = await uploadBytes(tim, "acme.pdf", PDF, "application/pdf");
    const sent = await send(tim, { to: "tom", attachment_ids: [up.attachment_id] });
    const ok = expectOk(await call(await acmeTom(), "handoff_read", { packet_id: sent.packet_id, attachment_id: up.attachment_id, representation: "original" }));
    expect((await SELF.fetch(String(ok.download_url))).status).toBe(200);
    const denied = await SELF.fetch(`${ORIGIN}/v1/attachments/${up.attachment_id}/original`, { headers: { authorization: `Bearer ${await betaTom()}` } });
    expect(denied.status).toBe(404);
  });
});
