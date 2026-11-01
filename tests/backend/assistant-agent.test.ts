import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantActor } from "../../lib/auth/actor";
import { preferenceInputSchema } from "../../agent/lib/preference";
import { assistantBackendOrigin, createTaskBackend } from "../../agent/lib/task-backend";

const actor: AssistantActor = { id: "google:synthetic-owner", email: "synthetic@agiventures.ca" };

test("saved preference accepts only supported bounded brief formats with provenance", () => {
  assert.equal(preferenceInputSchema.safeParse({
    bulletCount: 3, includeSources: true, explicitRequest: "  Remember three bullets with links.  ",
  }).data?.explicitRequest, "Remember three bullets with links.");
  for (const input of [
    { bulletCount: 99, includeSources: true, explicitRequest: "Remember this." },
    { bulletCount: 3, includeSources: true, explicitRequest: "" },
    { bulletCount: 3, includeSources: true, explicitRequest: "x".repeat(301) },
    { bulletCount: 3, explicitRequest: "Remember this." },
  ]) assert.equal(preferenceInputSchema.safeParse(input).success, false);
});

test("task bridge trusts only a server-configured secure origin", () => {
  assert.equal(assistantBackendOrigin({ EVE_DEV: "1" }), "http://127.0.0.1:3000");
  assert.equal(assistantBackendOrigin({ VERCEL_URL: "demo.vercel.app" }), "https://demo.vercel.app");
  assert.equal(assistantBackendOrigin({ ASSISTANT_APP_ORIGIN: "https://owner.example/" }), "https://owner.example");
  for (const ASSISTANT_APP_ORIGIN of ["http://public.example", "https://owner.example/path", "https://user:password@owner.example", "https://owner.example/?token=x"]) {
    assert.throws(() => assistantBackendOrigin({ ASSISTANT_APP_ORIGIN }));
  }
  assert.throws(() => assistantBackendOrigin({}));
});

test("task bridge sends owner authorization and stable request key without forwarding redirects", async () => {
  let called = false;
  const bridge = createTaskBackend(() => ({
    ASSISTANT_APP_ORIGIN: "https://owner.example",
  }), async (url, options) => {
    called = true;
    assert.equal(url, "https://owner.example/api/assistant/tasks");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    const headers = new Headers(options.headers);
    assert.equal(headers.get("authorization"), "Bearer synthetic-service-token");
    assert.equal(headers.get("x-assistant-idempotency-key"), "session:call_12345");
    assert.deepEqual(JSON.parse(String(options.body)), { mode: "rehearsal" });
    return Response.json({ runId: "wrun_synthetic" }, { status: 202 });
  }, async (signedActor) => { assert.deepEqual(signedActor, actor); return "synthetic-service-token"; });
  const result = await bridge(actor, "/api/assistant/tasks", {
    method: "POST", body: { mode: "rehearsal" }, idempotencyKey: "session:call_12345",
  });
  assert.equal(called, true);
  assert.deepEqual(result, { runId: "wrun_synthetic" });
  await assert.rejects(bridge(actor, "https://attacker.example/api/assistant/tasks"));
});

test("task bridge fails closed without deployment authorization and hides transport errors", async () => {
  let called = false;
  const unauthorized = createTaskBackend(() => ({ VERCEL_URL: "owner.vercel.app" }), async () => {
    called = true;
    return Response.json({});
  }, async () => { throw new Error("synthetic missing signing secret"); });
  await assert.rejects(unauthorized(actor, "/api/assistant/tasks"), /AUTH_SECRET/);
  assert.equal(called, false);
  const unreachable = createTaskBackend(() => ({ EVE_DEV: "1" }), async () => {
    throw new Error("provider credential must never be echoed");
  }, async () => "synthetic-service-token");
  await assert.rejects(unreachable(actor, "/api/assistant/tasks"), error => {
    assert.equal(String(error).includes("credential must never"), false);
    return true;
  });
});
