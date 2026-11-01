import assert from "node:assert/strict";
import { mock } from "bun:test";
import { HookNotFoundError, WorkflowRunNotFoundError } from "workflow/errors";
import type { AssistantActor } from "../../lib/auth/actor";
import type { AssistantTaskInput, TaskEvent } from "../../lib/assistant/types";

process.env.AUTH_SECRET =
  "synthetic-isolation-test-secret-at-least-32-characters";
process.env.AUTH_GOOGLE_WORKSPACE_DOMAIN = "workspace.example";
const alice: AssistantActor = {
  id: "google:synthetic-alice",
  email: "alice@workspace.example",
};
const bob: AssistantActor = {
  id: "google:synthetic-bob",
  email: "bob@workspace.example",
};
const taskName = "workflow//./workflows/assistant-task//assistantTaskWorkflow";
const preferenceName =
  "workflow//./workflows/assistant-task//assistantPreferenceWorkflow";
type RecordFixture = {
  runId: string;
  workflowName: string;
  attributes: Record<string, string>;
  status: string;
  createdAt: Date;
  completedAt?: Date;
  events: TaskEvent[];
  output?: unknown;
};
const records = new Map<string, RecordFixture>();
const hooks = new Map<string, string>();
const openedStreams: string[] = [];
const controls: unknown[] = [];
let starts = 0;
let listCalls = 0;
let endlessScan = false;

mock.module("workflow/runtime", () => ({
  getWorld: async () => ({
    runs: {
      get: async (id: string) => {
        const value = records.get(id);
        if (!value) throw new WorkflowRunNotFoundError(id);
        return value;
      },
      list: async (query: {
        workflowName: string;
        status?: string;
        pagination: { cursor?: string; limit: number };
      }) => {
        listCalls++;
        if (endlessScan)
          return {
            data: [],
            hasMore: true,
            cursor: String(Number(query.pagination.cursor ?? 0) + 1),
          };
        const data = [...records.values()]
          .filter(
            (row) =>
              row.workflowName === query.workflowName &&
              (!query.status || row.status === query.status),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const offset = Number(query.pagination.cursor ?? 0),
          limit = query.pagination.limit;
        return {
          data: data.slice(offset, offset + limit),
          hasMore: offset + limit < data.length,
          cursor: offset + limit < data.length ? String(offset + limit) : null,
        };
      },
    },
  }),
}));
mock.module("workflow/api", () => ({
  start: async (
    workflow: ((...args: unknown[]) => unknown) & { name: string },
    args: unknown[],
    options: { attributes: Record<string, string> },
  ) => {
    const runId = `wrun_synthetic_created_${++starts}`;
    const input = args[0] as AssistantTaskInput;
    const isPreference = workflow.name === "assistantPreferenceWorkflow";
    records.set(runId, {
      runId,
      workflowName: isPreference ? preferenceName : taskName,
      attributes: options.attributes,
      status: isPreference ? "completed" : "running",
      createdAt: new Date(2000000000000 + starts),
      events: isPreference
        ? []
        : [
            {
              id: `checkpoint_${runId}`,
              occurredAt: new Date().toISOString(),
              type: "status",
              status: "queued",
              title: input.title,
              detail: "Synthetic owned task",
              input,
            },
          ],
      output: isPreference ? input : undefined,
    });
    if (!isPreference)
      hooks.set(`assistant-task:${input.owner!.id}:${input.taskId}`, runId);
    return { runId, returnValue: Promise.resolve(input) };
  },
  getHookByToken: async (token: string) => {
    const id = hooks.get(token);
    if (!id) throw new HookNotFoundError(token);
    return { runId: id };
  },
  resumeHook: async (token: string, payload: unknown) => {
    controls.push({ token, payload });
    return { runId: hooks.get(token) };
  },
  getRun: (id: string) => {
    const record = records.get(id)!;
    return {
      exists: Promise.resolve(Boolean(record)),
      workflowName: Promise.resolve(record?.workflowName),
      status: Promise.resolve(record?.status),
      createdAt: Promise.resolve(record?.createdAt),
      completedAt: Promise.resolve(record?.completedAt),
      returnValue: Promise.resolve(record?.output),
      cancel: async () => {
        controls.push({ cancelled: id });
        record.status = "cancelled";
      },
      wakeUp: async () => ({ stoppedCount: 1 }),
      getReadable: () => {
        openedStreams.push(id);
        const stream = new ReadableStream<string>({
          start(controller) {
            for (const event of record.events)
              controller.enqueue(JSON.stringify(event) + "\n");
            controller.close();
          },
        });
        return Object.assign(stream, {
          getTailIndex: async () => record.events.length - 1,
        });
      },
    };
  },
}));

const { assistantOwnerAttributes } =
  await import("../../lib/assistant/ownership");
const { signAssistantServiceToken } = await import("../../lib/auth/request");
const tasks = await import("../../app/api/assistant/tasks/route");
const detail = await import("../../app/api/assistant/tasks/[runId]/route");
const stream =
  await import("../../app/api/assistant/tasks/[runId]/stream/route");
const preferences = await import("../../app/api/assistant/preferences/route");
const { listAssistantTasks } = await import("../../lib/assistant/tasks");
const tokens = new Map([
  [alice.id, await signAssistantServiceToken(alice)],
  [bob.id, await signAssistantServiceToken(bob)],
]);
const { encode } = await import("next-auth/jwt");
const browserTokens = new Map(
  await Promise.all(
    [alice, bob].map(
      async (actor) =>
        [
          actor.id,
          await encode({
            secret: process.env.AUTH_SECRET!,
            salt: "authjs.session-token",
            maxAge: 300,
            token: {
              sub: actor.id,
              email: actor.email,
              workspaceDomain: "workspace.example",
              sessionKind: "assistant-user",
            },
          }),
        ] as const,
    ),
  ),
);
function browserRequest(
  actor: AssistantActor,
  path: string,
  body?: unknown,
  origin = "http://localhost:3000",
) {
  return new Request(`http://localhost:3000${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: `authjs.session-token=${browserTokens.get(actor.id)}`,
      Origin: origin,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function request(
  actor: AssistantActor,
  path: string,
  body?: unknown,
  extra?: Record<string, string>,
) {
  return new Request(`http://localhost:3000${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${tokens.get(actor.id)}`,
      "Content-Type": "application/json",
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function fixture(
  actor: AssistantActor | undefined,
  id: string,
  status = "running",
  createdAt = new Date("2026-01-01T12:00:00Z"),
) {
  const input = {
    owner: actor,
    taskId: id,
    title: actor === bob ? "Bob private task" : "Alice owned task",
    prompt: "Synthetic fixture",
    mode: "rehearsal",
    manualStart: true,
    delaySeconds: 0,
    approvalRequired: true,
    sourceVersion: 1,
    maxChecks: 1,
    preference: { bulletCount: 3, includeLinks: true },
  } as AssistantTaskInput;
  records.set(id, {
    runId: id,
    workflowName: taskName,
    attributes: actor ? assistantOwnerAttributes(actor) : {},
    status,
    createdAt,
    events: [
      {
        id: `gate_${id}`,
        occurredAt: createdAt.toISOString(),
        type: "status",
        status: status === "completed" ? "completed" : "queued",
        title: input.title,
        detail: "Synthetic fixture",
        input,
      },
    ],
  });
}
fixture(alice, "wrun_synthetic_alice_owned");
fixture(bob, "wrun_synthetic_bob_private");
fixture(undefined, "wrun_synthetic_legacy_unowned");
for (let i = 0; i < 130; i++)
  fixture(
    bob,
    `wrun_synthetic_bob_history_${i}`,
    "completed",
    new Date(Date.now() + i),
  );
const listResponse = await tasks.GET(request(alice, "/api/assistant/tasks"));
assert.equal(listResponse.status, 200);
const listBody = await listResponse.json();
assert.deepEqual(
  listBody.tasks.map((task: { runId: string }) => task.runId),
  ["wrun_synthetic_alice_owned"],
  "Owned history must survive pages of another actor's newer runs",
);
assert.ok(
  listCalls > 3,
  "The list must page through foreign metadata instead of truncating before an owned run",
);
assert.ok(!JSON.stringify(listBody).includes("Bob private task"));
for (const foreignId of [
  "wrun_synthetic_bob_private",
  "wrun_synthetic_legacy_unowned",
]) {
  const before = openedStreams.length;
  assert.equal(
    (
      await detail.GET(request(alice, `/api/assistant/tasks/${foreignId}`), {
        params: Promise.resolve({ runId: foreignId }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await detail.POST(
        request(alice, `/api/assistant/tasks/${foreignId}`, {
          action: "cancel",
          requestId: "synthetic-cancel-request",
        }),
        { params: Promise.resolve({ runId: foreignId }) },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await stream.GET(
        request(alice, `/api/assistant/tasks/${foreignId}/stream`),
        { params: Promise.resolve({ runId: foreignId }) },
      )
    ).status,
    404,
  );
  assert.equal(
    openedStreams.length,
    before,
    "Foreign streams must remain unopened",
  );
}
assert.equal(
  controls.length,
  0,
  "Cross-user controls must never reach Workflow APIs",
);
const ownResponse = await stream.GET(
  request(alice, "/api/assistant/tasks/wrun_synthetic_alice_owned/stream"),
  { params: Promise.resolve({ runId: "wrun_synthetic_alice_owned" }) },
);
assert.equal(ownResponse.status, 200);
assert.ok((await ownResponse.text()).includes("Alice owned task"));
const body = { title: "Owned creation", manualStart: true, owner: bob };
const createdA = await tasks.POST(
  request(alice, "/api/assistant/tasks", body, {
    "x-assistant-idempotency-key": "same-client-request-key",
  }),
);
assert.equal(createdA.status, 202);
const a = await createdA.json();
const repeatA = await tasks.POST(
  request(alice, "/api/assistant/tasks", body, {
    "x-assistant-idempotency-key": "same-client-request-key",
  }),
);
assert.equal((await repeatA.json()).runId, a.runId);
const createdB = await tasks.POST(
  request(bob, "/api/assistant/tasks", body, {
    "x-assistant-idempotency-key": "same-client-request-key",
  }),
);
assert.equal(createdB.status, 202);
const b = await createdB.json();
assert.notEqual(a.runId, b.runId);
assert.equal(
  records.get(a.runId)?.events[0].input?.owner?.id,
  alice.id,
  "Body owner cannot override authenticated actor",
);
assert.notEqual(
  records.get(a.runId)?.events[0].input?.taskId,
  records.get(b.runId)?.events[0].input?.taskId,
);
const ownControl = await detail.POST(
  request(alice, `/api/assistant/tasks/${a.runId}`, {
    action: "start",
    requestId: "synthetic-owned-start",
    expectedCheckpointId: records.get(a.runId)?.events[0].id,
  }),
  { params: Promise.resolve({ runId: a.runId }) },
);
assert.equal(
  ownControl.status,
  202,
  "The same ownership boundary must allow the authenticated owner's control",
);
assert.ok(
  JSON.stringify(controls.at(-1)).includes(`assistant-task:${alice.id}:`),
  "Control hook tokens must include the authenticated actor",
);
records.get(a.runId)!.events[0].status = "awaiting_approval";
const beforeDecisionControls = controls.length;
for (const action of ["approve", "deny"]) {
  const response = await detail.POST(
    request(alice, `/api/assistant/tasks/${a.runId}`, {
      action,
      requestId: `synthetic-service-${action}`,
      expectedCheckpointId: records.get(a.runId)?.events[0].id,
    }),
    { params: Promise.resolve({ runId: a.runId }) },
  );
  assert.equal(
    response.status,
    401,
    "Delegated EVE credentials cannot approve or deny owner decisions",
  );
}
assert.equal(
  controls.length,
  beforeDecisionControls,
  "Service-only decisions must not reach resumeHook",
);
const approvalBody = {
  action: "approve",
  requestId: "synthetic-browser-approve",
  expectedCheckpointId: records.get(a.runId)?.events[0].id,
};
assert.equal(
  (
    await detail.POST(
      browserRequest(bob, `/api/assistant/tasks/${a.runId}`, approvalBody),
      { params: Promise.resolve({ runId: a.runId }) },
    )
  ).status,
  404,
  "Another signed-in browser user cannot approve Alice's task",
);
assert.equal(
  (
    await detail.POST(
      browserRequest(
        alice,
        `/api/assistant/tasks/${a.runId}`,
        approvalBody,
        "https://cross-site.example",
      ),
      { params: Promise.resolve({ runId: a.runId }) },
    )
  ).status,
  401,
  "Cross-origin cookies cannot authorize a decision",
);
assert.equal(
  (
    await detail.POST(
      browserRequest(alice, `/api/assistant/tasks/${a.runId}`, approvalBody),
      { params: Promise.resolve({ runId: a.runId }) },
    )
  ).status,
  202,
  "The owning same-origin browser can approve the exact checkpoint",
);
fixture(alice, "wrun_synthetic_alice_browser_deny");
records.get("wrun_synthetic_alice_browser_deny")!.events[0].status =
  "awaiting_approval";
assert.equal(
  (
    await detail.POST(
      browserRequest(
        alice,
        "/api/assistant/tasks/wrun_synthetic_alice_browser_deny",
        {
          action: "deny",
          requestId: "synthetic-browser-deny",
          expectedCheckpointId: records.get("wrun_synthetic_alice_browser_deny")
            ?.events[0].id,
        },
      ),
      {
        params: Promise.resolve({ runId: "wrun_synthetic_alice_browser_deny" }),
      },
    )
  ).status,
  202,
  "The owning same-origin browser can decline a proposal",
);
for (let i = 0; i < 20; i++) fixture(bob, `wrun_synthetic_bob_active_${i}`);
assert.equal(
  (
    await tasks.POST(
      request(alice, "/api/assistant/tasks", {
        title: "Alice capacity remains available",
      }),
    )
  ).status,
  202,
  "Other users cannot consume Alice's active quota",
);
assert.equal(
  (
    await tasks.POST(
      request(bob, "/api/assistant/tasks", {
        title: "Bob exceeds own capacity",
      }),
    )
  ).status,
  429,
);
records.set("wrun_synthetic_legacy_preference", {
  runId: "wrun_synthetic_legacy_preference",
  workflowName: preferenceName,
  attributes: {},
  status: "completed",
  createdAt: new Date(3000000000000),
  events: [],
  output: { bulletCount: 5, includeLinks: false, reset: false },
});
const prefA = await preferences.PUT(
  new Request(
    request(alice, "/api/assistant/preferences", {
      bulletCount: 5,
      includeLinks: false,
    }),
    { method: "PUT" },
  ),
);
assert.equal(prefA.status, 200);
const prefBDefault = await preferences.GET(
  request(bob, "/api/assistant/preferences"),
);
assert.deepEqual((await prefBDefault.json()).preference, {
  bulletCount: 3,
  includeLinks: true,
});
assert.equal(
  (
    await preferences.PUT(
      new Request(
        request(bob, "/api/assistant/preferences", {
          bulletCount: 3,
          includeLinks: false,
        }),
        { method: "PUT" },
      ),
    )
  ).status,
  200,
);
assert.deepEqual(
  (
    await (
      await preferences.GET(request(alice, "/api/assistant/preferences"))
    ).json()
  ).preference,
  { bulletCount: 5, includeLinks: false },
);
assert.equal(
  (
    await preferences.DELETE(
      new Request(request(alice, "/api/assistant/preferences"), {
        method: "DELETE",
      }),
    )
  ).status,
  200,
);
assert.deepEqual(
  (
    await (
      await preferences.GET(request(bob, "/api/assistant/preferences"))
    ).json()
  ).preference,
  { bulletCount: 3, includeLinks: false },
  "Alice's reset must not change Bob's preference",
);
const deniedHeaders = {
  Authorization: "Bearer legacy-demo-token",
  "x-assistant-owner": alice.id,
  "x-assistant-actor": JSON.stringify(alice),
};
const unauthenticated = (method: string, path: string, body?: unknown) =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: { ...deniedHeaders, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ownContext = { params: Promise.resolve({ runId: a.runId }) };
for (const call of [
  () => tasks.GET(unauthenticated("GET", "/api/assistant/tasks")),
  () =>
    tasks.POST(
      unauthenticated("POST", "/api/assistant/tasks", { owner: alice }),
    ),
  () =>
    detail.GET(
      unauthenticated("GET", `/api/assistant/tasks/${a.runId}`),
      ownContext,
    ),
  () =>
    detail.POST(
      unauthenticated("POST", `/api/assistant/tasks/${a.runId}`, {
        action: "cancel",
        requestId: "forged-owner-cancel",
      }),
      ownContext,
    ),
  () =>
    stream.GET(
      unauthenticated("GET", `/api/assistant/tasks/${a.runId}/stream`),
      ownContext,
    ),
  () => preferences.GET(unauthenticated("GET", "/api/assistant/preferences")),
  () =>
    preferences.PUT(
      unauthenticated("PUT", "/api/assistant/preferences", {
        bulletCount: 5,
        includeLinks: false,
      }),
    ),
  () =>
    preferences.DELETE(unauthenticated("DELETE", "/api/assistant/preferences")),
])
  assert.equal(
    (await call()).status,
    401,
    "Every assistant task/preference boundary must reject legacy demo credentials and forged actor headers",
  );
endlessScan = true;
await assert.rejects(
  listAssistantTasks(alice),
  (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 503,
);
endlessScan = false;
console.log(
  JSON.stringify({
    crossUserReadControlStream: "denied",
    legacyUnowned: "denied",
    ownedHistoryPagination: "passed",
    idempotency: "actor-scoped",
    caps: "actor-scoped",
    preferences: "isolated",
    forgedIdentity: "denied",
    boundedScan: "fails-explicitly",
    ownerDecisions: "cookie-only",
  }),
);
