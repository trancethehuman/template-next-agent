import { describe, expect, test } from "bun:test";
import { projectTaskFlow } from "../../../lib/assistant/flow-presentation";
import {
  playTargets,
  previewStageMap,
  projectStageMap,
} from "../../../lib/assistant/stage-map";
import {
  projectAssistantTask,
  taskActionSchema,
} from "../../../lib/assistant/task-policy";
import type {
  AssistantTaskInput,
  TaskEvent,
} from "../../../lib/assistant/types";

const started = Date.parse("2026-10-30T10:00:00.000Z");
let clock = 0;

const input: AssistantTaskInput = {
  taskId: "synthetic-stage-map",
  title: "Synthetic stage map",
  prompt: "Fictional teaching run",
  mode: "rehearsal",
  kind: "meeting_prep",
  demoMode: true,
  delaySeconds: 0,
  manualStart: false,
  approvalRequired: true,
  sourceVersion: 1,
  maxChecks: 3,
  preference: { bulletCount: 3, includeLinks: true },
};

function event(id: string, fields: Partial<TaskEvent>): TaskEvent {
  clock += 1;
  return {
    id,
    type: "status",
    occurredAt: new Date(started + clock * 1000).toISOString(),
    title: id,
    detail: "Synthetic checkpoint",
    ...fields,
  };
}

const sources = (version: string) => [
  { id: "synthetic-design-review", title: "Product design review", version },
  { id: "synthetic-project-notes", title: "Fictional project notes", version: "1" },
];

function gate(id: string, stage: TaskEvent["demoStage"], playback: "step" | "play" = "step") {
  return event(id, {
    status: playback === "play" ? "running" : "paused",
    demoStage: stage,
    demoGate: true,
    demoPlayback: playback,
  });
}

function execute(id: string, stage: TaskEvent["demoStage"]) {
  return event(id, { status: "running", demoStage: stage, demoGate: false });
}

function opening() {
  clock = 0;
  return [event("ready", { status: "running", input })];
}

function firstPassToReview() {
  return [
    ...opening(),
    gate("gate-read", "read"),
    execute("run-read", "read"),
    event("read-1", { type: "source", demoStage: "read", sources: sources("1") }),
    gate("gate-prepare", "prepare"),
    execute("run-prepare", "prepare"),
    event("brief-1", { type: "brief", demoStage: "prepare", content: "- Synthetic brief" }),
    gate("gate-review", "review"),
    execute("run-review", "review"),
    event("await-1", { status: "awaiting_approval", demoStage: "review" }),
  ];
}

function deliveredAndWatching() {
  return [
    ...firstPassToReview(),
    event("approve-1", { type: "approval", title: "Delivery approved", demoStage: "review" }),
    gate("gate-deliver", "deliver"),
    execute("run-deliver", "deliver"),
    event("deliver-1", { type: "notification", demoStage: "deliver", sources: sources("1"), content: "- Synthetic brief" }),
    gate("gate-watch", "watch"),
    execute("run-watch", "watch"),
    event("sleep-1", { status: "sleeping", demoStage: "watch" }),
  ];
}

function view(events: TaskEvent[], status = "running") {
  const task = projectAssistantTask(
    {
      runId: "wrun_synthetic_stage_map",
      status,
      createdAt: new Date(started),
      ...(["completed", "cancelled", "failed"].includes(status)
        ? { completedAt: new Date(started + (clock + 1) * 1000) }
        : {}),
    },
    events,
  );
  const map = projectStageMap(task, projectTaskFlow(task, { now: started + 60_000 }));
  const stage = (id: string) => map.stages.find((item) => item.id === id)!;
  return { task, map, stage };
}

describe("agent loop stage map", () => {
  test("before a run, every stage is unreached and says what it will do", () => {
    const map = previewStageMap("meeting_prep");
    expect(map.stages.map((item) => item.label)).toEqual([
      "Start", "Read", "Prepare", "Review", "Deliver", "Watch", "Finish",
    ]);
    for (const item of map.stages) {
      expect(item.state).toBe("upcoming");
      expect(item.fact).toBeUndefined();
      expect(item.summary.length).toBeGreaterThan(0);
    }
  });

  test("play can stop only at stages ahead of the gate, up to the next owner stop", () => {
    const first = view([...opening(), gate("gate-read", "read")]);
    expect(playTargets(first.task, first.map)).toEqual(["prepare", "review"]);
    const delivering = view([
      ...firstPassToReview(),
      event("approve-1", { type: "approval", title: "Delivery approved", demoStage: "review" }),
      gate("gate-deliver", "deliver"),
    ]);
    expect(playTargets(delivering.task, delivering.map)).toEqual(["watch"]);
    const reviewing = view(firstPassToReview());
    expect(playTargets(reviewing.task, reviewing.map)).toEqual([]);
  });

  test("a recorded stop point is projected while playing and only Play may carry one", () => {
    const { task } = view([
      ...opening(),
      { ...gate("gate-read", "read", "play"), demoStopAt: "prepare" },
    ]);
    expect(task.demo).toMatchObject({ playback: "play", stopAt: "prepare" });
    const base = { requestId: "synthetic-request-1", expectedCheckpointId: "gate-read" };
    expect(taskActionSchema.safeParse({ ...base, action: "play", stopAt: "prepare" }).success).toBe(true);
    expect(taskActionSchema.safeParse({ ...base, action: "advance", stopAt: "prepare" }).success).toBe(false);
    expect(taskActionSchema.safeParse({ ...base, action: "play", stopAt: "complete" }).success).toBe(false);
  });

  test("a guided gate marks only its stage as next and invents no future facts", () => {
    const { map, stage } = view([...opening(), gate("gate-read", "read")]);
    expect(map.currentStageId).toBe("read");
    expect(stage("start")).toMatchObject({ state: "done", fact: "Guided demo" });
    expect(stage("read")).toMatchObject({ state: "next", stateLabel: "Up next" });
    expect(stage("read").fact).toBeUndefined();
    for (const id of ["prepare", "review", "deliver", "watch", "finish"])
      expect(stage(id)).toMatchObject({ state: "upcoming", fact: undefined });
  });

  test("an approval wait is the owner's turn, with recorded read and brief facts", () => {
    const { stage } = view(firstPassToReview());
    expect(stage("read")).toMatchObject({
      state: "done",
      fact: "Version 1 · first read",
    });
    expect(stage("prepare")).toMatchObject({ state: "done", fact: "3 bullets · links", concept: "Fixed template" });
    expect(stage("review")).toMatchObject({ state: "waiting", stateLabel: "Your turn", fact: "Needs your decision" });
    expect(stage("deliver").state).toBe("upcoming");
  });

  test("a replayed source is deduplicated and the skipped stages say why", () => {
    const events = [
      ...deliveredAndWatching(),
      gate("gate-read-2", "read"),
      execute("run-read-2", "read"),
      event("read-2", { type: "source", demoStage: "read", sources: sources("1") }),
      event("dedupe-2", { type: "deduplicated", demoStage: "read" }),
      gate("gate-watch-2", "watch"),
      execute("run-watch-2", "watch"),
      event("sleep-2", { status: "sleeping", demoStage: "watch" }),
    ];
    const { map, stage } = view(events);
    expect(map.currentStageId).toBe("watch");
    expect(map.looping).toBe(true);
    expect(map.checks).toBe(2);
    expect(map.maxChecks).toBe(3);
    expect(stage("read")).toMatchObject({ state: "done", visits: 2 });
    expect(stage("read").fact).toContain("no change");
    for (const id of ["prepare", "review", "deliver"])
      expect(stage(id)).toMatchObject({ state: "skipped", stateLabel: "Skipped · No change" });
    expect(stage("prepare").fact).toBe("No change, so no new brief");
    expect(stage("deliver").fact).toBe("No change, nothing sent");
    expect(stage("watch")).toMatchObject({ state: "sleeping", fact: "Check 2 of 3", visits: 2 });
  });

  test("a changed source is labeled as a change against the version seen before", () => {
    const events = [
      ...deliveredAndWatching(),
      gate("gate-read-2", "read"),
      execute("run-read-2", "read"),
      event("read-2", { type: "source", demoStage: "read", sources: sources("2") }),
    ];
    const { stage } = view(events);
    expect(stage("read").fact).toBe("Version 2 · changed");
    // Facts from the earlier pass are labeled as history, not as this pass's result.
    expect(stage("prepare")).toMatchObject({ state: "upcoming", fact: "Last pass · 3 bullets · links" });
    expect(stage("review").fact).toBe("Last pass · Approved");
  });

  test("a decline is a normal ending: review declined, later stages skipped", () => {
    const events = [
      ...firstPassToReview(),
      event("deny-1", { type: "approval", title: "Delivery declined", demoStage: "review" }),
      event("done", { status: "completed", demoStage: "complete" }),
    ];
    const { stage } = view(events, "completed");
    expect(stage("review").state).toBe("declined");
    expect(stage("deliver")).toMatchObject({
      state: "skipped",
      stateLabel: "Skipped · Declined",
      fact: "Declined, nothing sent",
    });
    expect(stage("finish")).toMatchObject({ state: "done", fact: "Ended after a decline" });
  });

  test("a stop reported only by the run leaves the pending gate unrun", () => {
    const { map, stage } = view(
      [...opening(), gate("gate-read", "read")],
      "cancelled",
    );
    expect(map.currentStageId).toBe("finish");
    expect(stage("read")).toMatchObject({ state: "upcoming", stateLabel: "Not run" });
    expect(stage("finish")).toMatchObject({ state: "stopped", fact: "Stopped before the end" });
  });

  test("stopping during an approval wait marks review as stopped, not approved", () => {
    const { stage } = view(firstPassToReview(), "cancelled");
    expect(stage("review")).toMatchObject({ state: "stopped", fact: "Stopped before a decision" });
    expect(stage("deliver")).toMatchObject({ state: "upcoming", stateLabel: "Not run" });
    expect(stage("finish").state).toBe("stopped");
  });

  test("a later pass stopped at review does not reuse the earlier approval", () => {
    const events = [
      ...deliveredAndWatching(),
      gate("gate-read-2", "read"),
      execute("run-read-2", "read"),
      event("read-2", { type: "source", demoStage: "read", sources: sources("2") }),
      gate("gate-prepare-2", "prepare"),
      execute("run-prepare-2", "prepare"),
      event("brief-2", { type: "brief", demoStage: "prepare", content: "- Updated brief" }),
      gate("gate-review-2", "review"),
      execute("run-review-2", "review"),
      event("await-2", { status: "awaiting_approval", demoStage: "review" }),
    ];
    const { stage } = view(events, "cancelled");
    expect(stage("review")).toMatchObject({ state: "stopped", fact: "Stopped before a decision" });
    expect(stage("watch")).toMatchObject({ state: "upcoming", stateLabel: "Not run" });
  });

  test("a calendar proposal uses its own three stages and never shows a write before approval", () => {
    clock = 0;
    const draftInput = { ...input, kind: "calendar_event" as const, demoMode: false };
    const waiting = view([event("await", { status: "awaiting_approval", input: draftInput })]);
    expect(waiting.map.stages.map((item) => item.id)).toEqual(["review", "create", "finish"]);
    expect(waiting.stage("review").state).toBe("waiting");
    expect(waiting.stage("create")).toMatchObject({ state: "upcoming", fact: undefined });

    clock = 0;
    const declined = view(
      [
        event("await", { status: "awaiting_approval", input: draftInput }),
        event("deny", { type: "approval", calendarDecision: "denied" }),
        event("done", { status: "completed" }),
      ],
      "completed",
    );
    expect(declined.stage("review").state).toBe("declined");
    expect(declined.stage("create")).toMatchObject({ state: "skipped", stateLabel: "Skipped · Declined" });
  });

  test("an unconfirmed provider write fails the create stage and the run", () => {
    clock = 0;
    const draftInput = { ...input, kind: "calendar_event" as const, demoMode: false };
    const { stage } = view(
      [
        event("await", { status: "awaiting_approval", input: draftInput }),
        event("approve", { type: "approval", calendarDecision: "approved" }),
        event("creating", { status: "running" }),
        event("error", { type: "error", status: "failed" }),
      ],
      "failed",
    );
    expect(stage("review").state).toBe("done");
    expect(stage("create").state).toBe("failed");
    expect(stage("finish").state).toBe("failed");
  });
});

describe("calendar watch on the diagram", () => {
  const watchInput: AssistantTaskInput = {
    ...input,
    taskId: "synthetic-watch",
    title: "Watch my calendar",
    mode: "calendar",
    kind: "calendar_watch",
    demoMode: false,
    approvalRequired: false,
    maxChecks: 5,
  };
  const clash = {
    key: "conflict:a:b",
    kind: "conflict" as const,
    text: "“Fictional review” overlaps “Fictional 1:1”",
    when: "Mon, Nov 2, 10:30–11:00 AM",
    start: "2026-11-02T15:30:00.000Z",
  };
  const nextCheck = { at: "2026-11-02T14:45:00.000Z", label: "9:45 AM", reason: "15 minutes before “Fictional review”", cron: "45 9 2 11 *" };
  const firstPass = [
    event("watch-start", { status: "running", input: watchInput }),
    event("watch-check-1", { status: "running" }),
    event("watch-read-1", { type: "source", sources: [], scan: { events: 9, days: 7, timeZone: "America/Toronto" } }),
    event("watch-notice-1", { type: "notice", title: "Found 1 thing to flag", callouts: [{ ...clash, fresh: true }] }),
    event("watch-message-1", { type: "notification", title: "Messaged you", content: "1 thing on your calendar needs a look:" }),
    event("watch-sleep-1", { status: "sleeping", title: "Next check: 9:45 AM", nextCheck }),
  ];
  const project = (events: TaskEvent[]) => {
    const task = projectAssistantTask(
      { runId: "wrun_synthetic_watch", status: "running", createdAt: new Date(started) },
      events,
    );
    return { task, map: projectStageMap(task, projectTaskFlow(task, { now: started })) };
  };

  test("its own stages show what it read, flagged, and sent, and the time it picked to wake", () => {
    const { task, map } = project(firstPass);
    expect(map.stages.map((stage) => stage.label)).toEqual(["Start", "Read", "Notice", "Message", "Schedule", "Finish"]);
    const stage = (id: string) => map.stages.find((item) => item.id === id)!;
    expect(stage("read").fact).toBe("9 events · next 7 days");
    expect(stage("notice").fact).toBe("1 new · 1 flagged");
    expect(stage("deliver").fact).toBe("1 message sent");
    expect(stage("watch")).toMatchObject({ state: "sleeping", stateLabel: "Until 9:45 AM" });
    // Check now rereads the calendar; there is no fixed event to replay.
    expect(task.allowedActions).toContain("wake");
    expect(task.allowedActions).not.toContain("replay");
    expect(previewStageMap("calendar_watch").stages.map((item) => item.summary)).toContain("Messages you, nobody else");
  });

  test("a pass with nothing new skips the message and says why", () => {
    const { map } = project([
      ...firstPass,
      event("watch-check-2", { status: "running" }),
      event("watch-read-2", { type: "source", sources: [], scan: { events: 9, days: 7, timeZone: "America/Toronto" } }),
      event("watch-notice-2", { type: "notice", title: "Nothing new to flag", callouts: [{ ...clash, fresh: false }] }),
      event("watch-sleep-2", { status: "sleeping", title: "Next check: 9:45 AM", nextCheck }),
    ]);
    expect(map.stages.find((stage) => stage.id === "deliver")).toMatchObject({
      state: "skipped",
      fact: "Nothing new, so no message",
    });
    expect(map.stages.find((stage) => stage.id === "notice")?.fact).toBe("Nothing new · 1 flagged");
  });
});
