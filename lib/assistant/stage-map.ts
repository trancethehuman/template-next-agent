import type {
  TaskFlowPresentation,
  TaskFlowStep,
} from "./flow-presentation";
import { assistantDemoStops } from "./types";
import type {
  AssistantDemoStop,
  AssistantTask,
  AssistantTaskInput,
  TaskEvent,
} from "./types";

export type StageId =
  | "start"
  | "read"
  | "notice"
  | "prepare"
  | "review"
  | "deliver"
  | "watch"
  | "create"
  | "finish";

export type StageState =
  | "upcoming"
  | "next"
  | "active"
  | "waiting"
  | "sleeping"
  | "paused"
  | "done"
  | "skipped"
  | "declined"
  | "stopped"
  | "failed";

export interface StageView {
  id: StageId;
  label: string;
  concept: string;
  /** What the stage does, in plain words. */
  summary: string;
  state: StageState;
  stateLabel: string;
  /** A short fact taken from recorded events, never a prediction. */
  fact?: string;
  /** Number of passes that executed this stage, for loop stages. */
  visits: number;
  lastStepId?: string;
}

export interface StageMapView {
  kind: AssistantTask["kind"];
  stages: StageView[];
  currentStageId?: StageId;
  /** Recorded source reads. */
  checks: number;
  maxChecks?: number;
  /** True while the run is between checks or starting another one. */
  looping: boolean;
  stepStages: Record<string, StageId>;
}

interface StageDefinition {
  id: StageId;
  label: string;
  concept: string;
  summary: string;
}

const meetingStages: StageDefinition[] = [
  { id: "start", label: "Start", concept: "Trigger", summary: "The request starts a run" },
  { id: "read", label: "Read", concept: "Read-only tools", summary: "Checks the calendar and notes" },
  { id: "prepare", label: "Prepare", concept: "Write the brief", summary: "Writes a short brief" },
  { id: "review", label: "Review", concept: "Approval boundary", summary: "Waits for your OK" },
  { id: "deliver", label: "Deliver", concept: "One inbox update", summary: "Puts the brief in the inbox" },
  { id: "watch", label: "Watch", concept: "Durable sleep", summary: "Sleeps, then checks again" },
  { id: "finish", label: "Finish", concept: "Stop condition", summary: "The run ends" },
];

const watchStages: StageDefinition[] = [
  { id: "start", label: "Start", concept: "Trigger", summary: "You start it once" },
  { id: "read", label: "Read", concept: "Read-only tools", summary: "Reads your next 7 days" },
  { id: "notice", label: "Notice", concept: "Blind spots", summary: "Flags clashes and changes" },
  { id: "deliver", label: "Message", concept: "Only you", summary: "Messages you, nobody else" },
  { id: "watch", label: "Schedule", concept: "Its own schedule", summary: "Picks its next check, then sleeps" },
  { id: "finish", label: "Finish", concept: "Stop condition", summary: "Ends after 5 checks or when you stop" },
];

const calendarStages: StageDefinition[] = [
  { id: "review", label: "Review", concept: "Approval boundary", summary: "Waits for your OK" },
  { id: "create", label: "Create", concept: "One approved write", summary: "Adds the event to your calendar" },
  { id: "finish", label: "Finish", concept: "Stop condition", summary: "The run ends" },
];

function stagesFor(kind: AssistantTask["kind"]): StageDefinition[] {
  if (kind === "calendar_event") return calendarStages;
  return kind === "calendar_watch" ? watchStages : meetingStages;
}

/** The loop before any run exists, for explaining the flow before a demo starts. */
export function previewStageMap(kind: AssistantTask["kind"]): StageMapView {
  const definitions = stagesFor(kind);
  return {
    kind,
    stages: definitions.map((definition) => ({
      ...definition,
      state: "upcoming",
      stateLabel: stateLabels.upcoming,
      visits: 0,
    })),
    checks: 0,
    looping: false,
    stepStages: {},
  };
}

function isDemoStop(id: StageId): id is AssistantDemoStop {
  return (assistantDemoStops as readonly string[]).includes(id);
}

/**
 * Stages a guided demo can play to and pause before: those ahead of the
 * current checkpoint, up to the next stage that stops for the owner anyway.
 */
export function playTargets(task: AssistantTask, map: StageMapView): AssistantDemoStop[] {
  if (!task.demo?.waitingForStep || !task.allowedActions.includes("play")) return [];
  const order = map.stages.map((stage) => stage.id);
  const current = map.currentStageId ? order.indexOf(map.currentStageId) : -1;
  if (current < 0) return [];
  const targets: AssistantDemoStop[] = [];
  for (const id of order.slice(current + 1)) {
    if (!isDemoStop(id)) break;
    targets.push(id);
    if (id === "review" || id === "watch") break;
  }
  return targets;
}

const watchLessons: Partial<Record<StageId, string>> = {
  start: "You ask once. After that, its own schedule starts every check.",
  read: "Read-only access to your next 7 days, including who replied to each invite.",
  deliver: "It only messages you, so it needs no approval. Anything sent to another person would wait for your OK. Each finding is sent once.",
  watch: "It picks its next check from your calendar, like writing its own cron job. The run sleeps on the server, even with this page closed.",
  finish: "A watch still needs an end: five checks, or you stop it.",
};

/** Plain-language notes for teaching each stage. They describe the design, not an outcome. */
export function stageLesson(
  id: StageId,
  mode: AssistantTask["mode"],
  kind?: AssistantTask["kind"],
): string {
  if (kind === "calendar_watch") {
    const lesson = watchLessons[id];
    if (lesson) return lesson;
  }
  switch (id) {
    case "start":
      return "A message, a schedule, or a button starts one bounded run.";
    case "read":
      return "Each source keeps an ID and a version, so the agent can tell what changed.";
    case "notice":
      return "A task agent answers what you asked. An always-on agent also looks for what you didn’t: clashes, missing people, and threads still waiting on someone.";
    case "prepare":
      return mode === "rehearsal"
        ? "A fixed template stands in for the model, so every rehearsal is the same."
        : "One bounded model call turns the sources into a short brief.";
    case "review":
      return "The agent can’t approve its own work. Saying no is a normal outcome.";
    case "deliver":
      return "One update to this task’s inbox. The version is saved, so a change never notifies twice.";
    case "watch":
      return "The run sleeps on the server until a timer or trigger wakes it, even with this page closed.";
    case "create":
      return "Only the approved draft is written. A retry reuses the same event.";
    case "finish":
      return "The run ends when checks run out, you finish, or you stop it.";
  }
}

const stateLabels: Record<StageState, string> = {
  upcoming: "Not yet",
  next: "Up next",
  active: "Working",
  waiting: "Your turn",
  sleeping: "Asleep",
  paused: "Paused",
  done: "Done",
  skipped: "Skipped",
  declined: "Declined",
  stopped: "Stopped",
  failed: "Failed",
};

const terminalStatuses = new Set(["completed", "cancelled", "failed"]);

function decisionOf(event: TaskEvent) {
  if (event.calendarDecision) return event.calendarDecision;
  if (event.title === "Delivery declined") return "denied";
  if (event.title === "Delivery approved") return "approved";
  return undefined;
}

function stageForEvent(
  event: TaskEvent,
  kind: AssistantTask["kind"],
  previous: StageId | undefined,
): StageId {
  if (kind === "calendar_event") {
    if (event.type === "calendar_event") return "create";
    if (event.type === "error") return previous === "review" ? "review" : "create";
    if (event.type === "approval") return "review";
    if (event.status === "running") return "create";
    if (event.status && terminalStatuses.has(event.status)) return "finish";
    return "review";
  }
  if (event.demoStage)
    return event.demoStage === "complete" ? "finish" : event.demoStage;
  if (event.type === "restart") return "start";
  if (event.type === "error") return previous ?? "read";
  switch (event.type) {
    case "source":
    case "deduplicated":
      return "read";
    case "brief":
      return "prepare";
    case "approval":
      return "review";
    case "notice":
      return "notice";
    case "notification":
      return "deliver";
  }
  switch (event.status) {
    case "queued":
      return "start";
    case "running":
      return event.input ? "start" : "read";
    case "sleeping":
    case "paused":
      // A wait before the first read is the scheduled start, not monitoring.
      return !previous || previous === "start" ? "start" : "watch";
    case "awaiting_approval":
      return "review";
    case "completed":
    case "cancelled":
    case "failed":
      return "finish";
  }
  return previous ?? "start";
}

interface StageRecord {
  executed: Set<number>;
  gated: Set<number>;
  deduplicated: Set<number>;
  declined: Set<number>;
  failed: boolean;
  stopped: boolean;
  lastStepId: string;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function readFact(steps: TaskFlowStep[], deduplicated: boolean) {
  const read = steps.filter((step) => step.event?.type === "source").at(-1);
  if (!read?.event) return undefined;
  const sources = read.event.sources ?? [];
  if (sources.length === 0) return "No meeting found";
  const version = sources[0]?.version ?? "";
  const versionLabel = ["1", "2"].includes(version)
    ? `Version ${version}`
    : "Snapshot";
  const changed = read.sourceChanges.some((change) => change.changed);
  const reread = read.sourceChanges.some((change) => change.previousVersion);
  const change = deduplicated
    ? "no change"
    : changed
      ? "changed"
      : reread
        ? "unchanged"
        : "first read";
  return `${versionLabel} · ${change}`;
}

/** Projects recorded checkpoints onto the agent loop. Stages ahead are labeled as not reached. */
export function projectStageMap(
  task: AssistantTask,
  flow: TaskFlowPresentation,
): StageMapView {
  const definitions = stagesFor(task.kind);
  const order = definitions.map((definition) => definition.id);
  const input: AssistantTaskInput | undefined = task.events.find(
    (event) => event.input,
  )?.input;
  const records = new Map<StageId, StageRecord>();
  const stepStages: Record<string, StageId> = {};
  let cycle = 0;
  let previous: StageId | undefined;

  for (const step of flow.steps) {
    const event = step.event;
    const stage = event
      ? stageForEvent(event, task.kind, previous)
      : "finish";
    if (task.kind !== "calendar_event" && stage === "read" && previous !== "read")
      cycle++;
    stepStages[step.id] = stage;
    const record = records.get(stage) ?? {
      executed: new Set<number>(),
      gated: new Set<number>(),
      deduplicated: new Set<number>(),
      declined: new Set<number>(),
      failed: false,
      stopped: false,
      lastStepId: step.id,
    };
    record.lastStepId = step.id;
    if (event?.demoGate) record.gated.add(cycle);
    else record.executed.add(cycle);
    if (event?.type === "deduplicated") record.deduplicated.add(cycle);
    if (event?.type === "approval" && decisionOf(event) === "denied")
      record.declined.add(cycle);
    if (event?.type === "approval" && decisionOf(event) === "cancelled")
      record.stopped = true;
    if (event?.type === "error") record.failed = true;
    records.set(stage, record);
    previous = stage;
  }

  const currentStageId = flow.currentStepId
    ? stepStages[flow.currentStepId]
    : undefined;
  const currentIndex = currentStageId ? order.indexOf(currentStageId) : -1;
  const terminal = terminalStatuses.has(task.status);
  const terminalState: StageState =
    task.status === "failed"
      ? "failed"
      : task.status === "cancelled"
        ? "stopped"
        : "done";
  const inPass = (record: StageRecord | undefined, id: StageId) =>
    Boolean(
      record &&
        (task.kind === "calendar_event" || id === "start"
          ? record.executed.size > 0
          : record.executed.has(cycle)),
    );
  const deduplicatedNow = Boolean(records.get("read")?.deduplicated.has(cycle));
  const declinedNow = Boolean(records.get("review")?.declined.has(cycle));
  // A watch that found nothing new this pass sends nothing.
  const quietNow =
    task.kind === "calendar_watch" &&
    Boolean(records.get("notice")?.executed.has(cycle)) &&
    !records.get("deliver")?.executed.has(cycle);
  // A stop or failure reported only by the run interrupts the last recorded stage.
  const lastEventStep = flow.steps.findLast((step) => step.event);
  const interruptedStageId =
    terminal &&
    task.status !== "completed" &&
    flow.steps.at(-1)?.origin === "run-status" &&
    lastEventStep
      ? stepStages[lastEventStep.id]
      : undefined;

  function liveState(): StageState {
    if (terminal) return terminalState;
    if (task.demo?.waitingForStep) return "next";
    switch (task.status) {
      case "running":
        return "active";
      case "sleeping":
        return "sleeping";
      case "paused":
        return "paused";
      default:
        return "waiting";
    }
  }

  function skippedNote(id: StageId): string {
    if (quietNow && id === "deliver") return "Nothing new, so no message";
    if (deduplicatedNow && ["prepare", "review", "deliver"].includes(id))
      return id === "prepare"
        ? "No change, so no new brief"
        : id === "review"
          ? "No change, nothing to review"
          : "No change, nothing sent";
    if (declinedNow) return id === "deliver" ? "Declined, nothing sent" : "Declined, run ended";
    if (id === "watch") return "All checks used";
    if (id === "review" && input && !input.approvalRequired)
      return "No approval required";
    if (task.restart) return "Restored from an earlier run";
    return "Not needed this time";
  }

  function skippedReason(id: StageId): string {
    if (quietNow && id === "deliver") return "Nothing new";
    if (deduplicatedNow && ["prepare", "review", "deliver"].includes(id))
      return "No change";
    if (declinedNow) return "Declined";
    if (id === "watch") return "No checks left";
    if (id === "review" && input && !input.approvalRequired)
      return "Not required";
    if (task.restart) return "Restored";
    return "Not needed";
  }

  const checks = flow.steps.filter(
    (step) => step.event?.type === "source",
  ).length;

  function watchFact(id: StageId): string | undefined {
    const latest = (type: TaskEvent["type"]) =>
      task.events.filter((event) => event.type === type).at(-1);
    switch (id) {
      case "start":
        return "Started by you";
      case "read": {
        const scan = latest("source")?.scan;
        return scan ? `${plural(scan.events, "event")} · next ${scan.days} days` : undefined;
      }
      case "notice": {
        const callouts = latest("notice")?.callouts;
        if (!callouts) return undefined;
        const fresh = callouts.filter((callout) => callout.fresh).length;
        if (!callouts.length) return "Nothing to flag";
        return fresh ? `${fresh} new · ${callouts.length} flagged` : `Nothing new · ${callouts.length} flagged`;
      }
      case "deliver":
        return task.notificationCount
          ? `${plural(task.notificationCount, "message")} sent`
          : undefined;
    }
    return undefined;
  }

  function fact(
    id: StageId,
    state: StageState,
    record: StageRecord | undefined,
  ): string | undefined {
    const approvals = task.events.filter((event) => event.type === "approval");
    const lastDecision = approvals.at(-1);
    if (task.kind === "calendar_watch") {
      const recorded = watchFact(id);
      if (recorded !== undefined) return recorded;
    }
    switch (id) {
      case "start":
        if (!input) return undefined;
        if (input.restart) return "Restored checkpoint";
        if (input.demoMode) return "Guided demo";
        if (input.manualStart) return "Started by you";
        return input.delaySeconds > 0
          ? `Starts after ${input.delaySeconds}s`
          : "Starts when created";
      case "read":
        return readFact(flow.steps, deduplicatedNow);
      case "prepare":
        if (!task.brief) return undefined;
        if (task.briefReused) return "Restored brief";
        return `${task.preference.bulletCount} bullets${task.preference.includeLinks ? " · links" : ""}`;
      case "review":
        if (state === "waiting") return "Needs your decision";
        if (state === "stopped" && !record?.stopped)
          return "Stopped before a decision";
        if (!lastDecision) return undefined;
        return decisionOf(lastDecision) === "approved"
          ? "Approved"
          : decisionOf(lastDecision) === "cancelled"
            ? "Stopped"
            : "Declined";
      case "deliver":
        return task.notificationCount
          ? `${plural(task.notificationCount, "update")} delivered`
          : undefined;
      case "watch":
        return input && records.has("watch")
          ? `Check ${checks} of ${input.maxChecks}`
          : undefined;
      case "create":
        if (!task.calendarEvent) return undefined;
        return task.calendarEvent.reused ? "Existing event confirmed" : "Event created";
      case "finish":
        if (!terminal) return undefined;
        if (task.status === "failed") return "Ended with a failure";
        if (task.status === "cancelled") return "Stopped before the end";
        return declinedNow ? "Ended after a decline" : "Complete";
    }
  }

  // A watch names the time it picked for its next check.
  const nextCheck = task.events.findLast((event) => event.nextCheck)?.nextCheck;

  const interruptedIndex = interruptedStageId
    ? order.indexOf(interruptedStageId)
    : -1;

  function recordedState(
    id: StageId,
    index: number,
    record: StageRecord | undefined,
  ): StageState {
    if (record?.failed) return "failed";
    if (record?.stopped) return "stopped";
    if (id === interruptedStageId)
      return lastEventStep?.event?.demoGate ? "upcoming" : terminalState;
    // Stages after an interruption were never run; they weren't skipped by design.
    if (interruptedIndex >= 0 && index > interruptedIndex) return "upcoming";
    if (id === "review" && declinedNow) return "declined";
    if (inPass(record, id)) return "done";
    return record?.gated.has(cycle) ? "upcoming" : "skipped";
  }

  const stages = definitions.map((definition, index): StageView => {
    const record = records.get(definition.id);
    const state: StageState =
      definition.id === "finish" && terminal
        ? terminalState
        : definition.id === currentStageId
          ? record?.failed
            ? "failed"
            : terminal
              ? terminalState
              : liveState()
          : index < currentIndex
            ? recordedState(definition.id, index, record)
            : "upcoming";
    const visits =
      task.kind === "calendar_event" || definition.id === "start"
        ? record
          ? 1
          : 0
        : (record?.executed.size ?? 0);
    const recordedFact = fact(definition.id, state, record);
    const stateLabel =
      definition.id === "watch" && state === "sleeping" && nextCheck
        ? `Until ${nextCheck.label}`
        : state === "skipped"
          ? `Skipped · ${skippedReason(definition.id)}`
          : state === "upcoming" && terminal
            ? "Not run"
            : stateLabels[state];
    return {
      ...definition,
      concept:
        definition.id === "prepare"
          ? task.mode === "rehearsal"
            ? "Fixed template"
            : "Model writes the brief"
          : definition.concept,
      state,
      stateLabel,
      fact:
        state === "skipped"
          ? skippedNote(definition.id)
          : state === "upcoming" && visits > 0 && recordedFact
            ? `Last pass · ${recordedFact}`
            : recordedFact,
      visits,
      lastStepId: record?.lastStepId,
    };
  });

  return {
    kind: task.kind,
    stages,
    currentStageId,
    checks,
    maxChecks: input?.maxChecks,
    looping:
      task.kind !== "calendar_event" &&
      !terminal &&
      (currentStageId === "watch" || (currentStageId === "read" && cycle > 1)),
    stepStages,
  };
}
