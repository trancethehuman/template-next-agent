import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock } from "bun:test";
import type { CalendarEvent } from "../../lib/assistant/calendar";
import type { ScanEvent } from "../../lib/assistant/calendar-callouts";
import type {
  AssistantDemoStage,
  AssistantDemoStop,
  AssistantTask,
  AssistantTaskInput,
  TaskAction,
  TaskControl,
  TaskEvent,
} from "../../lib/assistant/types";

// Each test runs this fixture in its own Bun process. Only Workflow transport
// and external providers are doubled; the application's orchestration and
// synthetic source/template functions execute normally.
const events: TaskEvent[] = [];
const hookOptions: Array<{ token: string; experimental_minRetention?: string }> = [];
const commands: TaskControl[] = [];
const readers: Array<(value: IteratorResult<TaskControl>) => void> = [];
const sleeps: Array<{ duration: number | string | Date; resolved: boolean; resolve: () => void }> = [];
let nextStep = 0;
let nextCommand = 0;
let closed = false;
let finished = false;
let failure: unknown;
let externalCalls = 0;
let modelCalls = 0;
let calendarReads = 0;
let calendarReadFixture: CalendarEvent | undefined;
let watchScans: ScanEvent[][] = [];
let calendarScans = 0;
let allowManagedWrite = false;
const managedWriteIdentities: string[] = [];

function forbidExternalCall(): never {
  externalCalls++;
  throw new Error("Synthetic demonstration attempted an external provider call");
}

const hook: AsyncIterableIterator<TaskControl> & {
  getConflict: () => Promise<null>;
} = {
  async getConflict() {
    return null;
  },
  [Symbol.asyncIterator]() {
    return this;
  },
  next() {
    const command = commands.shift();
    return command
      ? Promise.resolve({ done: false as const, value: command })
      : new Promise<IteratorResult<TaskControl>>((resolve) => readers.push(resolve));
  },
};

mock.module("workflow", () => ({
  FatalError: class extends Error {},
  getStepMetadata: () => ({ stepId: `synthetic-step-${++nextStep}` }),
  getWritable: () => ({
    getWriter: () => ({
      async write(line: string) {
        events.push(JSON.parse(line) as TaskEvent);
      },
      releaseLock() {},
    }),
    async close() {
      closed = true;
    },
  }),
  createHook: (options: (typeof hookOptions)[number]) => {
    hookOptions.push(options);
    return hook;
  },
  sleep: (duration: number | string | Date) =>
    new Promise<void>((resolve) => {
      const wait = {
        duration,
        resolved: false,
        resolve() {
          wait.resolved = true;
          resolve();
        },
      };
      sleeps.push(wait);
    }),
}));
mock.module("ai", () => ({ generateText: () => { modelCalls++; return forbidExternalCall(); } }));
mock.module("../../lib/assistant/calendar.ts", () => ({
  CalendarIntegrationError: class extends Error {},
  listCalendarEvents: async (actor: NonNullable<AssistantTaskInput["owner"]>) => {
    if (!calendarReadFixture) forbidExternalCall();
    assert.equal(actor.id, "google:synthetic-guided-owner");
    calendarReads++;
    return {
      events: [calendarReadFixture],
      calendarName: "Synthetic fixture calendar",
      timeZone: "America/Toronto",
      truncated: false,
    };
  },
  createManagedCalendarEvent: async (
    actor: NonNullable<AssistantTaskInput["owner"]>,
    draft: NonNullable<AssistantTaskInput["eventDraft"]>,
    actionId: string,
  ) => {
    if (!allowManagedWrite) forbidExternalCall();
    assert.equal(actor.id, "google:synthetic-guided-owner");
    assert.ok(events.some((event) => event.calendarDecision === "approved"));
    managedWriteIdentities.push(actionId);
    return {
      id: "synthetic-existing-managed-event",
      title: draft.summary,
      start: draft.start,
      end: draft.end,
      timeZone: draft.timeZone,
      allDay: false,
      managed: true,
      reused: true,
    };
  },
  scanCalendarEvents: async (actor: NonNullable<AssistantTaskInput["owner"]>) => {
    const events = watchScans.shift();
    if (!events) forbidExternalCall();
    assert.equal(actor.id, "google:synthetic-guided-owner");
    calendarScans++;
    const now = Date.now();
    return {
      events,
      timeZone: "America/Toronto",
      timeMin: new Date(now).toISOString(),
      timeMax: new Date(now + 7 * 86_400_000).toISOString(),
      truncated: false,
    };
  },
  findCalendarAvailability: forbidExternalCall,
}));

const { assistantTaskWorkflow } = await import("../../workflows/assistant-task");

function status() {
  return events.filter((event) => event.status).at(-1);
}

async function until(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (failure) throw failure;
    if (finished || Date.now() >= deadline)
      throw new Error(
        `Did not reach ${label}; last stage=${status()?.demoStage}, state=${status()?.status}`,
      );
    await Bun.sleep(1);
  }
}

async function gate(stage: AssistantDemoStage) {
  await until(
    () => status()?.demoStage === stage && Boolean(status()?.demoGate) && status()?.status === "paused",
    `${stage} manual gate`,
  );
  assert.equal(status()?.status, "paused");
}

function send(
  action: TaskAction,
  checkpointId = status()?.id,
  requestId?: string,
  stopAt?: AssistantDemoStop,
) {
  assert.ok(checkpointId, "A command needs a recorded checkpoint");
  const command: TaskControl = {
    action,
    checkpointId,
    requestId: requestId ?? `synthetic-command-${++nextCommand}`,
    ...(stopAt ? { stopAt } : {}),
  };
  const reader = readers.shift();
  if (reader) reader({ done: false, value: command });
  else commands.push(command);
  return command;
}

function begin(overrides: Partial<AssistantTaskInput> = {}) {
  const input: AssistantTaskInput = {
    owner: { id: "google:synthetic-guided-owner", email: "guided-owner@example.test" },
    taskId: "synthetic-guided-task",
    title: "Synthetic guided demonstration",
    prompt: "Prepare a fictional meeting brief",
    mode: "rehearsal",
    kind: "meeting_prep",
    demoMode: true,
    manualStart: true,
    delaySeconds: 0,
    approvalRequired: true,
    sourceVersion: 1,
    maxChecks: 3,
    preference: { bulletCount: 3, includeLinks: true },
    ...overrides,
  };
  const execution = assistantTaskWorkflow(input);
  void execution.then(
    () => { finished = true; },
    (error: unknown) => { failure = error; finished = true; },
  );
  return execution;
}

// Scenario assertions are deliberately expressed against emitted checkpoints,
// commands, and observable effects, rather than source-text matching.
async function stepThrough() {
  const execution = begin();
  await gate("read");
  const firstGate = status()!.id;
  assert.equal(events.some((event) => event.type === "source"), false);
  send("advance");
  await gate("prepare");
  assert.equal(events.filter((event) => event.type === "source").length, 1);
  assert.equal(events.some((event) => event.type === "brief"), false);
  send("advance");
  await gate("review");
  send("advance");
  await until(() => status()?.status === "awaiting_approval", "owner review");
  assert.equal(events.filter((event) => event.type === "brief").length, 1);
  assert.equal(events.some((event) => event.type === "notification"), false);
  send("approve", firstGate);
  send("approve");
  await gate("deliver");
  assert.equal(events.some((event) => event.type === "notification"), false);
  send("advance");
  await gate("watch");
  send("advance");
  await until(() => status()?.status === "sleeping", "manual source trigger");
  assert.equal(events.filter((event) => event.type === "notification").length, 1);
  send("finish");
  await execution;
  assert.equal(status()?.status, "completed");
  assert.equal(closed, true);
  assert.equal(externalCalls, 0);
  assert.equal(hookOptions.length, 1);
  assert.equal(hookOptions[0].experimental_minRetention, "1d");
  assert.match(hookOptions[0].token, /synthetic-guided-owner:synthetic-guided-task$/);
  return { case: "step-through", sourceReads: 1, briefs: 1, deliveries: 1, externalCalls };
}

async function playPause() {
  const execution = begin();
  await gate("read");
  send("play");
  await until(() => status()?.demoPlayback === "play" && sleeps.length === 1, "paced read");
  assert.equal(events.some((event) => event.type === "source"), false);
  const interruptedTimer = sleeps[0];
  send("pause");
  await gate("read");
  assert.equal(status()?.demoPlayback, "step");
  interruptedTimer.resolve();
  await Bun.sleep(5);
  assert.equal(events.some((event) => event.type === "source"), false);
  send("play");
  for (const stage of ["read", "prepare", "review"] as const) {
    await until(
      () => status()?.demoStage === stage && status()?.demoPlayback === "play" && sleeps.some((wait) => !wait.resolved),
      `paced ${stage}`,
    );
    const timer = sleeps.findLast((wait) => !wait.resolved)!;
    assert.equal(timer.duration, "1s");
    timer.resolve();
  }
  await until(() => status()?.status === "awaiting_approval", "play stopped for approval");
  assert.equal(status()?.demoPlayback, "step");
  assert.equal(events.filter((event) => event.type === "source").length, 1);
  assert.equal(events.filter((event) => event.type === "brief").length, 1);
  assert.equal(events.some((event) => event.type === "notification"), false);
  send("deny");
  await execution;
  assert.equal(status()?.status, "completed");
  return { case: "play-pause", pausedTimerCannotAdvance: true, ownerApprovalNeverAutomated: true, externalCalls };
}

async function playToStage() {
  const execution = begin();
  await gate("read");
  send("play", undefined, undefined, "prepare");
  await until(
    () => status()?.demoPlayback === "play" && sleeps.some((wait) => !wait.resolved),
    "paced read toward prepare",
  );
  assert.equal(status()?.demoStage, "read");
  assert.equal(status()?.demoStopAt, "prepare");
  sleeps.findLast((wait) => !wait.resolved)!.resolve();
  await gate("prepare");
  assert.equal(status()?.demoStopAt, undefined);
  assert.equal(events.filter((event) => event.type === "source").length, 1);
  for (const timer of sleeps) if (!timer.resolved) timer.resolve();
  await Bun.sleep(5);
  assert.equal(events.some((event) => event.type === "brief"), false);
  // The stop is spent once it pauses; plain Play continues to the owner boundary.
  send("play");
  for (const stage of ["prepare", "review"] as const) {
    await until(
      () => status()?.demoStage === stage && status()?.demoPlayback === "play" && sleeps.some((wait) => !wait.resolved),
      `paced ${stage}`,
    );
    assert.equal(status()?.demoStopAt, undefined);
    sleeps.findLast((wait) => !wait.resolved)!.resolve();
  }
  await until(() => status()?.status === "awaiting_approval", "play stopped for approval");
  assert.equal(events.filter((event) => event.type === "brief").length, 1);
  send("deny");
  await execution;
  return { case: "play-to-stage", pausedBeforeStage: true, stopIsSpentAfterPause: true, externalCalls };
}

async function delayedPause() {
  const execution = begin();
  await gate("read");
  send("play");
  await until(() => status()?.demoPlayback === "play" && sleeps.length === 1, "first playback checkpoint");
  const acceptedCheckpoint = status()!.id;
  // The API accepted the pause against this checkpoint, but transport delivery
  // can lose the race to the already pending durable timer.
  sleeps[0].resolve();
  await until(() => status()?.demoStage === "prepare" && status()?.demoPlayback === "play" && sleeps.length === 2, "timer advanced to prepare");
  send("pause", acceptedCheckpoint);
  await gate("prepare");
  assert.equal(events.filter((event) => event.type === "source").length, 1);
  assert.equal(events.some((event) => event.type === "brief"), false);
  sleeps[1].resolve();
  await Bun.sleep(5);
  assert.equal(events.some((event) => event.type === "brief"), false);
  send("advance");
  await gate("review");
  send("advance");
  await until(() => status()?.status === "awaiting_approval", "review after delayed pause");
  send("deny");
  await execution;
  return { case: "delayed-pause", pausesAtNextGate: true, noUnrequestedBrief: true, externalCalls };
}

async function forgedPause() {
  const execution = begin();
  await gate("read");
  send("play");
  await until(() => status()?.demoPlayback === "play" && sleeps.length === 1, "known playback checkpoint");
  const knownCheckpoint = status()!.id;
  send("pause", "synthetic-never-emitted-checkpoint");
  await until(() => sleeps.length === 2, "forged checkpoint rejected");
  assert.equal(status()?.id, knownCheckpoint);
  assert.equal(status()?.demoPlayback, "play");
  sleeps[1].resolve();
  await until(() => status()?.demoStage === "prepare" && status()?.demoPlayback === "play", "next real playback checkpoint");
  send("pause", knownCheckpoint);
  await gate("prepare");
  for (const timer of sleeps) if (!timer.resolved) timer.resolve();
  await Bun.sleep(5);
  assert.equal(events.some((event) => event.type === "brief"), false);
  send("advance");
  await gate("review");
  send("advance");
  await until(() => status()?.status === "awaiting_approval", "owner review after known pause");
  send("deny");
  await execution;
  return { case: "forged-pause", forgedCheckpointIgnored: true, knownCheckpointPauses: true, externalCalls };
}

async function runToWatch() {
  for (const stage of ["read", "prepare", "review"] as const) {
    await gate(stage);
    send("advance");
  }
  await until(() => status()?.status === "awaiting_approval", "review");
  send("approve");
  await gate("deliver");
  send("advance");
  await gate("watch");
  send("advance");
  await until(() => status()?.status === "sleeping", "watch trigger");
}

async function replayChange() {
  const execution = begin({ maxChecks: 5 });
  await runToWatch();
  send("replay");
  await gate("read");
  send("advance");
  await gate("watch");
  assert.equal(events.filter((event) => event.type === "deduplicated").length, 1);
  assert.equal(events.filter((event) => event.type === "brief").length, 1);
  assert.equal(events.filter((event) => event.type === "notification").length, 1);
  send("advance");
  await until(() => status()?.status === "sleeping", "watch before pause");
  const oldWatch = sleeps.findLast((wait) => !wait.resolved)!;
  send("pause");
  await until(() => status()?.status === "paused" && status()?.demoGate === false, "monitoring pause");
  const readsWhilePaused = events.filter((event) => event.type === "source").length;
  oldWatch.resolve();
  await Bun.sleep(5);
  assert.equal(events.filter((event) => event.type === "source").length, readsWhilePaused);
  send("resume");
  await gate("read");
  send("advance");
  await gate("watch");
  send("advance");
  await until(() => status()?.status === "sleeping", "watch after resume");
  send("update-source");
  await runToWatch();
  assert.equal(events.filter((event) => event.type === "deduplicated").length, 2);
  const briefs = events.filter((event) => event.type === "brief");
  assert.equal(briefs.length, 2);
  assert.equal(briefs[1].sources?.[0].version, "2");
  assert.match(briefs[1].content ?? "", /revised accessibility audit/);
  assert.equal(events.filter((event) => event.type === "notification").length, 2);
  send("finish");
  await execution;
  return { case: "replay-change", sourceReads: 4, deduplicated: 2, deliveries: 2, externalCalls };
}

async function restartDelivery() {
  const { rehearsalContext, rehearsalBrief } = await import("../../lib/assistant/demonstration");
  const context = rehearsalContext(2);
  const execution = begin({
    taskId: "synthetic-new-restarted-task",
    restart: {
      version: 1,
      sourceRunId: "wrun_synthetic_original",
      sourceEventId: "synthetic-original-delivery",
      sourceTitle: "Previously approved inbox delivery",
      phase: "deliver",
      sourceVersion: 2,
      previousKey: "",
      prepared: {
        content: rehearsalBrief(context, { bulletCount: 3, includeLinks: true }),
        sources: context.sources,
        key: context.key,
      },
    },
  });
  await gate("review");
  assert.equal(events[0].type, "restart");
  assert.equal(events.some((event) => event.type === "source"), false);
  assert.equal(events.some((event) => event.type === "brief"), false);
  send("advance");
  await until(() => status()?.status === "awaiting_approval", "fresh restarted owner review");
  send("approve", "synthetic-original-delivery");
  send("deny");
  await execution;
  assert.equal(events.some((event) => event.type === "notification"), false);
  assert.equal(events.filter((event) => event.type === "approval").length, 1);
  assert.equal(events.find((event) => event.type === "approval")?.title, "Delivery declined");
  assert.match(hookOptions[0].token, /synthetic-new-restarted-task$/);
  return { case: "restart-delivery", originalApprovalCannotDeliver: true, context: "explicitly-restored", externalCalls };
}

async function checkLimit() {
  const { rehearsalContext } = await import("../../lib/assistant/demonstration");
  const execution = begin({
    maxChecks: 3,
    restart: {
      version: 1,
      sourceRunId: "wrun_synthetic_original_watch",
      sourceEventId: "synthetic-watch-checkpoint",
      sourceTitle: "Original monitoring wait",
      phase: "watch",
      sourceVersion: 1,
      previousKey: rehearsalContext(1).key,
    },
  });
  for (let check = 0; check < 3; check++) {
    await gate("watch");
    send("advance");
    await until(() => status()?.status === "sleeping", "bounded monitoring wait");
    send("replay");
    await gate("read");
    send("advance");
  }
  await gate("complete");
  assert.equal(events.filter((event) => event.type === "source").length, 3);
  assert.equal(events.filter((event) => event.type === "deduplicated").length, 3);
  assert.equal(events.some((event) => event.type === "brief"), false);
  assert.equal(events.some((event) => event.type === "notification"), false);
  send("advance");
  await execution;
  for (const timer of sleeps) if (!timer.resolved) timer.resolve();
  await Bun.sleep(5);
  assert.equal(events.filter((event) => event.type === "source").length, 3);
  assert.equal(closed, true);
  return { case: "check-limit", sourceReads: 3, deduplicated: 3, noFourthRead: true, externalCalls };
}

async function restartCalendarWrite() {
  allowManagedWrite = true;
  const execution = begin({
    taskId: "synthetic-new-calendar-restart",
    kind: "calendar_event",
    mode: "calendar",
    eventDraft: {
      summary: "Synthetic exact immutable hold",
      start: "2099-11-02T10:00:00-05:00",
      end: "2099-11-02T10:30:00-05:00",
      timeZone: "America/Toronto",
    },
    restart: {
      version: 1,
      sourceRunId: "wrun_synthetic_original_calendar",
      sourceEventId: "synthetic-original-provider-result",
      sourceTitle: "Original managed event",
      phase: "calendar_review",
      sourceVersion: 1,
      previousKey: "",
      calendarWriteActionId: "synthetic-original-calendar-action",
    },
  });
  await until(() => status()?.status === "awaiting_approval", "fresh calendar owner gate");
  assert.equal(managedWriteIdentities.length, 0);
  send("approve", "synthetic-original-provider-result");
  send("approve");
  await execution;
  assert.deepEqual(managedWriteIdentities, ["synthetic-original-calendar-action"]);
  assert.equal(events.find((event) => event.type === "calendar_event")?.calendarEvent?.reused, true);
  return { case: "restart-calendar-write", freshOwnerApproval: true, identity: "original-action", providerAttempts: 1, externalCalls };
}

async function restoredLiveReview() {
  const { planAssistantTaskRestart } = await import("../../lib/assistant/restart-plan");
  const { projectAssistantTask } = await import("../../lib/assistant/task-policy");
  const now = Date.now();
  const actor = { id: "google:synthetic-guided-owner", email: "guided-owner@example.test" };
  const meeting: CalendarEvent = {
    id: "synthetic-restored-calendar-meeting",
    title: "Fictional live-calendar fixture",
    start: new Date(now + 86_400_000).toISOString(),
    end: new Date(now + 88_200_000).toISOString(),
    timeZone: "America/Toronto",
    allDay: false,
    location: "Fictional room A",
    htmlUrl: "https://calendar.google.com/calendar/event?eid=synthetic-restored-meeting",
  };
  calendarReadFixture = meeting;
  const sourceKey = createHash("sha256")
    .update(JSON.stringify([meeting.id, meeting.title, meeting.start, meeting.end, meeting.location]))
    .digest("hex");
  const sources = [{ id: meeting.id, title: meeting.title, version: sourceKey.slice(0, 12), url: meeting.htmlUrl }];
  const originalInput: AssistantTaskInput = {
    owner: actor,
    taskId: "synthetic-original-live-review",
    title: "Fictional restored live-calendar review",
    prompt: "Prepare this synthetic meeting",
    mode: "calendar",
    kind: "meeting_prep",
    manualStart: false,
    approvalRequired: true,
    delaySeconds: 0,
    sourceVersion: 1,
    maxChecks: 2,
    preference: { bulletCount: 3, includeLinks: true },
  };
  const recordedAt = new Date(now).toISOString();
  const parentEvents: TaskEvent[] = [
    { id: "synthetic-live-start", type: "status", status: "running", title: "Original task", detail: "Synthetic fixture", occurredAt: recordedAt, input: originalInput },
    { id: "synthetic-live-source", type: "source", title: "Read Google Calendar", detail: "Synthetic provider fixture", occurredAt: recordedAt, sources, sourceKey },
    { id: "synthetic-live-brief", type: "brief", title: "Meeting brief prepared", detail: "Recorded fictional brief", occurredAt: recordedAt, sources, sourceKey, content: "- A recorded fictional brief, reused with a new owner decision." },
    { id: "synthetic-live-review", type: "status", status: "awaiting_approval", title: "Review before delivery", detail: "Original owner decision was not copied", occurredAt: recordedAt },
  ];
  const parent = projectAssistantTask(
    { runId: "wrun_synthetic_original_live_review", status: "running", createdAt: new Date(now) },
    parentEvents,
  );
  const plan = planAssistantTaskRestart(actor, parent, "synthetic-live-review");
  assert.equal(plan.restart.phase, "review");
  assert.equal(plan.restart.prepared?.key, sourceKey);
  const execution = begin({
    ...plan.input,
    taskId: "synthetic-restarted-live-review",
    owner: actor,
    demoMode: false,
    restart: plan.restart,
  });
  await until(() => status()?.status === "awaiting_approval", "fresh live owner review");
  assert.equal(calendarReads, 0, "Restored review cannot pretend to have read Calendar again");
  assert.equal(events.some((event) => event.type === "brief"), false);
  assert.equal(events.some((event) => event.type === "notification"), false);
  send("approve", "synthetic-live-review");
  send("approve");
  await until(() => status()?.status === "sleeping", "live watch after restored delivery");
  assert.equal(events.filter((event) => event.type === "notification").length, 1);
  assert.equal(events.find((event) => event.type === "notification")?.sourceKey, sourceKey);
  send("replay");
  await execution;
  assert.equal(calendarReads, 1);
  assert.equal(modelCalls, 0);
  assert.equal(events.filter((event) => event.type === "source").length, 1);
  assert.equal(events.find((event) => event.type === "source")?.sourceKey, sourceKey);
  assert.equal(events.filter((event) => event.type === "deduplicated").length, 1);
  assert.equal(events.some((event) => event.type === "brief"), false);
  assert.equal(events.filter((event) => event.type === "approval").length, 1);
  assert.equal(events.filter((event) => event.type === "notification").length, 1);
  assert.equal(status()?.status, "completed");
  return { case: "restored-live-review", calendarReads, modelCalls, deliveries: 1, deduplicated: 1, generatedBriefs: 0, externalCalls };
}

async function calendarWatch() {
  const hour = 3_600_000;
  const at = (offset: number) => new Date(Date.now() + offset).toISOString();
  const meeting = (id: string, title: string, start: number, end: number): ScanEvent => ({
    id, title, start: at(start), end: at(end), allDay: false, cancelled: false, free: false,
    marker: false, organizedByYou: false, yourResponse: "accepted", guests: [],
  });
  const week = [
    meeting("review", "Fictional design review", 3 * hour, 4 * hour),
    meeting("one-on-one", "Fictional 1:1", 3.5 * hour, 4.5 * hour),
  ];
  watchScans = [week, week];
  const execution = begin({
    kind: "calendar_watch", mode: "calendar", demoMode: false, manualStart: false,
    approvalRequired: false, maxChecks: 3, title: "Watch my calendar",
  });
  await until(() => status()?.status === "sleeping", "first watch sleep");
  const notice = events.find((event) => event.type === "notice");
  assert.equal(notice?.callouts?.length, 1);
  assert.equal(notice?.callouts?.[0].kind, "conflict");
  const message = events.find((event) => event.type === "notification");
  assert.match(message?.content ?? "", /overlaps/);
  // It sleeps until the time it picked, not a fixed interval.
  assert.ok(sleeps.at(-1)?.duration instanceof Date);
  assert.equal(status()?.nextCheck?.at, (sleeps.at(-1)?.duration as Date).toISOString());
  send("wake");
  await until(() => events.filter((event) => event.status === "sleeping").length === 2, "second watch sleep");
  send("finish");
  await execution;
  assert.equal(status()?.status, "completed");
  return {
    case: "calendar-watch",
    calendarScans,
    notices: events.filter((event) => event.type === "notice").length,
    messages: events.filter((event) => event.type === "notification").length,
    approvals: events.filter((event) => event.type === "approval").length,
    modelCalls,
    externalCalls,
  };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  "calendar-watch": calendarWatch,
  "step-through": stepThrough,
  "play-pause": playPause,
  "play-to-stage": playToStage,
  "delayed-pause": delayedPause,
  "forged-pause": forgedPause,
  "replay-change": replayChange,
  "restart-delivery": restartDelivery,
  "check-limit": checkLimit,
  "restart-calendar-write": restartCalendarWrite,
  "restored-live-review": restoredLiveReview,
  "live-http": liveHttpAcceptance,
};

const scenario = scenarios[Bun.argv[2] ?? ""];
assert.ok(scenario, "Choose a documented demonstration test scenario");
console.log(JSON.stringify(await scenario()));

/**
 * Explicitly opted-in real Next/Workflow acceptance, with a separate fictional
 * principal and only synthetic rehearsal inputs. Session material stays in this
 * process and is never included in evidence or persisted as a fixture.
 */
async function liveHttpAcceptance() {
  assert.equal(process.env.ASSISTANT_DEMONSTRATION_HTTP, "1");
  const base = new URL(
    process.env.ASSISTANT_DEMONSTRATION_BASE_URL ?? "http://localhost:3000",
  );
  assert.ok(
    base.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(base.hostname) &&
      base.pathname === "/" &&
      !base.search && !base.hash && !base.username && !base.password,
    "HTTP acceptance is limited to the local development server",
  );
  assert.ok(process.env.AUTH_SECRET, "AUTH_SECRET is required for local acceptance");
  const { encode } = await import("next-auth/jwt");
  const discriminator = crypto.randomUUID().replaceAll("-", "");
  const workspaceDomain =
    process.env.AUTH_GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase() || undefined;
  const cookie = "authjs.session-token=" + await encode({
    secret: process.env.AUTH_SECRET,
    salt: "authjs.session-token",
    maxAge: 300,
    token: {
      sub: `google:synthetic-demo-${discriminator}`,
      email: `demonstration-fixture@${workspaceDomain ?? "example.test"}`,
      sessionKind: "assistant-user",
      workspaceDomain,
    },
  });
  let requests = 0;
  async function request<T>(path: string, body?: unknown): Promise<T> {
    requests++;
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin: base.origin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(response.ok, `Synthetic acceptance request failed: ${response.status} ${path}`);
    return response.json() as Promise<T>;
  }
  async function taskAt(runId: string, predicate: (task: AssistantTask) => boolean) {
    const deadline = Date.now() + 25_000;
    for (;;) {
      const result = await request<{ task: AssistantTask }>(
        `/api/assistant/tasks/${encodeURIComponent(runId)}`,
      );
      if (predicate(result.task)) return result.task;
      assert.notEqual(result.task.status, "failed", "Synthetic workflow failed");
      assert.ok(Date.now() < deadline, `Synthetic acceptance timed out at ${result.task.demo?.stage}`);
      await Bun.sleep(150);
    }
  }
  async function action(task: AssistantTask, action: TaskAction) {
    assert.ok(task.allowedActions.includes(action), `${action} is unavailable at ${task.demo?.stage}`);
    await request(`/api/assistant/tasks/${encodeURIComponent(task.runId)}`, {
      action,
      requestId: `synthetic-http-${crypto.randomUUID()}`,
      expectedCheckpointId: task.checkpointId,
    });
  }
  const created = await request<{ runId: string }>("/api/assistant/tasks", {
    title: "Synthetic guided acceptance — disposable",
    prompt: "Fictional meeting demonstration acceptance",
    mode: "rehearsal",
    kind: "meeting_prep",
    demoMode: true,
    manualStart: true,
    approvalRequired: true,
    delaySeconds: 0,
    sourceVersion: 1,
    maxChecks: 3,
    preference: { bulletCount: 3, includeLinks: true },
  });
  const fixtureRuns = new Set([created.runId]);
  let current: AssistantTask | undefined;
  try {
    current = await taskAt(created.runId, (task) => Boolean(task.demo?.waitingForStep && task.demo.stage === "read"));
    assert.equal(current.events.some((event) => event.type === "source"), false);
    await action(current, "advance");
    current = await taskAt(created.runId, (task) => Boolean(task.demo?.waitingForStep && task.demo.stage === "prepare"));
    assert.equal(current.events.filter((event) => event.type === "source").length, 1);
    assert.equal(current.events.some((event) => event.type === "brief"), false);
    const persistedCheckpoint = current.checkpointId;
    await Bun.sleep(250);
    current = await taskAt(created.runId, (task) => task.checkpointId === persistedCheckpoint);
    await action(current, "play");
    current = await taskAt(created.runId, (task) => Boolean(task.demo?.waitingForStep && task.demo.playback === "play"));
    await action(current, "pause");
    current = await taskAt(created.runId, (task) => Boolean(task.demo?.waitingForStep && task.demo.playback === "step" && task.status === "paused") || task.status === "awaiting_approval");
    const pausedCheckpoint = current.checkpointId;
    const pausedEventIds = current.events.map((event) => event.id);
    await Bun.sleep(1100);
    current = await taskAt(created.runId, (task) => task.checkpointId === pausedCheckpoint);
    assert.deepEqual(current.events.map((event) => event.id), pausedEventIds, "A pending durable timer cannot advance a paused gate");
    if (current.status !== "awaiting_approval") await action(current, "play");
    current = await taskAt(created.runId, (task) => task.status === "awaiting_approval");
    assert.equal(current.events.filter((event) => event.type === "brief").length, 1);
    assert.equal(current.notificationCount, 0, "Play must stop at owner approval");
    await action(current, "approve");
    current = await taskAt(created.runId, (task) => Boolean(task.demo?.waitingForStep && task.demo.stage === "deliver"));
    assert.equal(current.notificationCount, 0);
    await action(current, "advance");
    current = await taskAt(created.runId, (task) => Boolean(task.demo?.waitingForStep && task.demo.stage === "watch"));
    await action(current, "advance");
    current = await taskAt(created.runId, (task) => task.status === "sleeping" && task.demo?.stage === "watch");
    assert.equal(current.notificationCount, 1);
    const sourceCheckpoint = current.events.find((event) => event.type === "source");
    assert.ok(sourceCheckpoint, "The restart needs an actual recorded source checkpoint");
    const parentEventIds = current.events.map((event) => event.id);
    const restartBody = { eventId: sourceCheckpoint.id, requestId: `synthetic-restart-${crypto.randomUUID()}` };
    const restarted = await request<{ runId: string; parentStopped: boolean }>(
      `/api/assistant/tasks/${encodeURIComponent(created.runId)}/restart`, restartBody,
    );
    fixtureRuns.add(restarted.runId);
    const duplicate = await request<{ runId: string }>(
      `/api/assistant/tasks/${encodeURIComponent(created.runId)}/restart`, restartBody,
    );
    assert.equal(duplicate.runId, restarted.runId, "A retried restart must return the same new run");
    assert.equal(restarted.parentStopped, true);
    assert.notEqual(restarted.runId, created.runId);
    const parent = await taskAt(created.runId, (task) => task.status === "cancelled");
    assert.deepEqual(parent.events.map((event) => event.id), parentEventIds);
    current = await taskAt(restarted.runId, (task) => Boolean(task.demo?.waitingForStep && task.demo.stage === "read"));
    assert.equal(current.restart?.sourceRunId, created.runId);
    assert.equal(current.restart?.sourceEventId, sourceCheckpoint.id);
    assert.equal(current.notificationCount, 0);
    await action(current, "advance");
    current = await taskAt(restarted.runId, (task) => Boolean(task.demo?.waitingForStep && task.demo.stage === "prepare"));
    await action(current, "advance");
    current = await taskAt(restarted.runId, (task) => Boolean(task.demo?.waitingForStep && task.demo.stage === "review"));
    await action(current, "advance");
    current = await taskAt(restarted.runId, (task) => task.status === "awaiting_approval");
    assert.equal(current.notificationCount, 0, "The original approval cannot authorize restarted delivery");
    await action(current, "deny");
    current = await taskAt(restarted.runId, (task) => task.status === "completed");
    assert.equal(current.notificationCount, 0);
    assert.equal(current.events.some((event) => event.calendarEvent), false);
    return {
      case: "live-http",
      runtime: "actual-next-workflow",
      runId: restarted.runId,
      parentRunId: created.runId,
      phases: "read-prepare-review-deliver-watch-complete",
      approval: "fresh-owner-gate",
      pause: "stable-after-pending-timer",
      restart: "new-owned-run-preserves-parent-history",
      deliveries: 1,
      status: current.status,
      requests,
    };
  } finally {
    // Never touch the user's teaching runs. Only this freshly created fixture
    // principal can see this run, and cleanup is limited to this exact run ID.
    for (const runId of fixtureRuns) {
      const result = await request<{ task: AssistantTask }>(
        `/api/assistant/tasks/${encodeURIComponent(runId)}`,
      ).catch(() => undefined);
      if (result?.task.allowedActions.includes("cancel"))
        await action(result.task, "cancel").catch(() => {});
    }
  }
}
