import assert from "node:assert/strict";
import { test } from "node:test";
import { importKey } from "@workflow/core/encryption";
import { dehydrateWorkflowArguments } from "@workflow/core/serialization";
import type { RouteHandlerArgs } from "eve/channels";
import type { SessionContext } from "eve/context";
import { createAssistantChannel } from "../../agent/channels/eve";
import {
  assistantActorPrincipal,
  assistantBrowserRequestAllowed,
  assistantGoogleAuth,
  assistantSessionOwnerFromInput,
  decodeAssistantSessionOwner,
  requireAssistantContextActor,
} from "../../agent/lib/auth";
import { createTaskBackend } from "../../agent/lib/task-backend";
import type { AssistantActor } from "../../lib/auth/actor";

const actorA: AssistantActor = { id: "google:synthetic-user-a", email: "synthetic-a@workspace.example" };
const actorB: AssistantActor = { id: "google:synthetic-user-b", email: "synthetic-b@workspace.example" };
const sessionA = "wrun_synthetic_user_a_session";
const sessionB = "wrun_synthetic_user_b_session";

function request(cookie: string | null, path: string, method = "GET", extra: Record<string, string> = {}, body?: unknown) {
  return new Request(`https://assistant.example${path}`, {
    method,
    headers: {
      origin: "https://assistant.example",
      ...(cookie ? { cookie: `synthetic-session=${cookie}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/** Unit fixture: real JWT verification is covered by assistant-auth tests. */
function authorization(ownerRead?: (id: string) => void) {
  return assistantGoogleAuth({
    session: async (req) => req.headers.get("cookie") === "synthetic-session=a" ? actorA
      : req.headers.get("cookie") === "synthetic-session=b" ? actorB : null,
    owner: async (id) => {
      ownerRead?.(id);
      return id === sessionA ? actorA : id === sessionB ? actorB : null;
    },
    proxyOrigin: async () => "https://assistant.example",
  });
}

function immutableInput(actor: AssistantActor) {
  return [{ serializedContext: {
    "eve.auth": assistantActorPrincipal(actor),
    "eve.initiatorAuth": assistantActorPrincipal(actor),
  }, input: { message: "Synthetic private conversation, never returned by ACL." } }];
}

test("create authentication selects each verified cookie actor and ignores forged identity headers", async () => {
  const auth = authorization();
  for (const [cookie, actor] of [["a", actorA], ["b", actorB]] as const) {
    assert.deepEqual(await auth(request(cookie, "/eve/v1/session", "POST", {
      "x-assistant-actor": actorB.id,
      "x-user-email": actorB.email,
      authorization: "Bearer synthetic-shared-token",
      "x-vercel-oidc-token": "synthetic-infrastructure-token",
    })), assistantActorPrincipal(actor));
  }
  assert.equal(await auth(request(null, "/eve/v1/session", "POST", {
    "x-assistant-actor": actorA.id,
    "x-user-email": actorA.email,
    authorization: "Bearer synthetic-shared-token",
    "x-vercel-oidc-token": "synthetic-infrastructure-token",
  })), null);
});

test("both users can authenticate their own session, but known foreign and unowned IDs fail closed", async () => {
  const auth = authorization();
  for (const [cookie, ownId, actor, foreignId] of [
    ["a", sessionA, actorA, sessionB], ["b", sessionB, actorB, sessionA],
  ] as const) {
    for (const suffix of ["", "/stream", "/cancel", "/compact", "/clear", "/reset"]) {
      const method = suffix === "/stream" ? "GET" : "POST";
      assert.deepEqual(await auth(request(cookie, `/eve/v1/session/${ownId}${suffix}`, method)), assistantActorPrincipal(actor));
      for (const id of [foreignId, "wrun_old_shared_owner_session", "wrun_missing_session"])
        await assert.rejects(Promise.resolve(auth(request(cookie, `/eve/v1/session/${id}${suffix}`, method))), /not available to your account/);
    }
  }
});

test("actual EVE continue/read-stream/control handlers deny foreign actors before binding runtime handles", async () => {
  const ownershipReads: string[] = [];
  const channel = createAssistantChannel(authorization(id => ownershipReads.push(id)));
  const guarded = channel.routes.filter(route => route.path.includes(":sessionId"));
  assert.equal(guarded.length, 6);
  for (const route of guarded) {
    assert.equal(route.transport, "http");
    if (route.transport !== "http") continue;
    for (const [cookie, foreignId] of [["a", sessionB], ["b", sessionA]]) {
      let runtimeBound = false;
      const args = {
        params: { sessionId: foreignId },
        attachSession: () => { runtimeBound = true; throw new Error("ACL must run first"); },
      } as unknown as RouteHandlerArgs;
      const path = route.path.replace(":sessionId", foreignId);
      const response: Response = await route.handler(request(cookie, path, route.method, {}, route.method === "POST" ? { message: "Synthetic continue" } : undefined), args);
      assert.equal(response.status, 403, `${route.method} ${route.path}`);
      assert.equal(runtimeBound, false);
    }
  }
  assert.equal(ownershipReads.length, guarded.length * 2);
});

test("private EVE authentication requires a verified proxy proof, never a plain origin stamp", async () => {
  const auth = assistantGoogleAuth({ session: async () => actorA });
  const forgedHeaders: Record<string, string>[] = [
    { "x-assistant-original-origin": "https://assistant.example" },
    { "x-assistant-original-origin": "https://assistant.example", "x-assistant-origin-proof": "synthetic-forged-proof" },
  ];
  for (const extra of forgedHeaders)
    assert.equal(await auth(request("a", "/eve/v1/session", "POST", extra)), null);
  assert.equal(assistantBrowserRequestAllowed(request("a", "/eve/v1/session", "POST"), null), false);
  assert.equal(assistantBrowserRequestAllowed(request("a", "/eve/v1/session", "POST", { origin: "https://attacker.example" }), "https://assistant.example"), false);
  assert.equal(assistantBrowserRequestAllowed(request("a", "/eve/v1/session", "POST", { "sec-fetch-site": "cross-site" }), "https://assistant.example"), false);
  assert.equal(assistantBrowserRequestAllowed(new Request("https://assistant.example/eve/v1/session", { method: "POST" }), "https://assistant.example"), false);
});

test("private channel surface excludes callback, task-input, remote-subagent, and anonymous routes", async () => {
  const channel = createAssistantChannel(authorization());
  assert.deepEqual(channel.routes.map(route => `${route.method} ${route.path}`), [
    "GET /eve/v1/health", "HEAD /eve/v1/health", "GET /eve/v1/info", "POST /eve/v1/session",
    "POST /eve/v1/session/:sessionId", "POST /eve/v1/session/:sessionId/cancel",
    "POST /eve/v1/session/:sessionId/compact", "POST /eve/v1/session/:sessionId/clear",
    "POST /eve/v1/session/:sessionId/reset", "GET /eve/v1/session/:sessionId/stream",
  ]);
  for (const route of channel.routes.filter(route => !route.path.endsWith("/health"))) {
    if (route.transport !== "http") continue;
    const response = await route.handler(request(null, route.path.replace(":sessionId", sessionA), route.method), {
      params: { sessionId: sessionA },
    } as unknown as RouteHandlerArgs);
    assert.equal(response.status, 401, route.path);
  }
});

test("authenticated requests cannot forward a different principal into new or existing sessions", async () => {
  const channel = createAssistantChannel(authorization());
  for (const path of ["/eve/v1/session", "/eve/v1/session/:sessionId"]) {
    const route = channel.routes.find(route => route.method === "POST" && route.path === path)!;
    assert.equal(route.transport, "http");
    if (route.transport !== "http") continue;
    const response = await route.handler(request("a", path.replace(":sessionId", sessionA), "POST", {}, {
      message: "Synthetic forged actor", forwardedPrincipal: assistantActorPrincipal(actorB),
    }), { params: { sessionId: sessionA } } as unknown as RouteHandlerArgs);
    assert.equal(response.status, 403);
  }
});

test("immutable ownership decodes actual Workflow serialized and encrypted arguments without loading session streams", async () => {
  const input = immutableInput(actorA);
  for (const v1Compat of [false, true]) {
    const serialized = await dehydrateWorkflowArguments(input, sessionA, undefined, undefined, undefined, v1Compat);
    assert.deepEqual(await decodeAssistantSessionOwner(serialized), actorA);
  }
  const rawKey = new Uint8Array(32).fill(7);
  const key = await importKey(rawKey, ["encrypt", "decrypt"]);
  const encrypted = await dehydrateWorkflowArguments(input, sessionA, key);
  assert.deepEqual(await decodeAssistantSessionOwner(encrypted, rawKey), actorA);
  assert.equal(await decodeAssistantSessionOwner(encrypted), null);
  await assert.rejects(decodeAssistantSessionOwner(encrypted, new Uint8Array(32).fill(9)));
  const mismatched = immutableInput(actorA);
  mismatched[0].serializedContext["eve.auth"] = assistantActorPrincipal(actorB);
  assert.equal(assistantSessionOwnerFromInput(mismatched), null);
  assert.equal(assistantSessionOwnerFromInput([{ serializedContext: { "eve.auth": { principalId: "assistant-owner" } } }]), null);
  assert.equal(assistantSessionOwnerFromInput([{ owner: actorA }]), null);
});

test("tools require verified matching current and creator actors, regardless of model arguments", () => {
  const context = (current: unknown, initiator: unknown) => ({
    session: { auth: { current, initiator } },
  }) as Pick<SessionContext, "session">;
  assert.deepEqual(requireAssistantContextActor(context(assistantActorPrincipal(actorA), assistantActorPrincipal(actorA))), actorA);
  for (const [current, creator] of [
    [assistantActorPrincipal(actorB), assistantActorPrincipal(actorA)],
    [null, assistantActorPrincipal(actorA)],
    [{ principalId: actorA.id, principalType: "user", attributes: { email: actorA.email } }, assistantActorPrincipal(actorA)],
    [assistantActorPrincipal({ ...actorA, id: "forged-not-a-google-subject" }), assistantActorPrincipal(actorA)],
  ]) assert.throws(() => requireAssistantContextActor(context(current, creator)), /Sign in/);
});

test("session ownership follows the stable verified Google subject when a profile email changes", async () => {
  const renamed = { ...actorA, email: "synthetic-a-renamed@workspace.example" };
  const auth = assistantGoogleAuth({
    session: async () => renamed,
    owner: async () => actorA,
    proxyOrigin: async () => "https://assistant.example",
  });
  assert.deepEqual(await auth(request("a", `/eve/v1/session/${sessionA}/stream`)), assistantActorPrincipal(renamed));
  const ctx = { session: { auth: { current: assistantActorPrincipal(renamed), initiator: assistantActorPrincipal(actorA) } } } as Pick<SessionContext, "session">;
  assert.deepEqual(requireAssistantContextActor(ctx), renamed);
});

test("task bridge signs each exact actor and cannot substitute shared demo or infrastructure authority", async () => {
  const signed: string[] = [];
  const credentials: string[] = [];
  const bridge = createTaskBackend(() => ({
    ASSISTANT_APP_ORIGIN: "https://assistant.example", VERCEL_OIDC_TOKEN: "synthetic-platform-only",
  }), async (_url, options) => {
    credentials.push(new Headers(options.headers).get("authorization")!);
    return Response.json({ tasks: [] });
  }, async actor => { signed.push(actor.id); return `synthetic-scoped-${actor.id}`; });
  await bridge(actorA, "/api/assistant/tasks");
  await bridge(actorB, "/api/assistant/tasks");
  assert.deepEqual(signed, [actorA.id, actorB.id]);
  assert.deepEqual(credentials, [`Bearer synthetic-scoped-${actorA.id}`, `Bearer synthetic-scoped-${actorB.id}`]);
  await assert.rejects(bridge({ ...actorA, id: "forged-not-a-google-subject" }, "/api/assistant/tasks"), /verified/);
  assert.equal(signed.length, 2);
});
