import type { AssistantTask, TaskEvent, TaskStatus } from "./types";

export type TaskFlowKind =
  | "status"
  | "source"
  | "brief"
  | "decision"
  | "delivery"
  | "wait"
  | "result"
  | "terminal"
  | "error";

export type TaskFlowState =
  | "recorded"
  | "active"
  | "waiting"
  | "paused"
  | "failed"
  | "denied"
  | "stopped";

export interface TaskFlowSourceChange {
  id: string;
  version: string;
  previousVersion?: string;
  changed: boolean;
}

export interface TaskFlowStep {
  id: string;
  eventId?: string;
  kind: TaskFlowKind;
  stageLabel: string;
  label: string;
  state: TaskFlowState;
  occurredAt?: string;
  /** Interval between recorded checkpoints, including durable waits. */
  elapsedFromPreviousMs?: number;
  /** Age of the currently observed working/waiting/paused checkpoint. */
  activeElapsedMs?: number;
  sourceChanges: TaskFlowSourceChange[];
  event?: TaskEvent;
  origin: "event" | "run-status";
}

export interface TaskFlowPresentation {
  steps: TaskFlowStep[];
  currentStepId?: string;
  summary: string;
  elapsedMs?: number;
  notificationCount: number;
  deduplicatedCount: number;
}

const terminalStatuses = new Set<TaskStatus>([
  "completed",
  "cancelled",
  "failed",
]);

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function interval(start: number | undefined, end: number | undefined) {
  if (start === undefined || end === undefined) return undefined;
  return Math.max(0, end - start);
}

function statusPresentation(status: TaskStatus) {
  switch (status) {
    case "queued":
      return {
        kind: "wait",
        stageLabel: "Start",
        label: "Ready to start",
      } as const;
    case "sleeping":
      return {
        kind: "wait",
        stageLabel: "Trigger",
        label: "Waiting for a trigger",
      } as const;
    case "paused":
      return { kind: "wait", stageLabel: "Pause", label: "Paused" } as const;
    case "awaiting_approval":
      return {
        kind: "wait",
        stageLabel: "Approve",
        label: "Waiting for approval",
      } as const;
    case "running":
      return { kind: "status", stageLabel: "Work", label: "Working" } as const;
    case "failed":
      return { kind: "error", stageLabel: "Failure", label: "Failed" } as const;
    case "cancelled":
      return {
        kind: "terminal",
        stageLabel: "Stop",
        label: "Stopped",
      } as const;
    case "completed":
      return {
        kind: "terminal",
        stageLabel: "Finish",
        label: "Finished",
      } as const;
  }
}

function decision(event: TaskEvent) {
  if (event.calendarDecision) return event.calendarDecision;
  // Meeting-prep decisions predate the structured calendarDecision field.
  // Only these exact application-owned markers establish their outcome.
  if (event.title === "Delivery declined") return "denied";
  if (event.title === "Delivery approved") return "approved";
  return undefined;
}

function eventPresentation(
  event: TaskEvent,
  taskKind: AssistantTask["kind"],
): Pick<TaskFlowStep, "kind" | "stageLabel" | "label" | "state"> {
  if (event.type === "error" || event.status === "failed")
    return {
      kind: "error",
      stageLabel: "Failure",
      label: "Failed",
      state: "failed",
    };
  if (event.type === "approval") {
    const outcome = decision(event);
    return {
      kind: "decision",
      stageLabel: "Decision",
      label:
        outcome === "approved"
          ? "Approved"
          : outcome === "denied"
            ? "Declined"
            : outcome === "cancelled"
              ? "Stopped"
              : "Decision recorded",
      state:
        outcome === "denied"
          ? "denied"
          : outcome === "cancelled"
            ? "stopped"
            : "recorded",
    };
  }
  if (event.type === "restart")
    return {
      kind: "status",
      stageLabel: "Restore",
      label: "Checkpoint restored",
      state: "recorded",
    };
  if (event.demoGate)
    return {
      kind: "wait",
      stageLabel: "Demo control",
      label: event.title,
      state: "recorded",
    };
  if (event.demoStage && event.status === "running")
    return {
      kind: "status",
      stageLabel: "Execute",
      label: event.title,
      state: "recorded",
    };
  if (event.status === "running")
    return {
      kind: "status",
      stageLabel: "Work",
      label:
        taskKind === "calendar_event"
          ? "Create event"
          : event.input
            ? "Task started"
            : taskKind === "calendar_watch"
              ? "Check calendar"
              : "Check context",
      state: "recorded",
    };
  // A watch names the next check it picked for itself.
  if (taskKind === "calendar_watch" && event.status === "sleeping")
    return { kind: "wait", stageLabel: "Schedule", label: event.title, state: "recorded" };
  if (event.status)
    return {
      ...statusPresentation(event.status),
      state: event.status === "cancelled" ? "stopped" : "recorded",
    };
  switch (event.type) {
    case "source":
      return {
        kind: "source",
        stageLabel: "Read",
        label:
          taskKind === "calendar_watch"
            ? "Calendar read"
            : event.sources?.length === 0
              ? "No meeting found"
              : "Context read",
        state: "recorded",
      };
    case "brief":
      return {
        kind: "brief",
        stageLabel: "Prepare",
        label: "Brief ready",
        state: "recorded",
      };
    case "notification":
      return {
        kind: "delivery",
        stageLabel: "Deliver",
        label: taskKind === "calendar_watch" ? "Messaged you" : "Update delivered",
        state: "recorded",
      };
    case "notice":
      return {
        kind: "result",
        stageLabel: "Notice",
        label: event.title,
        state: "recorded",
      };
    case "deduplicated":
      return {
        kind: "result",
        stageLabel: "Check",
        label: "No new update",
        state: "recorded",
      };
    case "calendar_event":
      return {
        kind: "result",
        stageLabel: "Calendar",
        label: event.calendarEvent
          ? event.calendarEvent.reused
            ? "Event confirmed"
            : "Event created"
          : "Result recorded",
        state: "recorded",
      };
    default:
      return {
        kind: "status",
        stageLabel: "Checkpoint",
        label: event.title || "Checkpoint recorded",
        state: "recorded",
      };
  }
}

function terminalOutcome(event: TaskEvent | undefined): TaskStatus | undefined {
  if (!event) return undefined;
  if (event.type === "error") return "failed";
  if (event.calendarDecision === "cancelled") return "cancelled";
  return event.status && terminalStatuses.has(event.status)
    ? event.status
    : undefined;
}

function summary(
  task: AssistantTask,
  events: TaskEvent[],
  steps: TaskFlowStep[],
) {
  if (task.status === "failed") return "Failed";
  if (task.status === "cancelled") return "Stopped";
  if (task.demo?.waitingForStep)
    return task.demo.playback === "play"
      ? "Playing demo"
      : "Ready for next step";
  if (task.status === "completed") {
    const lastDecision = events
      .filter((event) => event.type === "approval")
      .at(-1);
    return lastDecision && decision(lastDecision) === "denied"
      ? "Declined"
      : "Complete";
  }
  const tail = steps.at(-1);
  if (tail?.kind === "decision") return tail.label;
  if (tail?.kind === "delivery" || tail?.kind === "result") return tail.label;
  return statusPresentation(task.status).label;
}

/** Projects observed checkpoints only. It never predicts the next step. */
export function projectTaskFlow(
  task: AssistantTask,
  options: { now?: number } = {},
): TaskFlowPresentation {
  const now = options.now ?? Date.now();
  // A step retry can append its stable ID again with a later wall-clock time.
  // Preserve the first recorded checkpoint and its original position.
  const seen = new Set<string>();
  const events = task.events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  const versions = new Map<string, string>();
  let previousTimestamp = timestamp(task.createdAt);
  const steps: TaskFlowStep[] = events.map((event) => {
    const occurred = timestamp(event.occurredAt);
    const sourceChanges =
      event.type === "source"
        ? (event.sources ?? []).map((source) => {
            const previousVersion = versions.get(source.id);
            versions.set(source.id, source.version);
            return {
              id: source.id,
              version: source.version,
              previousVersion,
              changed:
                previousVersion !== undefined &&
                previousVersion !== source.version,
            };
          })
        : [];
    const step: TaskFlowStep = {
      id: event.id,
      eventId: event.id,
      ...eventPresentation(event, task.kind),
      occurredAt: occurred === undefined ? undefined : event.occurredAt,
      elapsedFromPreviousMs: interval(previousTimestamp, occurred),
      sourceChanges,
      event,
      origin: "event",
    };
    previousTimestamp = occurred;
    return step;
  });

  const terminal = terminalStatuses.has(task.status);
  if (terminal && terminalOutcome(events.at(-1)) !== task.status) {
    const occurred = timestamp(task.updatedAt);
    steps.push({
      id: `run-status:${task.runId}:${task.status}`,
      ...statusPresentation(task.status),
      state:
        task.status === "failed"
          ? "failed"
          : task.status === "cancelled"
            ? "stopped"
            : "recorded",
      occurredAt: occurred === undefined ? undefined : task.updatedAt,
      elapsedFromPreviousMs: interval(previousTimestamp, occurred),
      sourceChanges: [],
      origin: "run-status",
    });
  }

  const tail = steps.at(-1);
  if (!terminal && tail?.event?.status === task.status) {
    const currentState: TaskFlowState =
      task.status === "running"
        ? "active"
        : task.status === "paused"
          ? "paused"
          : "waiting";
    tail.state = currentState;
    tail.activeElapsedMs = interval(
      timestamp(tail.occurredAt),
      Number.isFinite(now) ? now : undefined,
    );
  }

  return {
    steps,
    currentStepId: tail?.id,
    summary: summary(task, events, steps),
    elapsedMs: interval(
      timestamp(task.createdAt),
      terminal
        ? timestamp(task.updatedAt)
        : Number.isFinite(now)
          ? now
          : undefined,
    ),
    notificationCount: events.filter((event) => event.type === "notification")
      .length,
    deduplicatedCount: events.filter((event) => event.type === "deduplicated")
      .length,
  };
}
