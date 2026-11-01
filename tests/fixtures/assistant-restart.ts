import assert from "node:assert/strict";
import { mock } from "bun:test";
import { HookNotFoundError, WorkflowRunNotFoundError } from "workflow/errors";
import type { AssistantActor } from "../../lib/auth/actor";
import type { AssistantTaskInput, TaskEvent } from "../../lib/assistant/types";

process.env.AUTH_SECRET =
  "synthetic-restart-fixture-secret-at-least-32-characters";
process.env.AUTH_GOOGLE_WORKSPACE_DOMAIN = "agiventures.ca";
process.env.ASSISTANT_CALENDAR_WRITE_ENABLED = "true";
const alice: AssistantActor = {
  id: "google:synthetic-restart-alice",
  email: "alice@agiventures.ca",
};
const bob: AssistantActor = {
  id: "google:synthetic-restart-bob",
  email: "bob@agiventures.ca",
};
const workflowName =
  "workflow//./workflows/assistant-task//assistantTaskWorkflow";
type Fixture = {
  runId: string;
  workflowName: string;
  attributes: Record<string, string>;
  status: string;
  createdAt: Date;
  events: TaskEvent[];
};
const records = new Map<string, Fixture>();
const hooks = new Map<string, string>();
const opened: string[] = [];
const mutations: string[] = [];
let starts = 0,
  failStart = false,
  failCancel = false;
mock.module("workflow/runtime", () => ({
  getWorld: async () => ({
    runs: {
      get: async (runId: string) => {
        const record = records.get(runId);
        if (!record) throw new WorkflowRunNotFoundError(runId);
        return record;
      },
      list: async (query: {
        workflowName: string;
        status?: string;
        pagination: { cursor?: string; limit: number };
      }) => {
        const all = [...records.values()].filter(
          (record) =>
            record.workflowName === query.workflowName &&
            (!query.status || record.status === query.status),
        );
        const offset = Number(query.pagination.cursor ?? 0),
          limit = query.pagination.limit;
        return {
          data: all.slice(offset, offset + limit),
          hasMore: offset + limit < all.length,
          cursor: offset + limit < all.length ? String(offset + limit) : null,
        };
      },
    },
  }),
}));
mock.module("workflow/api", () => ({
  getRun: (runId: string) => {
    const record = records.get(runId)!;
    return {
      status: Promise.resolve(record.status),
      createdAt: Promise.resolve(record.createdAt),
      completedAt: Promise.resolve(undefined),
      cancel: async () => {
        if (failCancel) throw new Error("Synthetic cancellation outage");
        mutations.push(`cancel:${runId}`);
        record.status = "cancelled";
      },
      getReadable: () => {
        opened.push(runId);
        return Object.assign(
          new ReadableStream<string>({
            start(controller) {
              for (const event of record.events)
                controller.enqueue(JSON.stringify(event) + "\n");
              controller.close();
            },
          }),
          { getTailIndex: async () => record.events.length - 1 },
        );
      },
    };
  },
  getHookByToken: async (token: string) => {
    const runId = hooks.get(token);
    if (!runId) throw new HookNotFoundError(token);
    return { runId };
  },
  resumeHook: async (_token: string, payload: { action: string }) => {
    mutations.push(`control:${payload.action}`);
  },
  start: async (
    _workflow: unknown,
    args: [AssistantTaskInput],
    options: { attributes: Record<string, string> },
  ) => {
    if (failStart) throw new Error("Synthetic start outage");
    const input = args[0],
      runId = `wrun_synthetic_restart_child_${++starts}`;
    mutations.push(`start:${runId}`);
    records.set(runId, {
      runId,
      workflowName,
      attributes: options.attributes,
      status: "running",
      createdAt: new Date(),
      events: [
        {
          id: `initial_${runId}`,
          occurredAt: new Date().toISOString(),
          type: "status",
          status:
            input.kind === "calendar_event" ? "awaiting_approval" : "paused",
          title: "New owned restart",
          detail: "Synthetic fixture",
          input,
          demoStage: input.demoMode ? "read" : undefined,
          demoGate: input.demoMode,
        },
      ],
    });
    hooks.set(`assistant-task:${input.owner!.id}:${input.taskId}`, runId);
    return { runId };
  },
}));
const { assistantOwnerAttributes } =
  await import("../../lib/assistant/ownership");
const { assistantTaskSchema } = await import("../../lib/assistant/task-policy");
const { signAssistantServiceToken } = await import("../../lib/auth/request");
const { encode } = await import("next-auth/jwt");
const restart =
  await import("../../app/api/assistant/tasks/[runId]/restart/route");
const detail = await import("../../app/api/assistant/tasks/[runId]/route");
const tasks = await import("../../app/api/assistant/tasks/route");
const cookieTokens = new Map(
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
              sessionKind: "assistant-user",
              workspaceDomain: "agiventures.ca",
            },
          }),
        ] as const,
    ),
  ),
);
function request(
  actor: AssistantActor,
  runId: string,
  body: unknown,
  {
    origin = "http://localhost:3000",
    service = false,
    path = "restart",
  }: { origin?: string; service?: boolean; path?: string } = {},
) {
  return new Request(
    `http://localhost:3000/api/assistant/tasks/${runId}${path ? `/${path}` : ""}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...(service
          ? { Authorization: `Bearer ${serviceTokens.get(actor.id)}` }
          : { Cookie: `authjs.session-token=${cookieTokens.get(actor.id)}` }),
      },
      body: JSON.stringify(body),
    },
  );
}
const serviceTokens = new Map(
  await Promise.all(
    [alice, bob].map(
      async (actor) =>
        [actor.id, await signAssistantServiceToken(actor)] as const,
    ),
  ),
);
function fixture(
  runId: string,
  actor?: AssistantActor,
  inputFields: Partial<AssistantTaskInput> = {},
) {
  const input: AssistantTaskInput = {
    ...assistantTaskSchema.parse({ demoMode: true }),
    owner: actor,
    taskId: `action_${runId}`,
    ...inputFields,
  };
  const events: TaskEvent[] = [
    {
      id: `initial_${runId}`,
      occurredAt: new Date().toISOString(),
      type: "status",
      status: "paused",
      title: "First real checkpoint",
      detail: "Fictional fixture",
      input,
      demoStage: input.demoMode ? "read" : undefined,
      demoGate: input.demoMode,
    },
    {
      id: `source_${runId}`,
      occurredAt: new Date().toISOString(),
      type: "source",
      title: "Read fictional sources",
      detail: "Fixture v2",
      sources: [
        {
          id: "synthetic-design-review",
          title: "Fictional meeting",
          version: "2",
        },
      ],
      demoStage: input.demoMode ? "prepare" : undefined,
    },
  ];
  records.set(runId, {
    runId,
    workflowName,
    attributes: actor ? assistantOwnerAttributes(actor) : {},
    status: "running",
    createdAt: new Date(),
    events,
  });
  return records.get(runId)!;
}
function context(runId: string) {
  return { params: Promise.resolve({ runId }) };
}
const parent = fixture("wrun_synthetic_restart_parent", alice);
const source = parent.events[1].id;
const body = { eventId: source, requestId: "restart-same-request" };
fixture("wrun_synthetic_restart_foreign", bob);
fixture("wrun_synthetic_restart_legacy");
for (const foreign of [
  "wrun_synthetic_restart_foreign",
  "wrun_synthetic_restart_legacy",
  "wrun_synthetic_restart_missing",
]) {
  const before = opened.length;
  assert.equal(
    (await restart.POST(request(alice, foreign, body), context(foreign)))
      .status,
    404,
  );
  assert.equal(
    opened.length,
    before,
    "Foreign/legacy/missing streams must not open",
  );
}
for (const options of [
  { service: true },
  { origin: "https://cross-site.example" },
])
  assert.equal(
    (
      await restart.POST(
        request(alice, parent.runId, body, options),
        context(parent.runId),
      )
    ).status,
    401,
  );
assert.equal(starts, 0);
assert.equal(
  (
    await restart.POST(
      request(alice, parent.runId, {
        ...body,
        restart: { phase: "deliver" },
        approved: true,
      }),
      context(parent.runId),
    )
  ).status,
  400,
);
assert.equal(
  (
    await restart.POST(
      request(alice, parent.runId, {
        ...body,
        eventId: "unknown-recorded-step",
      }),
      context(parent.runId),
    )
  ).status,
  404,
);
assert.equal(starts, 0);

const firstResponse = await restart.POST(
  request(alice, parent.runId, body),
  context(parent.runId),
);
assert.equal(firstResponse.status, 202);
assert.equal(firstResponse.headers.get("cache-control"), "no-store");
const first = await firstResponse.json();
assert.equal(first.parentStopped, true);
assert.equal(parent.status, "cancelled");
assert.equal(parent.events[1].id, source, "Old source history is preserved");
assert.ok(
  mutations.indexOf(`start:${first.runId}`) <
    mutations.indexOf(`cancel:${parent.runId}`),
);
const child = records.get(first.runId)!;
const childInput = child.events[0].input!;
assert.equal(childInput.owner?.id, alice.id);
assert.deepEqual(child.attributes, assistantOwnerAttributes(alice));
assert.notEqual(childInput.taskId, parent.events[0].input?.taskId);
assert.equal(childInput.demoMode, true);
assert.equal(childInput.restart?.phase, "prepare");
assert.equal(childInput.restart?.sourceRunId, parent.runId);
assert.equal(childInput.restart?.sourceEventId, source);
assert.equal(childInput.restart?.sourceVersion, 2);
assert.equal(childInput.approvalRequired, true);
const repeatsBefore = starts;
const repeat = await restart.POST(
  request(alice, parent.runId, body),
  context(parent.runId),
);
assert.equal(repeat.status, 202);
assert.equal((await repeat.json()).runId, first.runId);
assert.equal(
  starts,
  repeatsBefore,
  "Retry after old cancellation reuses the same child",
);
const reset = await restart.POST(
  request(alice, child.runId, {
    eventId: "beginning",
    requestId: body.requestId,
  }),
  context(child.runId),
);
assert.equal(reset.status, 202);
const resetId = (await reset.json()).runId;
assert.notEqual(
  resetId,
  first.runId,
  "A different parent binds a different request",
);
assert.equal(records.get(resetId)?.events[0].input?.restart?.phase, "read");

const bobParent = records.get("wrun_synthetic_restart_foreign")!;
const bobResponse = await restart.POST(
  request(bob, bobParent.runId, { ...body, eventId: bobParent.events[1].id }),
  context(bobParent.runId),
);
assert.equal(bobResponse.status, 202);
const bobChild = records.get((await bobResponse.json()).runId)!;
assert.notEqual(bobChild.events[0].input?.taskId, childInput.taskId);
assert.equal(bobChild.events[0].input?.owner?.id, bob.id);

const failingParent = fixture("wrun_synthetic_restart_stop_failure", alice);
const failingBody = {
  eventId: failingParent.events[1].id,
  requestId: "retry-after-cancel-failure",
};
failCancel = true;
const failedStopResponse = await restart.POST(
  request(alice, failingParent.runId, failingBody),
  context(failingParent.runId),
);
assert.equal(failedStopResponse.status, 202);
const failedStop = await failedStopResponse.json();
assert.equal(failedStop.parentStopped, false);
assert.match(failedStop.notice, /could not be stopped/);
assert.equal(failingParent.status, "running");
failCancel = false;
const stopRecovered = await restart.POST(
  request(alice, failingParent.runId, failingBody),
  context(failingParent.runId),
);
assert.equal(stopRecovered.status, 202);
assert.deepEqual(await stopRecovered.json(), {
  runId: failedStop.runId,
  parentStopped: true,
});

const startFailureParent = fixture(
  "wrun_synthetic_restart_start_failure",
  alice,
);
failStart = true;
assert.equal(
  (
    await restart.POST(
      request(alice, startFailureParent.runId, {
        eventId: "beginning",
        requestId: "failed-start-request",
      }),
      context(startFailureParent.runId),
    )
  ).status,
  503,
);
assert.equal(
  startFailureParent.status,
  "running",
  "A failed child start cannot cancel the original",
);
failStart = false;

for (const action of ["advance", "play"]) {
  const controlBody = {
    action,
    requestId: `service-${action}-request`,
    expectedCheckpointId: records.get(resetId)!.events[0].id,
  };
  const before = mutations.length;
  assert.equal(
    (
      await detail.POST(
        request(alice, resetId, controlBody, { service: true, path: "" }),
        context(resetId),
      )
    ).status,
    401,
  );
  assert.equal(mutations.length, before);
  assert.equal(
    (
      await detail.POST(
        request(alice, resetId, controlBody, { path: "" }),
        context(resetId),
      )
    ).status,
    202,
  );
}

const nextDay = Date.now() + 86400000;
const draft = {
  summary: "Synthetic private calendar hold",
  start: new Date(nextDay).toISOString(),
  end: new Date(nextDay + 1800000).toISOString(),
  timeZone: "America/Toronto",
};
const calendar = fixture("wrun_synthetic_restart_calendar", alice, {
  kind: "calendar_event",
  mode: "calendar",
  demoMode: false,
  eventDraft: draft,
});
const calendarResponse = await restart.POST(
  request(alice, calendar.runId, {
    eventId: "beginning",
    requestId: "calendar-restart-request",
  }),
  context(calendar.runId),
);
assert.equal(calendarResponse.status, 202);
const calendarResult = await calendarResponse.json();
assert.equal(calendarResult.parentStopped, false);
assert.match(calendarResult.notice, /original live run is still active/i);
assert.equal(calendar.status, "running");
const calendarInput = records.get(calendarResult.runId)!.events[0].input!;
assert.equal(
  calendarInput.restart?.calendarWriteActionId,
  calendar.events[0].input?.taskId,
);
assert.equal(calendarInput.restart?.phase, "calendar_review");
assert.equal(calendarInput.approvalRequired, true);
assert.deepEqual(calendarInput.eventDraft, draft);

const publicResponse = await tasks.POST(
  new Request("http://localhost:3000/api/assistant/tasks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceTokens.get(alice.id)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      restart: { phase: "deliver", calendarWriteActionId: "forged-action" },
      owner: bob,
      manualStart: true,
    }),
  }),
);
assert.equal(publicResponse.status, 202);
const publicInput = records.get((await publicResponse.json()).runId)!.events[0]
  .input!;
assert.equal(
  publicInput.restart,
  undefined,
  "Public JSON must not inject trusted restart state",
);
assert.equal(publicInput.owner?.id, alice.id);
const guidedResponse = await tasks.POST(
  new Request("http://localhost:3000/api/assistant/tasks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceTokens.get(alice.id)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      demoMode: true,
      manualStart: true,
      delaySeconds: 3600,
      approvalRequired: false,
    }),
  }),
);
assert.equal(guidedResponse.status, 202);
const guidedInput = records.get((await guidedResponse.json()).runId)!.events[0]
  .input!;
assert.equal(guidedInput.manualStart, false);
assert.equal(guidedInput.delaySeconds, 0);
assert.equal(guidedInput.approvalRequired, true);

for (const record of records.values()) record.status = "completed";
const capped = fixture("wrun_synthetic_restart_cap_parent", alice);
for (let index = 0; index < 19; index++)
  fixture(`wrun_synthetic_restart_cap_${index}`, alice);
const beforeCap = starts;
assert.equal(
  (
    await restart.POST(
      request(alice, capped.runId, {
        eventId: "beginning",
        requestId: "capped-restart-request",
      }),
      context(capped.runId),
    )
  ).status,
  429,
);
assert.equal(starts, beforeCap);
assert.equal(capped.status, "running");
console.log(
  JSON.stringify({
    auth: "cookie-owner-only",
    unowned: "denied-before-stream",
    idempotency: "parent-event-actor-bound",
    rehearsal: "replace-then-stop",
    stopFailure: "recoverable",
    calendar: "fresh-review-same-write-identity",
    caps: "enforced",
    guidedControls: "browser-only",
    publicSnapshot: "ignored",
  }),
);
