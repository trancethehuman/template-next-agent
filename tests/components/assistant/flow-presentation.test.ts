import { describe, expect, test } from "bun:test";
import { projectTaskFlow } from "../../../lib/assistant/flow-presentation";
import type { AssistantTask, TaskEvent } from "../../../lib/assistant/types";

const started = "2026-10-30T10:00:00.000Z";
const at = (seconds: number) =>
  new Date(Date.parse(started) + seconds * 1000).toISOString();

function event(
  id: string,
  seconds: number,
  type: TaskEvent["type"],
  fields: Partial<TaskEvent> = {},
): TaskEvent {
  return {
    id,
    type,
    occurredAt: at(seconds),
    title: "Original checkpoint title",
    detail: "Full recorded checkpoint detail",
    ...fields,
  };
}

function task(
  events: TaskEvent[],
  fields: Partial<AssistantTask> = {},
): AssistantTask {
  return {
    runId: "wrun_synthetic_flow",
    title: "Fictional meeting preparation",
    prompt: "Synthetic teaching request",
    mode: "rehearsal",
    kind: "meeting_prep",
    status: "running",
    workflowStatus: "running",
    createdAt: started,
    updatedAt: at(100),
    events,
    notificationCount: 0,
    sourceVersion: 1,
    preference: { bulletCount: 3, includeLinks: true },
    allowedActions: [],
    ...fields,
  };
}

describe("observed workflow flow presentation", () => {
  test("an actual approval wait shows its executed history and no invented delivery or future completion", () => {
    const events = [
      event("queued", 0, "status", { status: "queued" }),
      event("working", 1, "status", { status: "running" }),
      event("source", 3, "source", {
        sources: [
          { id: "fictional-meeting", title: "Synthetic meeting", version: "1" },
        ],
      }),
      event("brief", 5, "brief", {
        content: "Synthetic brief",
        detail: "Complete original brief evidence",
      }),
      event("approval", 6, "status", { status: "awaiting_approval" }),
    ];
    const flow = projectTaskFlow(
      task(events, { status: "awaiting_approval" }),
      { now: Date.parse(at(10)) },
    );
    expect(flow.steps.map((step) => step.id)).toEqual(
      events.map((row) => row.id),
    );
    expect(flow.steps.map((step) => step.state)).toEqual([
      "recorded",
      "recorded",
      "recorded",
      "recorded",
      "waiting",
    ]);
    expect(flow.currentStepId).toBe("approval");
    expect(flow.summary).toBe("Waiting for approval");
    expect(flow.steps.at(-1)?.activeElapsedMs).toBe(4000);
    expect(flow.steps[3].event).toBe(events[3]);
    expect(flow.steps[3].event?.detail).toBe(
      "Complete original brief evidence",
    );
    expect(flow.notificationCount).toBe(0);
    expect(
      flow.steps.some(
        (step) => step.kind === "delivery" || step.kind === "terminal",
      ),
    ).toBe(false);
  });

  test("replay cannot duplicate steps, notifications, or deduplication decisions; the first confirmed timestamp wins", () => {
    const delivered = event("delivered", 3, "notification");
    const deduplicated = event("no-change", 4, "deduplicated");
    const flow = projectTaskFlow(
      task([
        event("working", 1, "status", { status: "running" }),
        delivered,
        { ...delivered, occurredAt: at(30), detail: "Later retry frame" },
        deduplicated,
        { ...deduplicated, occurredAt: at(40) },
      ]),
    );
    expect(flow.steps.map((step) => step.id)).toEqual([
      "working",
      "delivered",
      "no-change",
    ]);
    expect(flow.notificationCount).toBe(1);
    expect(flow.deduplicatedCount).toBe(1);
    expect(flow.steps[1].occurredAt).toBe(at(3));
    expect(flow.steps[1].event).toBe(delivered);
    expect(flow.steps[1].elapsedFromPreviousMs).toBe(2000);
    expect(flow.steps[2].label).toBe("No new update");
  });

  test("source changes compare real versions per source, including opaque live hashes and unchanged rereads", () => {
    const read = (id: string, seconds: number, version: string) =>
      event(id, seconds, "source", {
        sources: [
          { id: "meeting", title: "Fictional meeting", version },
          { id: "notes", title: "Fictional notes", version: "notes-v1" },
        ],
      });
    const flow = projectTaskFlow(
      task(
        [
          read("first", 1, "hash-a"),
          read("replay", 2, "hash-a"),
          read("changed", 3, "hash-b"),
        ],
        { sourceVersion: 2 },
      ),
    );
    expect(flow.steps[0].sourceChanges[0]).toEqual({
      id: "meeting",
      version: "hash-a",
      previousVersion: undefined,
      changed: false,
    });
    expect(flow.steps[1].sourceChanges[0]).toEqual({
      id: "meeting",
      version: "hash-a",
      previousVersion: "hash-a",
      changed: false,
    });
    expect(flow.steps[2].sourceChanges[0]).toEqual({
      id: "meeting",
      version: "hash-b",
      previousVersion: "hash-a",
      changed: true,
    });
    expect(
      flow.steps.every((step) => step.sourceChanges[1].changed === false),
    ).toBe(true);
    expect(flow.notificationCount).toBe(0);
  });

  test("only the current paused checkpoint has a live age; earlier waits remain historical records", () => {
    const flow = projectTaskFlow(
      task(
        [
          event("trigger", 2, "status", { status: "sleeping" }),
          event("pause", 5, "status", { status: "paused" }),
        ],
        { status: "paused" },
      ),
      { now: Date.parse(at(12)) },
    );
    expect(flow.steps[0].state).toBe("recorded");
    expect(flow.steps[0].activeElapsedMs).toBeUndefined();
    expect(flow.steps[1].state).toBe("paused");
    expect(flow.steps[1].activeElapsedMs).toBe(7000);
    expect(flow.summary).toBe("Paused");
  });

  test("structured denial and legacy brief denial stay distinct from delivered or created outcomes", () => {
    for (const denied of [
      event("denied", 3, "approval", {
        calendarDecision: "denied",
        title: "A future wording change",
      }),
      event("legacy-denied", 3, "approval", { title: "Delivery declined" }),
    ]) {
      const flow = projectTaskFlow(
        task(
          [
            event("approval", 1, "status", { status: "awaiting_approval" }),
            denied,
            event("finished", 4, "status", { status: "completed" }),
          ],
          { status: "completed", updatedAt: at(4) },
        ),
      );
      expect(flow.summary).toBe("Declined");
      expect(flow.steps[1].state).toBe("denied");
      expect(flow.steps[1].label).toBe("Declined");
      expect(flow.steps[2].state).toBe("recorded");
      expect(flow.notificationCount).toBe(0);
      expect(flow.steps.some((step) => step.kind === "delivery")).toBe(false);
    }
  });

  test("an unknown decision marker is not interpreted as approval", () => {
    const flow = projectTaskFlow(
      task([
        event("unknown", 1, "approval", {
          title: "Decision data from an older version",
        }),
      ]),
    );
    expect(flow.steps[0].label).toBe("Decision recorded");
    expect(flow.steps[0].state).toBe("recorded");
  });

  test("an accepted approval resolves the old wait without predicting provider success", () => {
    const flow = projectTaskFlow(
      task(
        [
          event("approval", 1, "status", { status: "awaiting_approval" }),
          event("approved", 2, "approval", { calendarDecision: "approved" }),
        ],
        { kind: "calendar_event", status: "awaiting_approval" },
      ),
    );
    expect(flow.steps[0].state).toBe("recorded");
    expect(flow.steps[1].state).toBe("recorded");
    expect(flow.summary).toBe("Approved");
    expect(
      flow.steps.some(
        (step) => step.kind === "result" || step.kind === "terminal",
      ),
    ).toBe(false);
  });

  test("canonical cancellation absent from the stream is labeled as run state, not an invented workflow event", () => {
    const flow = projectTaskFlow(
      task([event("queued", 1, "status", { status: "queued" })], {
        status: "cancelled",
        updatedAt: at(8),
      }),
      { now: Date.parse(at(100)) },
    );
    expect(flow.steps[0].state).toBe("recorded");
    expect(flow.steps[1]).toMatchObject({
      id: "run-status:wrun_synthetic_flow:cancelled",
      origin: "run-status",
      state: "stopped",
      label: "Stopped",
      occurredAt: at(8),
    });
    expect(flow.steps[1].event).toBeUndefined();
    expect(flow.steps[1].eventId).toBeUndefined();
    expect(flow.elapsedMs).toBe(8000);
    expect(flow.summary).toBe("Stopped");
  });

  test("recorded stop/failure checkpoints are not duplicated by canonical terminal state", () => {
    for (const status of ["cancelled", "failed"] as const) {
      const recorded = event(
        "terminal",
        3,
        status === "failed" ? "error" : "status",
        { status },
      );
      const flow = projectTaskFlow(
        task([recorded], { status, updatedAt: at(3) }),
      );
      expect(flow.steps).toHaveLength(1);
      expect(flow.steps[0].origin).toBe("event");
      expect(flow.steps[0].state).toBe(
        status === "failed" ? "failed" : "stopped",
      );
    }
  });

  test("provider failure preserves its uncertainty details without implying a completed write", () => {
    const failed = event("failed", 4, "error", {
      status: "failed",
      detail:
        "The request may have reached Google; inspect the calendar before replacing it.",
    });
    const flow = projectTaskFlow(
      task(
        [
          event("approved", 1, "approval", { calendarDecision: "approved" }),
          event("creating", 2, "status", { status: "running" }),
          failed,
        ],
        { kind: "calendar_event", status: "failed", updatedAt: at(4) },
      ),
    );
    expect(flow.summary).toBe("Failed");
    expect(flow.steps.at(-1)?.event?.detail).toContain(
      "may have reached Google",
    );
    expect(flow.steps.some((step) => step.label === "Event created")).toBe(
      false,
    );
    expect(flow.steps.some((step) => step.state === "active")).toBe(false);
  });

  test("only a provider result can display event confirmation while the final workflow checkpoint is pending", () => {
    const confirmed = event("result", 4, "calendar_event", {
      calendarEvent: {
        id: "synthetic-event",
        title: "Fictional event",
        start: at(3600),
        end: at(5400),
        allDay: false,
        managed: true,
        reused: true,
      },
    });
    const flow = projectTaskFlow(
      task([event("creating", 1, "status", { status: "running" }), confirmed], {
        kind: "calendar_event",
      }),
    );
    expect(flow.summary).toBe("Event confirmed");
    expect(flow.steps.at(-1)?.label).toBe("Event confirmed");
    expect(flow.steps.some((step) => step.kind === "terminal")).toBe(false);
  });

  test("checkpoint intervals include waits, retain stream order under clock skew, and do not emit NaN for invalid timestamps", () => {
    const flow = projectTaskFlow(
      task(
        [
          event("later-clock", 10, "status", { status: "running" }),
          event("earlier-clock", 8, "source"),
          event("invalid", 9, "brief", { occurredAt: "not-a-timestamp" }),
          event("valid-again", 12, "status", { status: "sleeping" }),
        ],
        { status: "sleeping", createdAt: "invalid-created-at" },
      ),
      { now: Number.NaN },
    );
    expect(flow.steps.map((step) => step.id)).toEqual([
      "later-clock",
      "earlier-clock",
      "invalid",
      "valid-again",
    ]);
    expect(flow.steps[1].elapsedFromPreviousMs).toBe(0);
    expect(flow.steps[2].occurredAt).toBeUndefined();
    expect(flow.steps[2].event?.occurredAt).toBe("not-a-timestamp");
    expect(flow.steps[2].elapsedFromPreviousMs).toBeUndefined();
    expect(flow.steps[3].elapsedFromPreviousMs).toBeUndefined();
    expect(flow.steps[3].activeElapsedMs).toBeUndefined();
    expect(flow.elapsedMs).toBeUndefined();
  });

  test("empty active history creates no placeholder future steps and completed elapsed time stops at its recorded finish", () => {
    expect(projectTaskFlow(task([])).steps).toEqual([]);
    expect(projectTaskFlow(task([])).currentStepId).toBeUndefined();
    const flow = projectTaskFlow(
      task(
        [
          event("waiting", 1, "status", { status: "sleeping" }),
          event("finished", 61, "status", { status: "completed" }),
        ],
        { status: "completed", updatedAt: at(61) },
      ),
      { now: Date.parse(at(3600)) },
    );
    expect(flow.elapsedMs).toBe(61000);
    expect(flow.steps[1].elapsedFromPreviousMs).toBe(60000);
    expect(flow.steps.every((step) => step.activeElapsedMs === undefined)).toBe(
      true,
    );
  });
});
