import { describe, expect, test } from "bun:test";
import {
  planAssistantTaskRestart,
  taskRestartSchema,
} from "../../lib/assistant/restart-plan";
import {
  assistantTaskSchema,
  projectAssistantTask,
} from "../../lib/assistant/task-policy";
import type { AssistantActor } from "../../lib/auth/actor";
import type {
  AssistantTask,
  AssistantTaskInput,
  TaskEvent,
  TaskSource,
} from "../../lib/assistant/types";

const actor: AssistantActor = {
  id: "google:synthetic-restart-owner",
  email: "restart@agiventures.ca",
};
const sources = (version: 1 | 2): TaskSource[] => [
  {
    id: "synthetic-design-review",
    title: "Fictional meeting",
    version: String(version),
  },
];
function event(
  id: string,
  type: TaskEvent["type"],
  fields: Partial<TaskEvent> = {},
): TaskEvent {
  return {
    id,
    type,
    title: id,
    detail: "Fictional restart checkpoint",
    occurredAt: "2026-10-30T12:00:00Z",
    ...fields,
  };
}
function fixture(
  extra: TaskEvent[] = [],
  inputFields: Partial<AssistantTaskInput> = {},
  status = "running",
): AssistantTask {
  const input: AssistantTaskInput = {
    ...assistantTaskSchema.parse({}),
    owner: actor,
    taskId: "synthetic-original-action",
    ...inputFields,
  };
  return projectAssistantTask(
    {
      runId: "wrun_synthetic_restart_parent",
      status,
      createdAt: new Date("2026-10-30T12:00:00Z"),
    },
    [event("initial", "status", { status: "running", input }), ...extra],
  );
}

describe("recorded checkpoint restart plans", () => {
  test("legacy source, brief and comparison rows rerun their operation instead of skipping past it", () => {
    const task = fixture([
      event("source", "source", { sources: sources(2) }),
      event("brief", "brief", {
        content: "Selected output must be regenerated",
        sources: sources(2),
      }),
      event("delivery", "notification", { sources: sources(2) }),
      event("same-source", "deduplicated"),
      event("failure", "error", { status: "failed" }),
    ]);
    expect(planAssistantTaskRestart(actor, task, "source").restart.phase).toBe(
      "read",
    );
    const prepare = planAssistantTaskRestart(actor, task, "brief");
    expect(prepare.restart).toMatchObject({
      phase: "prepare",
      sourceVersion: 2,
    });
    expect(prepare.restart.prepared).toBeUndefined();
    expect(
      planAssistantTaskRestart(actor, task, "same-source").restart,
    ).toMatchObject({
      phase: "read",
      previousKey: "synthetic-design-review:2",
    });
    expect(planAssistantTaskRestart(actor, task, "failure").restart.phase).toBe(
      "read",
    );
  });

  test("the initial restoration row retains its trusted entry phase while resetting beginning still reruns read", () => {
    const task = fixture([], {
      demoMode: true,
      sourceVersion: 2,
      restart: {
        version: 1,
        sourceRunId: "wrun_synthetic_ancestor",
        sourceEventId: "ancestor-brief",
        sourceTitle: "Prepare",
        phase: "prepare",
        sourceVersion: 2,
        previousKey: "",
        prepared: {
          content: "Earlier context",
          sources: sources(1),
          key: "synthetic-design-review:1",
        },
      },
    });
    task.events[0].type = "restart";
    expect(planAssistantTaskRestart(actor, task, "initial").restart.phase).toBe(
      "prepare",
    );
    expect(
      planAssistantTaskRestart(actor, task, "beginning").restart.phase,
    ).toBe("read");
  });

  test("a changed source reruns its read with that version, preserving only earlier delivered state", () => {
    const task = fixture([
      event("source-v1", "source", { sources: sources(1) }),
      event("brief-v1", "brief", {
        content: "First fictional brief",
        sources: sources(1),
      }),
      event("delivered-v1", "notification", {
        content: "First fictional brief",
        sources: sources(1),
      }),
      event("source-v2", "source", { sources: sources(2) }),
      event("future-v2", "brief", {
        content: "Future brief must not travel backwards",
        sources: sources(2),
      }),
    ]);
    const before = JSON.stringify(task);
    const plan = planAssistantTaskRestart(actor, task, "source-v2");
    expect(plan.restart).toMatchObject({
      phase: "read",
      sourceVersion: 2,
      previousKey: "synthetic-design-review:1",
      sourceRunId: task.runId,
      sourceEventId: "source-v2",
      prepared: { content: "First fictional brief" },
    });
    expect(plan.input).toMatchObject({
      demoMode: true,
      manualStart: false,
      delaySeconds: 0,
      approvalRequired: true,
      sourceVersion: 2,
      maxChecks: 3,
    });
    expect(JSON.stringify(plan)).not.toContain(
      "Future brief must not travel backwards",
    );
    expect(JSON.stringify(task)).toBe(before);
  });

  test("restarting a delivered brief requires fresh review and never counts the selected delivery as previous", () => {
    const plan = planAssistantTaskRestart(
      actor,
      fixture([
        event("brief", "brief", {
          content: "Exact saved fictional brief",
          sources: sources(1),
        }),
        event("approved", "approval", { calendarDecision: "approved" }),
        event("delivery", "notification", {
          content: "Exact saved fictional brief",
          sources: sources(1),
        }),
      ]),
      "delivery",
    );
    expect(plan.restart.phase).toBe("review");
    expect(plan.restart.previousKey).toBe("");
    expect(plan.restart.prepared?.content).toBe("Exact saved fictional brief");
    expect("calendarDecision" in plan.restart).toBe(false);
    expect(plan.input.approvalRequired).toBe(true);
  });

  test("recorded guided stage markers take priority over legacy labels and watch restores only a delivered baseline", () => {
    const plan = planAssistantTaskRestart(
      actor,
      fixture([
        event("delivery", "notification", { sources: sources(2) }),
        event("watch-gate", "status", {
          status: "paused",
          demoStage: "watch",
          demoGate: true,
        }),
      ]),
      "watch-gate",
    );
    expect(plan.restart).toMatchObject({
      phase: "watch",
      sourceVersion: 2,
      previousKey: "synthetic-design-review:2",
    });
    const prepare = planAssistantTaskRestart(
      actor,
      fixture([
        event("gate", "status", {
          status: "paused",
          demoStage: "prepare",
          demoGate: true,
        }),
      ]),
      "gate",
    );
    expect(prepare.restart.phase).toBe("prepare");
  });

  test("resetting a fork starts from read, without retaining its selected stage, prior delivery or restored brief", () => {
    const task = fixture(
      [
        event("delivery", "notification", { sources: sources(2) }),
        event("prepare-gate", "status", {
          status: "paused",
          demoStage: "prepare",
          demoGate: true,
        }),
      ],
      {
        demoMode: true,
        restart: {
          version: 1,
          sourceRunId: "wrun_synthetic_ancestor",
          sourceEventId: "ancestor-step",
          sourceTitle: "Preparation",
          phase: "prepare",
          sourceVersion: 2,
          previousKey: "synthetic-design-review:1",
          prepared: {
            content: "Previously restored brief",
            sources: sources(1),
            key: "synthetic-design-review:1",
          },
        },
      },
    );
    task.events[0].demoStage = "prepare";
    const plan = planAssistantTaskRestart(actor, task, "beginning");
    expect(plan.restart).toMatchObject({
      phase: "read",
      sourceEventId: "initial",
      previousKey: "",
    });
    expect(plan.restart.prepared).toBeUndefined();
  });

  test("a second restart can review the trusted restored brief without pretending it was regenerated", () => {
    const prepared = {
      content: "Exact restored brief",
      sources: sources(1),
      key: "synthetic-design-review:1",
    };
    const task = fixture(
      [
        event("review-gate", "status", {
          status: "awaiting_approval",
          demoStage: "review",
        }),
      ],
      {
        demoMode: true,
        restart: {
          version: 1,
          sourceRunId: "wrun_synthetic_ancestor",
          sourceEventId: "ancestor-review",
          sourceTitle: "Review",
          phase: "review",
          sourceVersion: 1,
          previousKey: "",
          prepared,
        },
      },
    );
    task.events[0].type = "restart";
    task.events[0].content = prepared.content;
    task.events[0].sources = prepared.sources;
    const plan = planAssistantTaskRestart(actor, task, "review-gate");
    expect(plan.restart.phase).toBe("review");
    expect(plan.restart.prepared).toEqual(prepared);
    expect(plan.input.approvalRequired).toBe(true);
  });

  test("an older brief displayed on a restored prepare checkpoint cannot roll its newer source version backwards", () => {
    const task = fixture(
      [
        event("prepare-gate", "status", {
          status: "paused",
          demoStage: "prepare",
          demoGate: true,
        }),
      ],
      {
        demoMode: true,
        sourceVersion: 2,
        restart: {
          version: 1,
          sourceRunId: "wrun_synthetic_ancestor",
          sourceEventId: "source-v2",
          sourceTitle: "Updated source",
          phase: "prepare",
          sourceVersion: 2,
          previousKey: "synthetic-design-review:1",
          prepared: {
            content: "Old baseline",
            sources: sources(1),
            key: "synthetic-design-review:1",
          },
        },
      },
    );
    task.events[0].type = "restart";
    task.events[0].sources = sources(1);
    expect(
      planAssistantTaskRestart(actor, task, "prepare-gate").restart,
    ).toMatchObject({ phase: "prepare", sourceVersion: 2 });
  });

  test("a restarted watch preserves the trusted delivered baseline through another restart, while beginning clears it", () => {
    const task = fixture(
      [
        event("watch-gate", "status", {
          status: "paused",
          demoStage: "watch",
          demoGate: true,
        }),
      ],
      {
        demoMode: true,
        restart: {
          version: 1,
          sourceRunId: "wrun_synthetic_ancestor",
          sourceEventId: "ancestor-watch",
          sourceTitle: "Watch",
          phase: "watch",
          sourceVersion: 1,
          previousKey: "synthetic-design-review:1",
        },
      },
    );
    expect(
      planAssistantTaskRestart(actor, task, "watch-gate").restart.previousKey,
    ).toBe("synthetic-design-review:1");
    expect(
      planAssistantTaskRestart(actor, task, "beginning").restart.previousKey,
    ).toBe("");
  });

  test("legacy live review without the full source key rereads fresh context and retains the old brief only as historical context", () => {
    const liveSources = [
      {
        id: "synthetic-live-meeting",
        title: "Fictional live event",
        version: "012345abcdef",
      },
    ];
    const task = fixture(
      [
        event("source", "source", { sources: liveSources }),
        event("brief", "brief", {
          sources: liveSources,
          content: "Recorded live fixture brief",
        }),
        event("review-gate", "status", { status: "awaiting_approval" }),
        event("delivery", "notification", { sources: liveSources }),
        event("watch", "status", { status: "sleeping" }),
      ],
      { mode: "calendar" },
    );
    const read = planAssistantTaskRestart(actor, task, "watch");
    expect(read.restart).toMatchObject({ phase: "read", previousKey: "" });
    expect(read.input).toMatchObject({
      demoMode: false,
      calendarEventId: "synthetic-live-meeting",
    });
    expect(planAssistantTaskRestart(actor, task, "brief").restart.phase).toBe(
      "read",
    );
    const review = planAssistantTaskRestart(actor, task, "review-gate");
    expect(review.restart).toMatchObject({
      phase: "read",
      prepared: { content: "Recorded live fixture brief", key: "" },
    });
    expect(review.input.approvalRequired).toBe(true);
  });

  test("a live review restores its recorded full source key and retains that key across another fork", () => {
    const key = "abcdef0123456789".repeat(4);
    const liveSources = [
      {
        id: "synthetic-live-meeting",
        title: "Fictional live event",
        version: key.slice(0, 12),
      },
    ];
    const task = fixture(
      [
        event("brief", "brief", {
          content: "Exact saved live brief",
          sources: liveSources,
          sourceKey: key,
        }),
        event("review", "status", { status: "awaiting_approval" }),
      ],
      { mode: "calendar" },
    );
    const plan = planAssistantTaskRestart(actor, task, "review");
    expect(plan.restart).toMatchObject({
      phase: "review",
      prepared: { content: "Exact saved live brief", key },
    });
    expect(plan.input.approvalRequired).toBe(true);
    const fork = fixture(
      [event("review-again", "status", { status: "awaiting_approval" })],
      { ...plan.input, restart: plan.restart },
    );
    fork.events[0].type = "restart";
    expect(
      planAssistantTaskRestart(actor, fork, "review-again").restart,
    ).toMatchObject({ phase: "review", prepared: { key } });
  });

  test("truncated, malformed or older unrelated keys cannot authorize restored live review", () => {
    for (const sourceKey of [
      undefined,
      "abcdef012345",
      "x".repeat(64),
      "a".repeat(63),
    ]) {
      const task = fixture(
        [
          event("source", "source", {
            sources: sources(2),
            sourceKey: "b".repeat(64),
          }),
          event("new-brief", "brief", {
            content: "Newer brief without a valid linked key",
            sources: sources(2),
            sourceKey,
          }),
          event("review", "status", { status: "awaiting_approval" }),
        ],
        {
          mode: "calendar",
          restart: {
            version: 1,
            sourceRunId: "wrun_synthetic_ancestor",
            sourceEventId: "ancestor-review",
            sourceTitle: "Review",
            phase: "review",
            sourceVersion: 1,
            previousKey: "",
            prepared: {
              content: "Older saved brief",
              sources: sources(1),
              key: "a".repeat(64),
            },
          },
        },
      );
      const plan = planAssistantTaskRestart(actor, task, "review");
      expect(plan.restart).toMatchObject({
        phase: "read",
        prepared: {
          content: "Newer brief without a valid linked key",
          key: "",
        },
      });
    }
  });

  test("a review without its saved brief falls back to a real read rather than inventing content", () => {
    const plan = planAssistantTaskRestart(
      actor,
      fixture([event("review", "status", { status: "awaiting_approval" })]),
      "review",
    );
    expect(plan.restart.phase).toBe("read");
    expect(plan.restart.prepared).toBeUndefined();
  });

  test("calendar restarts retain the immutable draft and original write identity across multiple generations", () => {
    const start = Date.now() + 86400000;
    const eventDraft = {
      summary: "Synthetic private event",
      description: "An exact fictional draft",
      start: new Date(start).toISOString(),
      end: new Date(start + 1800000).toISOString(),
      timeZone: "America/Toronto",
    };
    const task = fixture([event("created", "calendar_event")], {
      mode: "calendar",
      kind: "calendar_event",
      eventDraft,
    });
    const first = planAssistantTaskRestart(actor, task, "created");
    expect(first.restart).toMatchObject({
      phase: "calendar_review",
      calendarWriteActionId: "synthetic-original-action",
    });
    expect(first.input.eventDraft).toEqual(eventDraft);
    expect(first.input).toMatchObject({
      approvalRequired: true,
      demoMode: false,
    });
    const fork = fixture(
      [event("review", "status", { status: "awaiting_approval" })],
      {
        ...first.input,
        taskId: "synthetic-fork-identity",
        restart: first.restart,
      },
    );
    expect(
      planAssistantTaskRestart(actor, fork, "review").restart
        .calendarWriteActionId,
    ).toBe("synthetic-original-action");
  });

  test("a calendar draft that is now in the past cannot be made writable by restarting", () => {
    const task = fixture([], {
      mode: "calendar",
      kind: "calendar_event",
      eventDraft: {
        summary: "Synthetic expired event",
        start: "2020-01-01T10:00:00Z",
        end: "2020-01-01T10:30:00Z",
        timeZone: "UTC",
      },
    });
    expect(() => planAssistantTaskRestart(actor, task, "initial")).toThrow(
      "future start and end times",
    );
  });

  test("the canonical stopped row is restartable, while arbitrary or stale status identifiers are rejected", () => {
    const task = fixture([], {}, "cancelled");
    expect(
      planAssistantTaskRestart(
        actor,
        task,
        `run-status:${task.runId}:cancelled`,
      ).restart.phase,
    ).toBe("read");
    for (const id of [
      "not-recorded",
      "beginning:forged",
      `run-status:${task.runId}:completed`,
    ])
      expect(() => planAssistantTaskRestart(actor, task, id)).toThrow(
        "Recorded step not found",
      );
  });

  test("canonical stopped or failed rows restart the last real guided operation and preserve the canonical lineage", () => {
    for (const status of ["cancelled", "failed"]) {
      const task = fixture(
        [
          event("source", "source", { sources: sources(2), demoStage: "read" }),
          event("ready-prepare", "status", {
            status: "paused",
            demoStage: "prepare",
            demoGate: true,
          }),
        ],
        { demoMode: true },
        status,
      );
      const eventId = `run-status:${task.runId}:${status}`;
      const plan = planAssistantTaskRestart(actor, task, eventId);
      expect(plan.restart).toMatchObject({
        phase: "prepare",
        sourceEventId: eventId,
        sourceVersion: 2,
      });
    }
    const completed = fixture(
      [
        event("ready-prepare", "status", {
          status: "paused",
          demoStage: "prepare",
          demoGate: true,
        }),
      ],
      { demoMode: true },
      "completed",
    );
    expect(
      planAssistantTaskRestart(
        actor,
        completed,
        `run-status:${completed.runId}:completed`,
      ).restart.phase,
    ).toBe("complete");
  });

  test("legacy unowned inputs and body-supplied approval, identity, or state cannot produce restart plans", () => {
    const task = fixture();
    delete task.events[0].input!.owner;
    expect(() => planAssistantTaskRestart(actor, task, "initial")).toThrow(
      "owned restart checkpoint",
    );
    const request = {
      eventId: "initial",
      requestId: "synthetic-restart-request",
    };
    for (const forged of [
      { owner: actor },
      { restart: { phase: "deliver" } },
      { prepared: { content: "Forged" } },
      { approved: true },
      { calendarWriteActionId: "foreign-write" },
    ])
      expect(
        taskRestartSchema.safeParse({ ...request, ...forged }).success,
      ).toBe(false);
    expect(
      taskRestartSchema.safeParse({ ...request, eventId: "x".repeat(201) })
        .success,
    ).toBe(false);
    expect(
      taskRestartSchema.safeParse({ ...request, requestId: "short" }).success,
    ).toBe(false);
  });
});

test("restart routes enforce browser ownership, preserve idempotency, caps and history, and recover after stop failure", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/assistant-restart.ts"],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0)
    throw new Error(new TextDecoder().decode(result.stderr));
  expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({
    auth: "cookie-owner-only",
    unowned: "denied-before-stream",
    idempotency: "parent-event-actor-bound",
    rehearsal: "replace-then-stop",
    stopFailure: "recoverable",
    calendar: "fresh-review-same-write-identity",
    caps: "enforced",
    guidedControls: "browser-only",
    publicSnapshot: "ignored",
  });
});
