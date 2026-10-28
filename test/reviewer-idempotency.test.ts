import { describe, expect, it } from "vitest";
import { call, expectOk, token } from "./helpers";

describe("reviewer: concurrent packet publication", () => {
  it("identical concurrent sends publish one packet", async () => {
    const bearer = await token(`review-idempotency-${crypto.randomUUID()}`);
    const args = { title: "One logical send", brief: "Synthetic review brief", idempotency_key: crypto.randomUUID() };
    const results = await Promise.all(Array.from({ length: 12 }, () => call(bearer, "handoff_send", args)));
    const ids = results.map((r) => expectOk(r).packet_id);
    expect(new Set(ids).size).toBe(1);
    const inbox = expectOk(await call(bearer, "handoff_inbox"));
    expect(inbox.packets).toHaveLength(1);
  });

  it("conflicting concurrent reuse publishes only one request and rejects the other", async () => {
    const bearer = await token(`review-conflict-${crypto.randomUUID()}`);
    const key = crypto.randomUUID();
    const results = await Promise.all(["A", "B"].map((title) => call(bearer, "handoff_send", {
      title, brief: "Synthetic review brief", idempotency_key: key,
    })));
    expect(results.filter((r) => !r.isError)).toHaveLength(1);
    const errors = results.filter((r) => r.isError);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.content.map((c) => c.text).join(" ")).toContain("idempotency_conflict");
    const inbox = expectOk(await call(bearer, "handoff_inbox"));
    expect(inbox.packets).toHaveLength(1);
  });
});
